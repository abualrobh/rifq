// RQ-006 v1.1 audio metadata in the Worker (D-110 B, D-112 B, D-119 A, D-122 A, D-123).
//
// POST /api/audio/reciters {"lang": "ar"|"en"} -> the offered reciters, in D-111 order.
// POST /api/audio {"r": <chapter-reciter ID>, "s": <surah>} -> the surah file address and the
//   per-ayah timings for one offered reciter, or a plain status (not_offered, not_covered,
//   unavailable, not_configured).
//
// The Worker fetches only metadata from Quran Foundation, with its own content.audio.read token
// (AC36); the reader's browser plays the file directly from the approved audio host (D-112 B). The
// Worker never fetches, carries or stores audio. No reader header is forwarded (each request to QF
// is built from scratch in qf.ts); nothing is logged.
//
// Which reciters are offered is decided from data, never hard-coded (AC52, AC59, AC60, AC61):
// - Pre-live: a D-111 reciter is offered if its entry in this account's chapter-reciter list has
//   the expected name, Murattal and Hafs, and every surah the environment covers (1 and 2) passes
//   the timestamp and file checks. This runs in the Worker and its parts are kept for at most
//   7 days (D-075).
// - Production: 114 surahs per reciter are too many calls for one request, so the offered set comes
//   from a recorded check (scripts/audio-check.ts, AC52), given to the build. Without one, no
//   reciter is offered. Each surah file is still checked again when it is fetched.
//
// API paths (Content API v4, scope content.audio.read; see src/worker/reciters.ts for the doc URLs):
//   GET /resources/chapter_reciters?language=<ar|en>
//   GET /chapter_recitations/{reciter_id}/{chapter_number}
import { catalogueProblems, checkSurahFile, coveredSurahs, D111_IDS, DEFAULT_RECITER, type CatalogueEntry, type SurahCheck } from '../core/audio.ts';
import { qfConfig, QfClient, QfError, type QfConfig, type QfSecrets } from './qf.ts';
import { MAX_AGE_MS, MAX_AGE_S, type CacheLike } from './tafseer.ts';

export const AUDIO_SCOPE = 'content.audio.read';
export const AUDIO_CACHE_VERSION = 'v1';
// Proposal (RQ-006 security list, value not known): 60 audio metadata requests per minute per
// network address, in its own AUDIO_LIMIT binding, failing closed like the other limits (D-095).
export const AUDIO_LIMIT_PER_MINUTE = 60;

// A recorded production check (AC52): which D-111 reciters passed all 114 surahs, when, and in
// which environment. Results only; no address or timing is kept in it (AC35).
export type AudioRecord = { format: 'rifq-audio-check/1'; env: 'prelive' | 'production'; checked: string; passed: number[] };
export type AudioCfg = { dev: boolean; counts?: number[]; audioRecord?: AudioRecord | null };
type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; cache?: () => CacheLike | null; timeoutMs?: number };
type Stored<T> = { v: 1; fetchedAt: number; data: T };

export type OfferedReciter = { id: number; name: string; style: string | null; qirat: string | null };

function defaultCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseCatalogue(j: unknown): CatalogueEntry[] {
  const a = obj(j)?.reciters;
  if (!Array.isArray(a)) throw new QfError('bad_response');
  return a.flatMap((x) => {
    const o = obj(x);
    if (!o || typeof o.id !== 'number') return [];
    const tn = obj(o.translated_name);
    return [{ id: o.id, name: str(o.name), style: str(obj(o.style)?.name), qirat: str(obj(o.qirat)?.name), translated: str(tn?.name), translatedLang: str(tn?.language_name) }];
  });
}

// AC14: the name in the interface language as QF gives it, or `name` (English) as QF's fallback.
export function displayName(e: CatalogueEntry, lang: 'ar' | 'en'): string {
  if (lang === 'ar' && e.translated && e.translatedLang?.trim().toLowerCase() === 'arabic') return e.translated;
  return e.name ?? '';
}

export function makeAudio(cfg: AudioCfg, deps: Deps = {}) {
  const now = deps.now ?? Date.now;
  const qf = new QfClient(deps.fetch, now, deps.timeoutMs);
  const getCache = deps.cache ?? defaultCache;
  const counts = cfg.counts ?? [];
  const key = (origin: string, parts: (string | number)[]) => `${origin}/__rifq-cache/audio/${AUDIO_CACHE_VERSION}/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`;

  async function readStored<T>(k: string): Promise<T | null> {
    const c = getCache();
    if (!c) return null;
    let r: Response | undefined;
    try { r = await c.match(k); } catch { return null; }
    if (!r) return null;
    try {
      const s = (await r.json()) as Stored<T>;
      const age = now() - s.fetchedAt;
      if (s.v !== 1 || !Number.isFinite(s.fetchedAt) || age < 0 || age >= MAX_AGE_MS) return null;
      return s.data;
    } catch { return null; }
  }
  async function writeStored<T>(k: string, data: T): Promise<void> {
    const c = getCache();
    if (!c) return;
    try {
      await c.put(k, new Response(JSON.stringify({ v: 1, fetchedAt: now(), data } satisfies Stored<T>), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${MAX_AGE_S}` } }));
    } catch { /* fetched again next time */ }
  }

  async function catalogue(origin: string, q: QfConfig, lang: 'ar' | 'en'): Promise<CatalogueEntry[]> {
    const k = key(origin, [q.env, 'catalogue', lang]);
    const hit = await readStored<CatalogueEntry[]>(k);
    if (hit) return hit;
    const l = parseCatalogue(await qf.get(q, '/resources/chapter_reciters', { language: lang }, AUDIO_SCOPE));
    await writeStored(k, l);
    return l;
  }

  // One surah file's check. A file QF does not have (404) counts as a failed check, not an outage.
  async function surahFile(origin: string, q: QfConfig, r: number, s: number): Promise<SurahCheck> {
    const k = key(origin, [q.env, r, s]);
    const hit = await readStored<SurahCheck>(k);
    if (hit) return hit;
    let c: SurahCheck;
    try {
      c = checkSurahFile(await qf.get(q, `/chapter_recitations/${r}/${s}`, {}, AUDIO_SCOPE), s, counts[s] ?? -1);
    } catch (e) {
      if (e instanceof QfError && e.kind === 'not_found') c = { ok: false, problems: ['not found'], negatives: 0, play: null };
      // Refused for this one file (403): that reciter fails, now; not kept, so it is asked again.
      else if (e instanceof QfError && e.kind === 'auth') return { ok: false, problems: ['refused'], negatives: 0, play: null };
      else throw e;
    }
    await writeStored(k, c);
    return c;
  }

  // The offered D-111 reciters, in D-111 order, with their catalogue entries.
  async function offered(origin: string, q: QfConfig, lang: 'ar' | 'en'): Promise<{ list: { id: number; e: CatalogueEntry }[]; checked: 'worker' | 'record' | 'none' }> {
    const cat = await catalogue(origin, q, lang);
    const listed = D111_IDS.flatMap((id) => {
      const e = cat.find((x) => x.id === id);
      return e && catalogueProblems(id, e).length === 0 ? [{ id, e }] : [];
    });
    if (q.env === 'production') {
      const rec = cfg.audioRecord;
      if (!rec || rec.env !== 'production') return { list: [], checked: 'none' };
      return { list: listed.filter((x) => rec.passed.includes(x.id)), checked: 'record' };
    }
    const pass = await Promise.all(listed.map(async (x) => (await Promise.all(coveredSurahs(q.env).map((s) => surahFile(origin, q, x.id, s)))).every((c) => c.ok)));
    return { list: listed.filter((_, i) => pass[i]), checked: 'worker' };
  }

  function config(env: QfSecrets): QfConfig | { status: number; data: Record<string, unknown> } {
    const q = qfConfig(env, cfg.dev);
    if ('missing' in q) return { status: 503, data: { status: 'not_configured' } };
    return q;
  }

  async function reciters(origin: string, raw: string, env: QfSecrets): Promise<{ status: number; data: Record<string, unknown> }> {
    let lang: 'ar' | 'en' = 'ar';
    try { lang = (JSON.parse(raw) as { lang?: unknown }).lang === 'en' ? 'en' : 'ar'; } catch { return { status: 400, data: { status: 'bad_request' } }; }
    const q = config(env);
    if ('status' in q) return q;
    try {
      const o = await offered(origin, q, lang);
      const list: OfferedReciter[] = o.list.map(({ id, e }) => ({ id, name: displayName(e, lang), style: e.style, qirat: e.qirat }));
      const def = list.some((x) => x.id === DEFAULT_RECITER) ? DEFAULT_RECITER : (list[0]?.id ?? null);
      return { status: 200, data: { status: 'ok', reciters: list, default: def } };
    } catch { return { status: 503, data: { status: 'unavailable' } }; }
  }

  async function file(origin: string, raw: string, env: QfSecrets): Promise<{ status: number; data: Record<string, unknown> }> {
    let b: Record<string, unknown>;
    try { b = (JSON.parse(raw) ?? {}) as Record<string, unknown>; } catch { return { status: 400, data: { status: 'bad_request' } }; }
    const r = b.r, s = b.s;
    if (!Number.isInteger(r) || !Number.isInteger(s) || (s as number) < 1 || (s as number) >= counts.length) return { status: 400, data: { status: 'bad_request' } };
    if (!D111_IDS.includes(r as number)) return { status: 404, data: { status: 'not_offered' } };
    const q = config(env);
    if ('status' in q) return q;
    if (!coveredSurahs(q.env).includes(s as number)) return { status: 404, data: { status: 'not_covered' } };
    try {
      const o = await offered(origin, q, 'en');
      if (!o.list.some((x) => x.id === r)) return { status: 404, data: { status: 'not_offered' } };
      const c = await surahFile(origin, q, r as number, s as number);
      if (!c.ok || !c.play) return { status: 404, data: { status: 'not_covered' } };
      // AC34: only what the player needs.
      return { status: 200, data: { status: 'ok', r, s, url: c.play.url, duration: c.play.duration, t: c.play.t } };
    } catch { return { status: 503, data: { status: 'unavailable' } }; }
  }

  return { reciters, file, offered, surahFile, client: qf };
}
