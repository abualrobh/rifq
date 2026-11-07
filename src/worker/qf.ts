// Quran Foundation API client for the Worker (D-020, D-075, RQ-005).
//
// What it relies on, and where each item was read (2026-11-08):
// - Token endpoints, API bases, the x-auth-token and x-client-id headers, the client_credentials
//   grant sent with HTTP Basic client authentication and a form body, the 3600-second lifetime with
//   no refresh token, and "re-request shortly before expiry; on a 401 clear the token, get a new one
//   and retry once": the Quick Start, https://api-docs.quran.foundation/docs/quickstart/
// - Token response fields access_token and expires_in: the OAuth2 token exchange reference.
// - Content path prefix /content/api/v4: the Quick Start example call.
// - Paths /tafsirs/{resource_id}/by_ayah/{ayah_key}, /tafsirs/{resource_id}/by_chapter/{chapter_number}
//   and /resources/tafsirs, and that all three take the granular scope content.tafsirs.read: the
//   Content API reference pages name the parameters, and the paths are from the operation catalogue
//   generated from Quran Foundation's API specs in their official SDK (github.com/quran/api-js,
//   packages/api/src/generated/specs/operation-catalog.json, commit 79a451e), because the reference
//   pages draw their path line in the browser and it could not be read as text.
// - Response shapes: the reference pages (see the parse functions below). Their examples did not
//   render, so no real response has been seen. Nothing here has been run against the real API.
//
// Rules kept here: credentials and tokens never leave this file except in the two request headers
// and the token request; nothing is logged (there is no console call); no header from the reader's
// request is forwarded (each request is built from scratch); only content.tafsirs.read is asked for.

export type QfEnvName = 'prelive' | 'production';
export type QfSecrets = { QF_CLIENT_ID?: string; QF_CLIENT_SECRET?: string; QF_ENV?: string; QF_TEST_BASE?: string };

export const QF_URLS: Record<QfEnvName, { token: string; api: string }> = {
  prelive: { token: 'https://prelive-oauth2.quran.foundation/oauth2/token', api: 'https://apis-prelive.quran.foundation' },
  production: { token: 'https://oauth2.quran.foundation/oauth2/token', api: 'https://apis.quran.foundation' },
};
export const SCOPE = 'content.tafsirs.read';
// D-081 text verification only (development page): the granted scope for Quran text.
export const QURAN_SCOPE = 'content.quran.read';
export const CONTENT_PREFIX = '/content/api/v4';
// The documented lifetime (Quick Start). Used only if a token response gives no usable expires_in.
export const DOCUMENTED_TOKEN_SECONDS = 3600;
// Proposal: ask for a new token 5 minutes before the old one expires ("shortly before expiry").
export const REFRESH_MARGIN_MS = 5 * 60_000;
// Proposal: give up on one API call after 6 seconds and show the "unavailable" message (AC10).
export const TIMEOUT_MS = 6000;

export type QfConfig = { env: QfEnvName; tokenUrl: string; apiBase: string; clientId: string; clientSecret: string };

// Reads the Worker settings. QF_TEST_BASE (a local mock) is honoured only in development builds and
// only for an http://127.0.0.1:<port> address, so it can never point a deployed Worker elsewhere.
export function qfConfig(env: QfSecrets, allowTestBase: boolean): QfConfig | { missing: string[] } {
  const missing: string[] = [];
  const id = typeof env.QF_CLIENT_ID === 'string' ? env.QF_CLIENT_ID.trim() : '';
  const secret = typeof env.QF_CLIENT_SECRET === 'string' ? env.QF_CLIENT_SECRET : '';
  const name = env.QF_ENV === 'prelive' || env.QF_ENV === 'production' ? env.QF_ENV : null;
  if (!id) missing.push('QF_CLIENT_ID');
  if (!secret) missing.push('QF_CLIENT_SECRET');
  if (!name) missing.push('QF_ENV');
  if (missing.length || !name) return { missing };
  let { token, api } = QF_URLS[name];
  const tb = typeof env.QF_TEST_BASE === 'string' ? env.QF_TEST_BASE : '';
  if (tb && allowTestBase && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(tb)) { token = tb + '/oauth2/token'; api = tb; }
  return { env: name, tokenUrl: token, apiBase: api, clientId: id, clientSecret: secret };
}

export type QfFailure = 'auth' | 'rate_limited' | 'unavailable' | 'not_found' | 'bad_response';
export class QfError extends Error {
  kind: QfFailure;
  constructor(kind: QfFailure) { super(kind); this.kind = kind; this.name = 'QfError'; }
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

function basic(id: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${id}:${secret}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}

async function timed(f: FetchFn, url: string, init: RequestInit, ms: number): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(ms), redirect: 'manual' });
  } catch {
    throw new QfError('unavailable');
  }
}

// One access token per isolate, kept in memory only. Concurrent callers share one token request.
export class QfClient {
  // One token per scope: Tafseer calls only ever use a content.tafsirs.read token (AC16).
  private tokens = new Map<string, { value: string; expires: number; key: string }>();
  private pending = new Map<string, Promise<string>>();
  private fetchFn: FetchFn;
  private now: () => number;
  private timeoutMs: number;
  tokenRequests = 0; // count only, for tests

  constructor(fetchFn?: FetchFn, now: () => number = Date.now, timeoutMs = TIMEOUT_MS) {
    this.fetchFn = fetchFn ?? ((u, i) => fetch(u, i));
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  clearToken(scope = SCOPE) { this.tokens.delete(scope); }

  async accessToken(cfg: QfConfig, scope = SCOPE): Promise<string> {
    const key = `${cfg.env}|${cfg.tokenUrl}|${cfg.clientId}`;
    const t = this.tokens.get(scope);
    if (t && t.key === key && this.now() < t.expires - REFRESH_MARGIN_MS) return t.value;
    const p = this.pending.get(scope);
    if (p) return p;
    const np = this.requestToken(cfg, key, scope).finally(() => { this.pending.delete(scope); });
    this.pending.set(scope, np);
    return np;
  }

  private async requestToken(cfg: QfConfig, key: string, scope: string): Promise<string> {
    this.tokenRequests++;
    const r = await timed(this.fetchFn, cfg.tokenUrl, {
      method: 'POST',
      headers: { authorization: basic(cfg.clientId, cfg.clientSecret), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
    }, this.timeoutMs);
    if (r.status === 429) { await r.body?.cancel(); throw new QfError('rate_limited'); }
    if (r.status === 400 || r.status === 401 || r.status === 403) { await r.body?.cancel(); throw new QfError('auth'); }
    if (!r.ok) { await r.body?.cancel(); throw new QfError('unavailable'); }
    let j: unknown;
    try { j = await r.json(); } catch { throw new QfError('bad_response'); }
    const o = (j ?? {}) as Record<string, unknown>;
    if (typeof o.access_token !== 'string' || !o.access_token) throw new QfError('bad_response');
    const secs = typeof o.expires_in === 'number' && o.expires_in > 0 ? o.expires_in : DOCUMENTED_TOKEN_SECONDS;
    this.tokens.set(scope, { value: o.access_token, expires: this.now() + secs * 1000, key });
    return o.access_token;
  }

  // GET on the content API. A 401 clears the token, gets a new one and retries once (Quick Start).
  async get(cfg: QfConfig, path: string, query: Record<string, string> = {}, scope = SCOPE): Promise<unknown> {
    const qs = new URLSearchParams(query).toString();
    const url = cfg.apiBase + CONTENT_PREFIX + path + (qs ? '?' + qs : '');
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await this.accessToken(cfg, scope);
      const r = await timed(this.fetchFn, url, {
        method: 'GET',
        headers: { 'x-auth-token': tok, 'x-client-id': cfg.clientId, accept: 'application/json' },
      }, this.timeoutMs);
      if (r.status === 401 && attempt === 0) { await r.body?.cancel(); this.clearToken(scope); continue; }
      if (r.status === 404) { await r.body?.cancel(); throw new QfError('not_found'); }
      if (r.status === 429) { await r.body?.cancel(); throw new QfError('rate_limited'); }
      if (r.status === 401 || r.status === 403) { await r.body?.cancel(); throw new QfError('auth'); }
      if (!r.ok) { await r.body?.cancel(); throw new QfError('unavailable'); }
      try { return await r.json(); } catch { throw new QfError('bad_response'); }
    }
    throw new QfError('auth');
  }
}

// ---- Response parsing. Only fields named in the reference pages are read. ----

export type TafsirListItem = { id: number; name: string | null; author_name: string | null; slug: string | null; language_name: string | null; translated_name: { name: string | null; language_name: string | null } | null };

const str = (v: unknown) => (typeof v === 'string' ? v : null);

// GET /resources/tafsirs: { tafsirs: [{ id, name, author_name, slug, language_name,
// translated_name: { name, language_name } }] } (reference page "Tafsirs").
export function parseTafsirList(j: unknown): TafsirListItem[] {
  const arr = (j as { tafsirs?: unknown })?.tafsirs;
  if (!Array.isArray(arr)) throw new QfError('bad_response');
  const out: TafsirListItem[] = [];
  for (const x of arr) {
    const o = (x ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(o.id)) continue;
    const tn = o.translated_name && typeof o.translated_name === 'object' ? (o.translated_name as Record<string, unknown>) : null;
    out.push({ id: o.id as number, name: str(o.name), author_name: str(o.author_name), slug: str(o.slug), language_name: str(o.language_name), translated_name: tn ? { name: str(tn.name), language_name: str(tn.language_name) } : null });
  }
  return out;
}

export const isArabic = (language: string | null | undefined) => typeof language === 'string' && language.trim().toLowerCase() === 'arabic';

export type Passage = { text: string; resourceName: string | null; languageName: string | null; range: { s: number; from: number; to: number } };

// GET /tafsirs/{resource_id}/by_ayah/{ayah_key}. Reference page "Get tafsirs for specific Ayah":
// { tafsir: { verses: { "<ayah_key>": { id, resource_id, resource_name, language_id, slug,
// translated_name: { name, language_name }, text } } } }, where verses is a "Hash map of
// ayah_key -> tafsir-record" and text is the "HTML-formatted tafsir body". The page's examples did
// not render, so this nesting is read from the schema list and is UNVERIFIED.
// language_name is one of the documented optional `fields`, so it is requested and read if present.
//
// Covered range (AC3): the reference does not say how a passage that covers several ayat is
// returned. This build counts as the range the unbroken run of keys in `verses`, in the same surah
// and around the requested ayah, whose text is byte-identical to the requested one. If the API
// marks ranges another way, this needs changing once a real response is seen.
export function parseByAyah(j: unknown, s: number, a: number): Passage | null {
  const t = (j as { tafsir?: unknown })?.tafsir;
  if (!t || typeof t !== 'object') throw new QfError('bad_response');
  const verses = (t as { verses?: unknown }).verses;
  if (!verses || typeof verses !== 'object' || Array.isArray(verses)) throw new QfError('bad_response');
  const v = verses as Record<string, unknown>;
  const rec = v[`${s}:${a}`] as Record<string, unknown> | undefined;
  if (!rec || typeof rec !== 'object' || typeof rec.text !== 'string' || rec.text.length === 0) return null;
  const text = rec.text;
  const same = (n: number) => {
    const r = v[`${s}:${n}`] as Record<string, unknown> | undefined;
    return !!r && typeof r === 'object' && r.text === text;
  };
  let from = a, to = a;
  while (from > 1 && same(from - 1)) from--;
  while (same(to + 1)) to++;
  return { text, resourceName: str(rec.resource_name), languageName: str(rec.language_name), range: { s, from, to } };
}

// GET /tafsirs/{resource_id}/by_chapter/{chapter_number}: { tafsirs: [{ ..., verse_key, text, ... }],
// pagination: { per_page, current_page, next_page, total_pages, total_records } } (reference page
// "Get tafsirs for specific Surah"). Used by the release check only.
export function parseByChapter(j: unknown): { items: { verse_key: string; text: string }[]; next: number | null } {
  const o = (j ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.tafsirs)) throw new QfError('bad_response');
  const items: { verse_key: string; text: string }[] = [];
  for (const x of o.tafsirs) {
    const r = (x ?? {}) as Record<string, unknown>;
    if (typeof r.verse_key === 'string' && typeof r.text === 'string') items.push({ verse_key: r.verse_key, text: r.text });
  }
  const p = (o.pagination ?? {}) as Record<string, unknown>;
  const next = Number.isInteger(p.next_page) && (p.next_page as number) > 0 ? (p.next_page as number) : null;
  return { items, next };
}

export const byAyahPath = (tafsirId: number, s: number, a: number) => `/tafsirs/${tafsirId}/by_ayah/${s}:${a}`;
export const byChapterPath = (tafsirId: number, s: number) => `/tafsirs/${tafsirId}/by_chapter/${s}`;
export const LIST_PATH = '/resources/tafsirs';

// D-081. GET /verses/by_chapter/{chapter_number}?fields=text_qpc_hafs&per_page=50&page=N:
// { verses: [{ id, verse_key, verse_number, ..., <fields> }], pagination: { ..., next_page, ... } }
// (reference page "By Chapter"). text_qpc_hafs is a verse-level field in the Field Reference
// (no description there); the Font Rendering guide pairs it with the QPC Hafs font
// UthmanicHafs1Ver18 (Mushaf ID 5). No page says it is the King Fahd Complex file: UNVERIFIED.
export const QPC_FIELD = 'text_qpc_hafs';
export const versesByChapterPath = (s: number) => `/verses/by_chapter/${s}`;
export function parseVersesByChapter(j: unknown, field = QPC_FIELD): { items: { verse_key: string; text: string | null }[]; next: number | null } {
  const o = (j ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.verses)) throw new QfError('bad_response');
  const items: { verse_key: string; text: string | null }[] = [];
  for (const x of o.verses) {
    const r = (x ?? {}) as Record<string, unknown>;
    if (typeof r.verse_key === 'string') items.push({ verse_key: r.verse_key, text: typeof r[field] === 'string' ? (r[field] as string) : null });
  }
  const p = (o.pagination ?? {}) as Record<string, unknown>;
  const next = Number.isInteger(p.next_page) && (p.next_page as number) > 0 ? (p.next_page as number) : null;
  return { items, next };
}
