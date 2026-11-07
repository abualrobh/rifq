// RQ-005 Tafseer in the Worker (D-020, D-075, D-077, D-079).
//
// POST /api/tafseer with JSON {"s": <surah>, "a": <ayah>} returns the passage for one ayah from the
// configured Quran Foundation tafsir. The work is a setting (TAFSIR_ID), with no default, because
// D-076 is not decided. Without it, the route answers "not_configured" and shows no Tafseer.
//
// Copies (D-075, AC11): a passage is kept in the Workers Cache API for at most 7 days from the time
// the Worker fetched it, with an explicit max-age, and the Worker also checks the fetch time itself
// on every read, so an older copy is never served even if the cache kept it. The cache key holds
// the API environment, the tafsir ID and the ayah only (AC22); nothing about the reader is stored.
// Responses to the browser are never cacheable (no-store, or private no-store behind the gate).
//
// Integrity (D-079): when a fingerprint exists for (tafsir ID, ayah), the passage's SHA-256 is
// compared on every request, from a fresh fetch or a cached copy. On a mismatch the browser gets an
// "updated since review" notice instead of the passage. Nothing about the reader is recorded.
//
// Development page (GET /dev/tafseer-catalogue/): lists the tafsirs the API offers so Hamzeh can
// decide D-076. It exists only in development builds with the password gate on.
//
// No console call exists in this file on purpose: nothing is logged.
import { escapeHtml } from '../core/highlight.ts';
import { fingerprintMap, reviewState, type FingerprintFile } from '../core/tafseer-fingerprints.ts';
import { byAyahPath, isArabic, LIST_PATH, parseByAyah, parseTafsirList, QfClient, qfConfig, QfError, type Passage, type QfConfig, type QfSecrets, type TafsirListItem } from './qf.ts';

export const MAX_AGE_S = 7 * 24 * 60 * 60; // 604,800 seconds: the D-075 7-day limit
export const MAX_AGE_MS = MAX_AGE_S * 1000;
export const PROVIDER = 'Quran Foundation';
// Proposal (RQ-005 open question): 60 Tafseer requests per minute per network address.
export const TAFSEER_LIMIT_PER_MINUTE = 60;
export const CATALOGUE_PATH = '/dev/tafseer-catalogue/';
// D-076 (2026-11-08): Hamzeh chose Tafsir Ibn Kathir in Arabic. The Quran Foundation docs do not
// publish its tafsir ID, so no ID is set anywhere: TAFSIR_ID stays a setting, and the catalogue
// marks entries whose name, author or slug looks like Ibn Kathir so Hamzeh can confirm the ID and
// edition from the first real listing. The Arabic spelling is written as escapes (kaf, tha, ya, ra).
export const IBN_KATHIR = new RegExp(`kath[ei]e?r|katheer|kaseer|${String.fromCodePoint(0x643, 0x62b, 0x64a, 0x631)}`, 'i');
export const looksLikeIbnKathir = (x: { name: string | null; author_name: string | null; slug: string | null; translated_name?: { name: string | null } | null }) =>
  [x.name, x.author_name, x.slug, x.translated_name?.name].some((v) => typeof v === 'string' && IBN_KATHIR.test(v));

// Optional source record approved by Hamzeh (AC7): fields the API does not give.
export type TafseerSourceRecord = { title?: string; author?: string; edition?: string; publisher?: string };
export type TafseerCfg = { dev: boolean; gate?: boolean; counts?: number[]; fingerprints?: FingerprintFile | null; tafseerSource?: TafseerSourceRecord | null };
export type TafseerEnv = QfSecrets & { TAFSIR_ID?: string };

export type CacheLike = { match(key: string): Promise<Response | undefined>; put(key: string, r: Response): Promise<void> };
type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; cache?: () => CacheLike | null; timeoutMs?: number };

type Stored<T> = { v: 1; fetchedAt: number; data: T };
type PassageResult = { kind: 'ok'; p: Passage } | { kind: 'none' };

function defaultCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}

export function tafsirIdOf(env: TafseerEnv): number | null {
  const v = typeof env.TAFSIR_ID === 'string' ? env.TAFSIR_ID.trim() : '';
  return /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : null;
}

export function makeTafseer(cfg: TafseerCfg, deps: Deps = {}) {
  const now = deps.now ?? Date.now;
  const qf = new QfClient(deps.fetch, now, deps.timeoutMs);
  const getCache = deps.cache ?? defaultCache;
  const prints = fingerprintMap(cfg.fingerprints);

  // Cache API keys must be URLs. They are built on the request's own origin under a path no page
  // uses, and hold the API environment, tafsir ID and ayah only.
  const key = (origin: string, parts: (string | number)[]) => `${origin}/__rifq-cache/tafseer/v1/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`;

  async function readStored<T>(k: string): Promise<T | null> {
    const c = getCache();
    if (!c) return null;
    let r: Response | undefined;
    try { r = await c.match(k); } catch { return null; }
    if (!r) return null;
    try {
      const s = (await r.json()) as Stored<T>;
      const age = now() - s.fetchedAt;
      // Never serve a copy fetched 7 days ago or more, or one with a fetch time in the future.
      if (s.v !== 1 || !Number.isFinite(s.fetchedAt) || age < 0 || age >= MAX_AGE_MS) return null;
      return s.data;
    } catch { return null; }
  }

  async function writeStored<T>(k: string, data: T): Promise<void> {
    const c = getCache();
    if (!c) return;
    const body: Stored<T> = { v: 1, fetchedAt: now(), data };
    try {
      await c.put(k, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${MAX_AGE_S}` } }));
    } catch { /* a copy that cannot be kept is fetched again next time */ }
  }

  async function passage(origin: string, q: QfConfig, id: number, s: number, a: number): Promise<PassageResult> {
    const k = key(origin, [q.env, id, `${s}:${a}`]);
    const hit = await readStored<PassageResult>(k);
    if (hit) return hit;
    let res: PassageResult;
    try {
      const p = parseByAyah(await qf.get(q, byAyahPath(id, s, a), { fields: 'language_name' }), s, a);
      res = p ? { kind: 'ok', p } : { kind: 'none' };
    } catch (e) {
      if (e instanceof QfError && e.kind === 'not_found') res = { kind: 'none' };
      else throw e;
    }
    await writeStored(k, res);
    return res;
  }

  async function list(origin: string, q: QfConfig): Promise<TafsirListItem[]> {
    const k = key(origin, [q.env, 'list']);
    const hit = await readStored<TafsirListItem[]>(k);
    if (hit) return hit;
    const l = parseTafsirList(await qf.get(q, LIST_PATH));
    await writeStored(k, l);
    return l;
  }

  // Validated request -> response body and status. Never includes credentials or tokens.
  async function answer(origin: string, env: TafseerEnv, s: number, a: number): Promise<{ status: number; data: Record<string, unknown> }> {
    const q = qfConfig(env, cfg.dev);
    const id = tafsirIdOf(env);
    const missing = [...('missing' in q ? q.missing : []), ...(id === null ? ['TAFSIR_ID'] : [])];
    if ('missing' in q || id === null) return { status: 503, data: { status: 'not_configured', missing: cfg.dev ? missing : [] } };
    let r: PassageResult;
    try { r = await passage(origin, q, id, s, a); } catch { return { status: 503, data: { status: 'unavailable' } }; }
    if (r.kind === 'none') return { status: 404, data: { status: 'none', s, a } };
    let meta: TafsirListItem | undefined;
    try { meta = (await list(origin, q)).find((x) => x.id === id); } catch { meta = undefined; }
    const language = r.p.languageName ?? meta?.language_name ?? null;
    // D-077: Arabic Tafseer only. A work the API says is in another language is not shown.
    if (language !== null && !isArabic(language)) return { status: 503, data: { status: 'not_configured', missing: cfg.dev ? ['arabic_tafsir (D-077)'] : [] } };
    const rec = cfg.tafseerSource ?? {};
    const source = {
      tafsirId: id,
      title: r.p.resourceName ?? meta?.name ?? rec.title ?? null,
      author: meta?.author_name ?? rec.author ?? null,
      edition: rec.edition ?? null,
      publisher: rec.publisher ?? null,
      language,
      provider: PROVIDER,
    };
    const ref = `${s}:${a}`;
    const review = await reviewState(prints, id, ref, r.p.text);
    if (review.state === 'changed') return { status: 200, data: { status: 'changed', s, a, reviewed: review.reviewed, source } };
    return { status: 200, data: { status: 'ok', s, a, range: r.p.range, text: r.p.text, source, review } };
  }

  // Body already read and checked by the caller (size, type, cross-site, rate limit).
  async function api(origin: string, raw: string, env: TafseerEnv): Promise<{ status: number; data: Record<string, unknown> }> {
    let b: unknown;
    try { b = JSON.parse(raw); } catch { return { status: 400, data: { status: 'bad_request' } }; }
    const o = (b ?? {}) as Record<string, unknown>;
    const s = o.s, a = o.a;
    const counts = cfg.counts ?? [];
    if (!Number.isInteger(s) || !Number.isInteger(a) || (s as number) < 1 || (a as number) < 1) return { status: 400, data: { status: 'bad_request' } };
    if (counts.length && ((s as number) >= counts.length || (a as number) > counts[s as number])) return { status: 400, data: { status: 'bad_request' } };
    return answer(origin, env, s as number, a as number);
  }

  // The development catalogue page (D-076 helper). Plain HTML with no script.
  async function catalogue(origin: string, env: TafseerEnv): Promise<{ status: number; html: string }> {
    const h = escapeHtml;
    const q = qfConfig(env, cfg.dev);
    const id = tafsirIdOf(env);
    const head = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DEVELOPMENT PAGE: Tafseer catalogue - RIFQ</title><link rel="stylesheet" href="/rifq-basic.css"></head>
<body><p class="banner" role="note">DEVELOPMENT PAGE. Private, for Hamzeh only, to decide D-076. Not part of RIFQ, not reviewed, not for release.</p><main>
<h1>Tafseer works offered by the Quran Foundation API</h1>`;
    const foot = '</main></body></html>';
    if ('missing' in q) return { status: 503, html: `${head}<p role="alert">Not configured. Missing Worker settings: ${h(q.missing.join(', '))}.</p>${foot}` };
    let l: TafsirListItem[];
    try { l = await list(origin, q); } catch (e) {
      const kind = e instanceof QfError ? e.kind : 'unavailable';
      return { status: 503, html: `${head}<p role="alert">The API could not be reached or refused the request (${h(kind)}). Try again later.</p>${foot}` };
    }
    const ikArabic = (x: TafsirListItem) => isArabic(x.language_name) && looksLikeIbnKathir(x);
    const row = (x: TafsirListItem) => `<tr${ikArabic(x) ? ' class="match" data-ibn-kathir' : ''}><td>${x.id}</td><td>${h(x.name ?? 'not stated')}</td><td>${h(x.author_name ?? 'not stated')}</td><td>${h(x.language_name ?? 'not stated')}</td><td>${h(x.slug ?? '')}</td><td>${ikArabic(x) ? '<strong>Possible Ibn Kathir (D-076)</strong>' : looksLikeIbnKathir(x) ? 'Ibn Kathir name, not Arabic' : ''}</td></tr>`;
    const table = (rows: TafsirListItem[]) => `<table><thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">Author</th><th scope="col">Language</th><th scope="col">Slug</th><th scope="col">D-076</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
    const arabic = l.filter((x) => isArabic(x.language_name));
    const other = l.filter((x) => !isArabic(x.language_name));
    const ik = arabic.filter(looksLikeIbnKathir);
    const ikOther = other.filter(looksLikeIbnKathir);
    const ikNote = `<section aria-labelledby="ik"><h2 id="ik">D-076: Tafsir Ibn Kathir in Arabic</h2>
<p>Hamzeh chose Tafsir Ibn Kathir in Arabic. The Quran Foundation docs do not publish its ID, so TAFSIR_ID is not set. Arabic entries whose name, author or slug looks like Ibn Kathir: <strong data-ibn-kathir-count>${ik.length}</strong>${ik.length ? ' (IDs ' + ik.map((x) => x.id).join(', ') + ', marked below)' : ''}. Matches in other languages, not usable under D-077: ${ikOther.length}${ikOther.length ? ' (IDs ' + ikOther.map((x) => x.id).join(', ') + ')' : ''}.</p>
<p>Confirm the exact ID and edition (with the D-012 reviewer), then set TAFSIR_ID to that ID. This page matches by spelling only and is not a confirmation.</p></section>`;
    return { status: 200, html: `${head}
<p>API environment: <strong>${h(q.env)}</strong>. Pre-live data covers only surahs 1 and 2. Names, authors and languages are shown exactly as the API returns them, from <code>/resources/tafsirs</code>, kept for at most 7 days.</p>
<p>TAFSIR_ID setting: <strong>${id === null ? 'not set (D-076 open)' : String(id)}</strong>.</p>
${ikNote}
<h2>Arabic (D-077): ${arabic.length}</h2>
${arabic.length ? table(arabic) : '<p>None with language "arabic".</p>'}
<details><summary>Other languages, not shown to readers under D-077: ${other.length}</summary>${other.length ? table(other) : ''}</details>
<p>Choosing a work is Hamzeh's decision (D-076), with the D-012 reviewer. This list is not a recommendation.</p>${foot}` };
  }

  return { api, catalogue, client: qf };
}
