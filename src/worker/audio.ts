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
//   GET /chapter_recitations/{reciter_id}/{chapter_number}?segments=true
// segments=true is needed: without it Quran Foundation leaves out the per-ayah timestamps (seen on
// the real pre-live API with kit v23; the doc calls timestamps "present when timing data is
// available"). The word segments that come with them are dropped at once: only each ayah's
// [timestamp_from, timestamp_to] is kept or sent to the browser (checkSurahFile).
import { catalogueProblems, checkSurahFile, type FileShape, coveredSurahs, D111_IDS, DEFAULT_RECITER, type CatalogueEntry, type SurahCheck } from '../core/audio.ts';
import { qfConfig, QfClient, QfError, type QfConfig, type QfSecrets } from './qf.ts';
import { MAX_AGE_MS, MAX_AGE_S, type CacheLike } from './tafseer.ts';

export const AUDIO_SCOPE = 'content.audio.read';
// v2 (kit v23): v1 kept failed checks for 7 days, including the AC60 failures of kit v22.
// v3 (kit v24): checks made without segments=true (no timestamps) are never read again.
export const AUDIO_CACHE_VERSION = 'v3';
export const SURAH_FILE_QUERY = { segments: 'true' } as const;
export const FAIL_AGE_MS = 10 * 60_000;
// QA FIND-2: the most one reciter's surah checks may take before it counts as an outage for now.
export const RECITER_CHECK_MS = 8000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => { const id = setTimeout(() => rej(new Error('timeout')), ms); p.then((v) => { clearTimeout(id); res(v); }, (e) => { clearTimeout(id); rej(e); }); });
}
// Proposal (RQ-006 security list, value not known): 60 audio metadata requests per minute per
// network address, in its own AUDIO_LIMIT binding, failing closed like the other limits (D-095).
export const AUDIO_LIMIT_PER_MINUTE = 60;

// A recorded production check (AC52): which D-111 reciters passed all 114 surahs, when, and in
// which environment. Results only; no address or timing is kept in it (AC35).
export type AudioRecord = { format: 'rifq-audio-check/1'; env: 'prelive' | 'production'; checked: string; passed: number[] };
export type AudioCfg = { dev: boolean; counts?: number[]; audioRecord?: AudioRecord | null };
type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; cache?: () => CacheLike | null; timeoutMs?: number };
type Stored<T> = { v: 1; fetchedAt: number; data: T; maxAge?: number };

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
      if (s.v !== 1 || !Number.isFinite(s.fetchedAt) || age < 0 || age >= Math.min(MAX_AGE_MS, s.maxAge ?? MAX_AGE_MS)) return null;
      return s.data;
    } catch { return null; }
  }
  async function writeStored<T>(k: string, data: T, maxAge = MAX_AGE_MS): Promise<void> {
    const c = getCache();
    if (!c) return;
    try {
      await c.put(k, new Response(JSON.stringify({ v: 1, fetchedAt: now(), data, maxAge } satisfies Stored<T>), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${Math.ceil(maxAge / 1000)}` } }));
    } catch { /* fetched again next time */ }
  }

  async function catalogue(origin: string, q: QfConfig, lang: 'ar' | 'en'): Promise<CatalogueEntry[]> {
    const k = key(origin, [q.env, 'catalogue', lang]);
    const hit = await readStored<CatalogueEntry[]>(k);
    if (hit) return hit;
    const l = parseCatalogue(await qf.get(q, '/resources/chapter_reciters', { language: lang }, AUDIO_SCOPE));
    // QA FIND-7: an empty list (for example during a QF incident) is kept 10 minutes, not 7 days.
    await writeStored(k, l, l.length ? MAX_AGE_MS : FAIL_AGE_MS);
    return l;
  }

  // One surah file's check. A file QF does not have (404) counts as a failed check, not an outage.
  async function surahFile(origin: string, q: QfConfig, r: number, s: number): Promise<SurahCheck> {
    const k = key(origin, [q.env, r, s]);
    const hit = await readStored<SurahCheck>(k);
    if (hit) return hit;
    let c: SurahCheck;
    try {
      c = checkSurahFile(await qf.get(q, `/chapter_recitations/${r}/${s}`, SURAH_FILE_QUERY, AUDIO_SCOPE), s, counts[s] ?? -1);
    } catch (e) {
      if (e instanceof QfError && e.kind === 'not_found') c = { ok: false, problems: ['not found'], negatives: 0, play: null };
      // Refused for this one file (403): that reciter fails, now; not kept, so it is asked again.
      else if (e instanceof QfError && e.kind === 'auth') return { ok: false, problems: ['refused'], negatives: 0, play: null };
      else throw e;
    }
    // A passing check is kept up to 7 days; a failing one only 10 minutes, so a fix to the data or
    // to the rules takes effect soon, without asking QF again on every request.
    await writeStored(k, c, c.ok ? MAX_AGE_MS : FAIL_AGE_MS);
    return c;
  }

  // The offered D-111 reciters, in D-111 order, with their catalogue entries. The AC59 check always
  // reads the English catalogue (language=en): with language=ar, QF may give the style, qirat and
  // translated name in Arabic, and the check, which compares with Murattal, Hafs and the Latin
  // surname, would then refuse every reciter (seen on the test site with kit v22).
  async function offered(origin: string, q: QfConfig): Promise<{ list: { id: number; e: CatalogueEntry }[]; checked: 'worker' | 'record' | 'none'; outage: number; outageIds: number[] }> {
    const cat = await catalogue(origin, q, 'en');
    const listed = D111_IDS.flatMap((id) => {
      const e = cat.find((x) => x.id === id);
      return e && catalogueProblems(id, e).length === 0 ? [{ id, e }] : [];
    });
    if (q.env === 'production') {
      const rec = cfg.audioRecord;
      if (!rec || rec.env !== 'production') return { list: [], checked: 'none', outage: 0, outageIds: [] };
      return { list: listed.filter((x) => rec.passed.includes(x.id)), checked: 'record', outage: 0, outageIds: [] };
    }
    // QA FIND-2: each reciter is judged on its own. A failed check removes only that reciter; an
    // outage (error or no answer within RECITER_CHECK_MS) removes it for now and is reported
    // separately, so one slow or failing surah call no longer empties the whole list.
    const res = await Promise.allSettled(listed.map((x) => reciterPasses(origin, q, x.id)));
    const list = listed.filter((_, i) => res[i].status === 'fulfilled' && (res[i] as PromiseFulfilledResult<boolean>).value);
    const outageIds = listed.filter((_, i) => res[i].status === 'rejected').map((x) => x.id);
    return { list, checked: 'worker', outage: outageIds.length, outageIds };
  }

  // One reciter in pre-live: every covered surah passes. Rejects on an outage or a time-out.
  function reciterPasses(origin: string, q: QfConfig, id: number): Promise<boolean> {
    const work = Promise.all(coveredSurahs(q.env).map((s) => surahFile(origin, q, id, s))).then((cs) => cs.every((c) => c.ok));
    return withTimeout(work, RECITER_CHECK_MS);
  }

  async function isOffered(origin: string, q: QfConfig, id: number): Promise<boolean> {
    const e = (await catalogue(origin, q, 'en')).find((x) => x.id === id);
    if (!e || catalogueProblems(id, e).length) return false;
    if (q.env === 'production') return !!cfg.audioRecord && cfg.audioRecord.env === 'production' && cfg.audioRecord.passed.includes(id);
    return reciterPasses(origin, q, id);
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
      const o = await offered(origin, q);
      // Nothing offered because of an outage (not a failed check): say "unavailable", not "none".
      if (!o.list.length && o.outage) return { status: 503, data: { status: 'unavailable' } };
      // Display names only: the Arabic catalogue, if it can be read; otherwise the English name.
      let ar: CatalogueEntry[] = [];
      if (lang === 'ar' && o.list.length) { try { ar = await catalogue(origin, q, 'ar'); } catch { ar = []; } }
      const list: OfferedReciter[] = o.list.map(({ id, e }) => {
        const local = ar.find((x) => x.id === id);
        return { id, name: (local && displayName(local, 'ar')) || displayName(e, 'en'), style: e.style, qirat: e.qirat };
      });
      const def = list.some((x) => x.id === DEFAULT_RECITER) ? DEFAULT_RECITER : (list[0]?.id ?? null);
      // QA v25 FIND-B: the D-111 IDs whose check could not be made now (outage or time-out), so the
      // browser keeps a reader's stored choice of one of them instead of treating it as gone (AC18
      // is for reciters no longer offered, not for a short outage). D-111 IDs only; nothing else.
      return { status: 200, data: { status: 'ok', reciters: list, default: def, unavailable: o.outageIds } };
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
      // Only the asked reciter is checked (QA FIND-2: no need to check every reciter again).
      if (!(await isOffered(origin, q, r as number))) return { status: 404, data: { status: 'not_offered' } };
      const c = await surahFile(origin, q, r as number, s as number);
      if (!c.ok || !c.play) return { status: 404, data: { status: 'not_covered' } };
      // AC34: only what the player needs.
      return { status: 200, data: { status: 'ok', r, s, url: c.play.url, duration: c.play.duration, t: c.play.t } };
    } catch { return { status: 503, data: { status: 'unavailable' } }; }
  }

  // Development diagnosis for /dev/reciters/ (temporary, after the kit v22 report): runs the same
  // offered() and surah checks the player relies on, fresh (no copy), and reports every result.
  // Problems are rule texts and numbers only; no address, timing list or audio.
  async function diagnose(origin: string, env: QfSecrets): Promise<{ config: string; offered: number[] | string; reciters: { id: number; catalogue: string[] | string; surahs: { s: number; ok: boolean; problems: string[]; negatives: number; shape?: FileShape }[] }[] }> {
    const q = qfConfig(env, cfg.dev);
    if ('missing' in q) return { config: 'missing ' + q.missing.join(', '), offered: 'not run', reciters: [] };
    let offeredIds: number[] | string;
    try { const o = await offered(origin, q); offeredIds = o.list.map((x) => x.id); if (o.outage) offeredIds = `${offeredIds.join(', ') || 'none'} (${o.outage} reciter(s) not checked: outage or time-out)`; } catch (e) { offeredIds = 'failed: ' + (e instanceof QfError ? e.kind : 'error'); }
    let cat: CatalogueEntry[] | null = null, catErr = '';
    try { cat = parseCatalogue(await qf.get(q, '/resources/chapter_reciters', { language: 'en' }, AUDIO_SCOPE)); } catch (e) { catErr = 'catalogue failed: ' + (e instanceof QfError ? e.kind : 'error'); }
    const out = [];
    for (const id of D111_IDS) {
      const catalogue = cat ? catalogueProblems(id, cat.find((x) => x.id === id)) : catErr;
      const surahs = [];
      for (const s of coveredSurahs(q.env)) {
        try {
          const c = checkSurahFile(await qf.get(q, `/chapter_recitations/${id}/${s}`, SURAH_FILE_QUERY, AUDIO_SCOPE), s, counts[s] ?? -1);
          surahs.push({ s, ok: c.ok, problems: c.problems, negatives: c.negatives, shape: c.shape });
        } catch (e) { surahs.push({ s, ok: false, problems: ['call failed: ' + (e instanceof QfError ? e.kind : 'error')], negatives: 0 }); }
      }
      out.push({ id, catalogue, surahs });
    }
    return { config: `${q.env}, ayah counts for ${counts.length - 1} surahs`, offered: offeredIds, reciters: out };
  }

  return { reciters, file, offered, surahFile, diagnose, client: qf };
}
