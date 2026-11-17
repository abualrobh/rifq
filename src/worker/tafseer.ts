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
// D-149 display marks (D-156 A): on a fetch from the API (a cache miss), the Worker runs the quote
// check on the passage against its covered range and keeps one class letter per bracketed phrase
// in the same cache entry, with the same fetch time, so the marks can never outlive the passage.
// The cache key also holds the check version and the approved file's SHA-256, so marks made by
// other matching code or another file are never read (AC31). The response gives the passage text
// unchanged (AC4) plus the marks only; the matching data never leaves the Worker (D-157).
//
// Integrity (D-079, D-151 A, kit v32 FIND-AE): fingerprints are a change alarm only. This route
// always returns the passage and says nothing about review to readers (RQ-005 v1.1 AC26, AC27:
// no "matches the reviewed text" line, no "updated since review" notice, and a changed passage is
// never hidden). Fingerprint mismatches are reported on the development page /dev/quote-check/
// only (src/worker/quote-check.ts: ayah references and counts, never content).
//
// Development page (GET /dev/tafseer-catalogue/): lists the tafsirs the API offers so Hamzeh can
// decide D-076. It exists only in development builds with the password gate on.
//
// RQ-007 (kit v34, D-135, D-136, D-141 C, D-143 A, D-145): English Tafseer. The English work is its
// own setting, TAFSIR_EN_ID, with no default (AC8). A request with "l": "en" asks for it (the
// English interface); a request without "l" (or "ar") asks for the Arabic work exactly as before.
// The language check runs for each setting on its own (AC9): TAFSIR_ID serves only a work the API
// says is "arabic" (since kit v35, D-174 A: an unknown language is refused too), TAFSIR_EN_ID only
// one it says is "english" (an unknown language is refused). Each work has its own cache entries (the English key holds "en" and its ID),
// its own marks and its own source details (AC10). The 7-day rule, the shared TAFSEER_LIMIT and the
// content.tafsirs.read scope are the same code for both (AC25 to AC27). No fingerprint is ever looked
// at for English (AC16). D-149 marks for English treat a phrase with no Arabic letters as "N",
// shown as delivered (P-11, AC34).
//
// No console call exists in this file on purpose: nothing is logged.
import { escapeHtml } from '../core/highlight.ts';
import type { FingerprintFile } from '../core/tafseer-fingerprints.ts';
import { shapeOf } from './shape.ts';
import { computeMarks, type Marks } from '../core/tafseer-marks.ts';
import { EN_MARKS_VERSION, enMarks } from './marks-en.ts';
import type { Letters } from './letters.ts';
import { byAyahPath, byChapterPath, isArabic, LIST_PATH, parseByAyah, parseTafsirList, QfClient, qfConfig, QfError, type Passage, type QfConfig, type QfSecrets, type TafsirListItem } from './qf.ts';

export const MAX_AGE_S = 7 * 24 * 60 * 60; // 604,800 seconds: the D-075 7-day limit
export const MAX_AGE_MS = MAX_AGE_S * 1000;
export const PROVIDER = 'Quran Foundation';
// Proposal (RQ-005 open question): 60 Tafseer requests per minute per network address.
export const TAFSEER_LIMIT_PER_MINUTE = 60;
export const CATALOGUE_PATH = '/dev/tafseer-catalogue/';
export const SHAPE_PATH = '/dev/tafseer-shape/';
// v4 (kit v30): the matching code changed (FIND-X one-word own-ayah edge match, 2:72 hamza seat), so
// no entry with marks from the v3 code is read again; the matching-code hash in the key changes too.
// v5 (kit v31): the one-word own-ayah rule changed (QA v30 FIND-Y, D-163 A: no question alef), so
// no entry with marks from the v4 code is read again.
export const CACHE_VERSION = 'v5';
const CONTENT_PATH_NOTE = '/content/api/v4';
// D-076 (2026-11-08): Hamzeh chose Tafsir Ibn Kathir in Arabic. The Quran Foundation docs do not
// publish its tafsir ID, so no ID is set anywhere: TAFSIR_ID stays a setting, and the catalogue
// marks entries whose name, author or slug looks like Ibn Kathir so Hamzeh can confirm the ID and
// edition from the first real listing. The Arabic spelling is written as escapes (kaf, tha, ya, ra).
export const IBN_KATHIR = new RegExp(`kath[ei]e?r|katheer|kaseer|${String.fromCodePoint(0x643, 0x62b, 0x64a, 0x631)}`, 'i');
export const looksLikeIbnKathir = (x: { name: string | null; author_name: string | null; slug: string | null; translated_name?: { name: string | null } | null }) =>
  [x.name, x.author_name, x.slug, x.translated_name?.name].some((v) => typeof v === 'string' && IBN_KATHIR.test(v));

// Optional source record approved by Hamzeh (AC7): fields the API does not give.
export type TafseerSourceRecord = { title?: string; author?: string; edition?: string; publisher?: string };
// RQ-007 AC14 (D-140 C): the English work's record also names its translator, abridgement and
// original work. Only Hamzeh's approved record fills these; otherwise they are "not stated".
export type TafseerEnSourceRecord = TafseerSourceRecord & { translator?: string; abridgement?: string; original?: string };
// tafseerParts (release builds only, from the release check, RQ-007 AC18): a part that failed its
// check is held back and answers "not configured". Development builds never set it.
export type TafseerCfg = { dev: boolean; gate?: boolean; counts?: number[]; fingerprints?: FingerprintFile | null; tafseerSource?: TafseerSourceRecord | null; tafseerEnSource?: TafseerEnSourceRecord | null; tafseerParts?: { ar: boolean; en: boolean } | null };
export type TafseerEnv = QfSecrets & { TAFSIR_ID?: string; TAFSIR_EN_ID?: string };
export type TafseerLang = 'ar' | 'en';
// The setting and the API language each interface's work must have (AC8, AC9).
export const SETTING: Record<TafseerLang, 'TAFSIR_ID' | 'TAFSIR_EN_ID'> = { ar: 'TAFSIR_ID', en: 'TAFSIR_EN_ID' };
export const isEnglish = (language: string | null | undefined) => typeof language === 'string' && language.trim().toLowerCase() === 'english';

export type CacheLike = { match(key: string): Promise<Response | undefined>; put(key: string, r: Response): Promise<void> };
type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; cache?: () => CacheLike | null; timeoutMs?: number; letters?: Letters | null };

type Stored<T> = { v: 1; fetchedAt: number; data: T };
type PassageResult = { kind: 'ok'; p: Passage; marks?: Marks | null } | { kind: 'none' };

function defaultCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}

export function tafsirIdOf(env: TafseerEnv, lang: TafseerLang = 'ar'): number | null {
  const raw = env[SETTING[lang]];
  const v = typeof raw === 'string' ? raw.trim() : '';
  return /^[1-9][0-9]{0,8}$/.test(v) ? Number(v) : null;
}

export function makeTafseer(cfg: TafseerCfg, deps: Deps = {}) {
  const now = deps.now ?? Date.now;
  const qf = new QfClient(deps.fetch, now, deps.timeoutMs);
  const getCache = deps.cache ?? defaultCache;
  const letters = deps.letters ?? null;
  // Requests handled by this isolate (the timing page reports whether its index was cold).
  let served = 0;

  // Cache API keys must be URLs. They are built on the request's own origin under a path no page
  // uses, and hold the API environment, tafsir ID and ayah only.
  // v2 (2026-11-08): the by_ayah parser changed, so copies made by the old parser (including
  // wrong "no Tafseer" answers) are never read again. They expire on their own within 7 days.
  // v3 (2026-11-14, D-156 A): entries hold the D-149 marks; v2 entries are never read again.
  const key = (origin: string, parts: (string | number)[]) => `${origin}/__rifq-cache/tafseer/${CACHE_VERSION}/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`;

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

  async function passage(origin: string, q: QfConfig, id: number, s: number, a: number, lang: TafseerLang = 'ar'): Promise<PassageResult> {
    // The Arabic key is unchanged from kit v33; the English key also holds "en" (AC10) and, since
    // kit v35, the version of the English marks code (EN_MARKS_VERSION, src/worker/marks-en.ts).
    const lk = letters ? letters.key() : 'nomarks';
    const k = key(origin, lang === 'ar' ? [q.env, id, `${s}:${a}`, lk] : [q.env, 'en', id, `${s}:${a}`, lk, EN_MARKS_VERSION]);
    const hit = await readStored<PassageResult>(k);
    if (hit) return hit;
    let res: PassageResult;
    try {
      const p = parseByAyah(await qf.get(q, byAyahPath(id, s, a), { fields: 'language_name' }), s, a);
      res = p ? { kind: 'ok', p, marks: marksFor(p, lang) } : { kind: 'none' };
    } catch (e) {
      if (e instanceof QfError && e.kind === 'not_found') res = { kind: 'none' };
      else throw e;
    }
    await writeStored(k, res);
    return res;
  }

  // Once per fetched passage. A work whose language the API does not give is taken as Arabic (the
  // route serves Arabic works only, D-077). If anything goes wrong, no marks: the browser then shows
  // the passage as delivered (AC37).
  // RQ-007: an English passage is never an Arabic work (P-11: its phrases with no Arabic letters
  // are "N", shown as delivered).
  // Kit v35 (B5): English passages use enMarks (the same letters, less CPU; the index is built
  // only when a phrase has Arabic letters).
  function marksFor(p: Passage, lang: TafseerLang): Marks | null {
    if (!letters) return null;
    try {
      if (lang === 'en') return enMarks(() => letters.index(`/api/tafseer request ${served}`), p.text, p.range);
      return computeMarks(letters.index(`/api/tafseer request ${served}`), p.text, p.range, lang === 'ar' && (p.languageName === null || isArabic(p.languageName)));
    } catch { return null; }
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
  async function answer(origin: string, env: TafseerEnv, s: number, a: number, lang: TafseerLang = 'ar'): Promise<{ status: number; data: Record<string, unknown> }> {
    if (lang === 'en') return answerEn(origin, env, s, a);
    // RQ-007 AC18 (release builds only): an Arabic part that failed its release check is held back.
    if (!cfg.dev && cfg.tafseerParts && !cfg.tafseerParts.ar) return { status: 503, data: { status: 'not_configured', missing: [] } };
    const q = qfConfig(env, cfg.dev);
    const id = tafsirIdOf(env);
    const missing = [...('missing' in q ? q.missing : []), ...(id === null ? ['TAFSIR_ID'] : [])];
    if ('missing' in q || id === null) return { status: 503, data: { status: 'not_configured', missing: cfg.dev ? missing : [] } };
    let r: PassageResult;
    try { r = await passage(origin, q, id, s, a); } catch { return { status: 503, data: { status: 'unavailable' } }; }
    let meta: TafsirListItem | undefined;
    let listFailed = false;
    // Kit v35, D-174 A (RQ-007 AC9, QA v34 FIND-AT): the Arabic setting serves only a work the API
    // calls "arabic", as the English setting does for "english". The language is read first, also
    // for "no passage". A work in another language, or one whose language cannot be read (not in
    // the list and not in the passage), is refused with "not configured", naming the expected
    // language and D-135 in development builds. If the list cannot be read now and the passage does
    // not say, the answer is "unavailable" (nothing is shown). A work labelled "arabic" gets exactly
    // the answers it got before (byte for byte; tested).
    try { meta = (await list(origin, q)).find((x) => x.id === id); } catch { meta = undefined; listFailed = true; }
    const language = (r.kind === 'ok' ? r.p.languageName : null) ?? meta?.language_name ?? null;
    if (language === null && listFailed) return { status: 503, data: { status: 'unavailable' } };
    if (language === null || !isArabic(language)) return { status: 503, data: { status: 'not_configured', missing: cfg.dev ? ['arabic_tafsir (D-135)'] : [] } };
    if (r.kind === 'none') return { status: 404, data: { status: 'none', s, a } };
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
    return { status: 200, data: { status: 'ok', s, a, range: r.p.range, text: r.p.text, source, ...(r.marks ? { marks: r.marks } : {}) } };
  }

  // RQ-007: the English work (TAFSIR_EN_ID). Same steps as answer(), with its own setting, language
  // check, cache entries, marks and source record. Every answer carries lang "en".
  async function answerEn(origin: string, env: TafseerEnv, s: number, a: number): Promise<{ status: number; data: Record<string, unknown> }> {
    const notConfigured = (missing: string[]) => ({ status: 503, data: { status: 'not_configured', lang: 'en', missing: cfg.dev ? missing : [] } });
    // Release builds: the English part is held back unless its release check passed (AC12, AC18).
    if (!cfg.dev && cfg.tafseerParts && !cfg.tafseerParts.en) return notConfigured([]);
    const q = qfConfig(env, cfg.dev);
    const id = tafsirIdOf(env, 'en');
    if ('missing' in q || id === null) return notConfigured([...('missing' in q ? q.missing : []), ...(id === null ? ['TAFSIR_EN_ID'] : [])]);
    let r: PassageResult;
    try { r = await passage(origin, q, id, s, a, 'en'); } catch { return { status: 503, data: { status: 'unavailable', lang: 'en' } }; }
    let meta: TafsirListItem | undefined;
    let listFailed = false;
    // Also for "no passage": the work's language decides whether it may be served at all.
    try { meta = (await list(origin, q)).find((x) => x.id === id); } catch { meta = undefined; listFailed = true; }
    const language = (r.kind === 'ok' ? r.p.languageName : null) ?? meta?.language_name ?? null;
    // AC9: only a work the API calls "english". If its language cannot be read now (the list
    // failed and the passage does not say), nothing is shown: "unavailable".
    if (language === null && listFailed) return { status: 503, data: { status: 'unavailable', lang: 'en' } };
    if (!isEnglish(language)) return notConfigured(['english_tafsir (D-135)']);
    if (r.kind === 'none') return { status: 404, data: { status: 'none', lang: 'en', s, a } };
    const rec = cfg.tafseerEnSource ?? {};
    const source = {
      tafsirId: id,
      title: r.p.resourceName ?? meta?.name ?? rec.title ?? null,
      author: meta?.author_name ?? rec.author ?? null,
      edition: rec.edition ?? null,
      publisher: rec.publisher ?? null,
      translator: rec.translator ?? null,
      abridgement: rec.abridgement ?? null,
      original: rec.original ?? null,
      language,
      provider: PROVIDER,
    };
    return { status: 200, data: { status: 'ok', lang: 'en', s, a, range: r.p.range, text: r.p.text, source, ...(r.marks ? { marks: r.marks } : {}) } };
  }

  // Body already read and checked by the caller (size, type, cross-site, rate limit).
  async function api(origin: string, raw: string, env: TafseerEnv): Promise<{ status: number; data: Record<string, unknown> }> {
    let b: unknown;
    try { b = JSON.parse(raw); } catch { return { status: 400, data: { status: 'bad_request' } }; }
    const o = (b ?? {}) as Record<string, unknown>;
    const s = o.s, a = o.a;
    // RQ-007: "l" is absent or "ar" for the Arabic work, "en" for the English work; nothing else.
    if (o.l !== undefined && o.l !== 'ar' && o.l !== 'en') return { status: 400, data: { status: 'bad_request' } };
    const lang: TafseerLang = o.l === 'en' ? 'en' : 'ar';
    const counts = cfg.counts ?? [];
    if (!Number.isInteger(s) || !Number.isInteger(a) || (s as number) < 1 || (a as number) < 1) return { status: 400, data: { status: 'bad_request' } };
    if (counts.length && ((s as number) >= counts.length || (a as number) > counts[s as number])) return { status: 400, data: { status: 'bad_request' } };
    served++;
    return answer(origin, env, s as number, a as number, lang);
  }

  // The development catalogue page (D-076 helper). Plain HTML with no script.
  async function catalogue(origin: string, env: TafseerEnv): Promise<{ status: number; html: string }> {
    const h = escapeHtml;
    const q = qfConfig(env, cfg.dev);
    const id = tafsirIdOf(env);
    const idEn = tafsirIdOf(env, 'en');
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
    const row = (x: TafsirListItem) => `<tr${ikArabic(x) ? ' class="match" data-ibn-kathir' : ''}${idEn !== null && x.id === idEn ? ' data-tafsir-en' : ''}><td>${x.id}</td><td>${h(x.name ?? 'not stated')}</td><td>${h(x.author_name ?? 'not stated')}</td><td>${h(x.language_name ?? 'not stated')}</td><td>${h(x.slug ?? '')}</td><td>${ikArabic(x) ? '<strong>Possible Ibn Kathir (D-076)</strong>' : looksLikeIbnKathir(x) ? 'Ibn Kathir name, not Arabic' : ''}</td></tr>`;
    const table = (rows: TafsirListItem[]) => `<table><thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">Author</th><th scope="col">Language</th><th scope="col">Slug</th><th scope="col">D-076</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
    const arabic = l.filter((x) => isArabic(x.language_name));
    const other = l.filter((x) => !isArabic(x.language_name));
    const ik = arabic.filter(looksLikeIbnKathir);
    const ikOther = other.filter(looksLikeIbnKathir);
    const english = other.filter((x) => isEnglish(x.language_name));
    const enEntry = idEn === null ? undefined : l.find((x) => x.id === idEn);
    const enLine = `<p>TAFSIR_EN_ID setting (RQ-007, D-136): <strong data-tafsir-en-id>${idEn === null ? 'not set' : String(idEn)}</strong>${idEn === null ? '' : enEntry ? `; in this list as ID ${enEntry.id}, language <strong data-tafsir-en-language>${h(enEntry.language_name ?? 'not stated')}</strong>, slug <strong data-tafsir-en-slug>${h(enEntry.slug ?? 'not stated')}</strong>, author <strong data-tafsir-en-author>${h(enEntry.author_name ?? 'not stated')}</strong> (row marked below)` : '; <strong>not in this list</strong>'}. The English interface shows only this work, and only if its language is "english" (RQ-007 AC9).</p>`;
    const ikNote = `<section aria-labelledby="ik"><h2 id="ik">D-076: Tafsir Ibn Kathir in Arabic</h2>
<p>Hamzeh chose Tafsir Ibn Kathir in Arabic. The Quran Foundation docs do not publish its ID, so TAFSIR_ID is not set. Arabic entries whose name, author or slug looks like Ibn Kathir: <strong data-ibn-kathir-count>${ik.length}</strong>${ik.length ? ' (IDs ' + ik.map((x) => x.id).join(', ') + ', marked below)' : ''}. Matches in other languages, not usable under D-077: ${ikOther.length}${ikOther.length ? ' (IDs ' + ikOther.map((x) => x.id).join(', ') + ')' : ''}.</p>
<p>Confirm the exact ID and edition (with the D-012 reviewer), then set TAFSIR_ID to that ID. This page matches by spelling only and is not a confirmation.</p></section>`;
    return { status: 200, html: `${head}
<p>API environment: <strong>${h(q.env)}</strong>. Pre-live data covers only surahs 1 and 2. Names, authors and languages are shown exactly as the API returns them, from <code>/resources/tafsirs</code>, kept for at most 7 days.</p>
<p>Response shape check: <a href="${SHAPE_PATH}">${SHAPE_PATH}</a> (keys, types and lengths only).</p>
<p>TAFSIR_ID setting: <strong>${id === null ? 'not set (D-076 open)' : String(id)}</strong>.</p>
${enLine}
${ikNote}
<h2>Arabic (D-077): ${arabic.length}</h2>
${arabic.length ? table(arabic) : '<p>None with language "arabic".</p>'}
<details open data-other-languages><summary>Other languages: ${other.length} (English: <span data-english-count>${english.length}</span>). Open by default (RQ-007 AC31). Only the TAFSIR_EN_ID work is shown to readers, in the English interface.</summary>${other.length ? table(other) : ''}</details>
<p>Choosing a work is Hamzeh's decision (D-076), with the D-012 reviewer. This list is not a recommendation.</p>${foot}` };
  }

  // Development page: the shape of one live by_ayah or by_chapter response (keys, types and string
  // lengths only, never content), to confirm the real response shape. Not cached.
  async function shape(env: TafseerEnv, params: URLSearchParams): Promise<{ status: number; html: string }> {
    const h = escapeHtml;
    const q = qfConfig(env, cfg.dev);
    const kind = params.get('kind') === 'chapter' ? 'chapter' : 'ayah';
    const idParam = params.get('id') ?? '';
    const id = /^[1-9][0-9]{0,8}$/.test(idParam) ? Number(idParam) : tafsirIdOf(env);
    const ref = /^(\d{1,3}):(\d{1,3})$/.exec(params.get('ref') ?? '');
    const sNum = Number(kind === 'chapter' ? params.get('s') ?? '' : ref?.[1] ?? '');
    const aNum = Number(ref?.[2] ?? '');
    const page = /^[1-9][0-9]{0,3}$/.test(params.get('page') ?? '') ? Number(params.get('page')) : 1;
    const counts = cfg.counts ?? [];
    const form = `<form method="get" action="${SHAPE_PATH}"><p><label>Kind <select name="kind"><option value="ayah"${kind === 'ayah' ? ' selected' : ''}>by_ayah</option><option value="chapter"${kind === 'chapter' ? ' selected' : ''}>by_chapter</option></select></label>
<label>Ayah (by_ayah) <input name="ref" value="${h(params.get('ref') ?? '2:3')}" size="7" dir="ltr"></label>
<label>Surah (by_chapter) <input name="s" value="${h(params.get('s') ?? '2')}" size="4" dir="ltr"></label>
<label>Page <input name="page" value="${page}" size="3" dir="ltr"></label>
<label>Tafsir ID (blank: TAFSIR_ID) <input name="id" value="${h(idParam)}" size="6" dir="ltr"></label>
<button type="submit">Show shape</button></p></form>`;
    const head = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DEVELOPMENT PAGE: Tafseer response shape - RIFQ</title><link rel="stylesheet" href="/rifq-basic.css"></head>
<body><p class="banner" role="note">DEVELOPMENT PAGE. Private, for Hamzeh only. Shows key paths, value types and string lengths of one live API response. No content is shown.</p><main>
<h1>Tafseer API response shape</h1>${form}`;
    const foot = '</main></body></html>';
    const fail = (status: number, msg: string) => ({ status, html: `${head}<p role="alert">${h(msg)}</p>${foot}` });
    if (!params.has('kind')) return { status: 200, html: `${head}<p>Choose an ayah or a surah and press Show shape. Each press makes one API request.</p>${foot}` };
    if ('missing' in q) return fail(503, 'Not configured. Missing Worker settings: ' + q.missing.join(', ') + '.');
    if (id === null) return fail(400, 'No tafsir ID: set TAFSIR_ID or enter one.');
    if (!Number.isInteger(sNum) || sNum < 1 || (counts.length && sNum >= counts.length)) return fail(400, 'That surah is not in the Quran source.');
    if (kind === 'ayah' && (!Number.isInteger(aNum) || aNum < 1 || (counts.length && aNum > counts[sNum]))) return fail(400, 'That ayah is not in the Quran source.');
    const path = kind === 'ayah' ? byAyahPath(id, sNum, aNum) : byChapterPath(id, sNum);
    const query: Record<string, string> = kind === 'ayah' ? { fields: 'language_name' } : { page: String(page), per_page: '50', fields: 'verse_key' };
    let j: unknown;
    try { j = await qf.get(q, path, query); } catch (e) {
      return fail(503, `The API request failed (${e instanceof QfError ? e.kind : 'unavailable'}).`);
    }
    const { lines, truncated } = shapeOf(j);
    let parsed = '';
    if (kind === 'ayah') {
      let p: Passage | null = null, err = '';
      try { p = parseByAyah(j, sNum, aNum); } catch (e) { err = e instanceof QfError ? e.kind : 'error'; }
      const t = (j as { tafsir?: { verses?: Record<string, { text?: unknown }> } })?.tafsir;
      const from = !p ? '' : typeof t?.verses?.[`${sNum}:${aNum}`]?.text === 'string' && (t!.verses![`${sNum}:${aNum}`].text as string).length > 0 ? 'tafsir.verses["S:A"].text' : 'tafsir.text';
      parsed = `<p data-shape-parser>RIFQ parser: ${err ? 'error ' + h(err) : p ? `passage found in ${h(from)}, ${[...p.text].length} characters, range ${p.range.s}:${p.range.from} to ${p.range.s}:${p.range.to}, resource_name ${p.resourceName === null ? 'absent' : 'present'}, language_name ${p.languageName === null ? 'absent' : h(JSON.stringify(p.languageName))}` : 'no non-empty text (shown to readers as "no Tafseer")'}.</p>`;
    }
    const row = (l: (typeof lines)[number]) => `<tr><td dir="ltr"><code>${h(l.path)}</code></td><td>${h(l.type)}</td><td>${l.count}</td><td>${l.minLen === undefined ? '' : l.minLen === l.maxLen ? l.minLen : `${l.minLen} to ${l.maxLen}`}</td><td>${l.length ?? ''}</td></tr>`;
    return { status: 200, html: `${head}
<p>Request: <code dir="ltr">${h(CONTENT_PATH_NOTE + path)}</code> (tafsir ${id}, ${h(q.env)}).</p>${parsed}
<table><thead><tr><th scope="col">Path</th><th scope="col">Type</th><th scope="col">Times seen</th><th scope="col">String length</th><th scope="col">Array length</th></tr></thead><tbody>${lines.map(row).join('')}</tbody></table>
${truncated ? '<p>Only the first 400 paths are shown.</p>' : ''}${foot}` };
  }

  return { api, catalogue, shape, client: qf, served: () => served };
}
