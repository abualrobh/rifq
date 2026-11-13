// RIFQ Worker (D-054, D-057). It answers /api/*; every other path is a static asset.
// It stores nothing and logs nothing: there is no console call in this file on purpose, and
// scripts/check-no-quran.ts plus test/unit/worker.test.ts check that no logging call is added.
// With the build flag gate on (cfg.gate), every request, assets included, must pass HTTP Basic
// auth first (src/worker/gate.ts). The build then sets run_worker_first: true so no asset is served
// without the Worker, and the Worker adds the security headers itself, because the platform does not
// apply _headers to responses the Worker returns. Failed sign-ins are limited per network address
// with a lockout (D-071, M-2), and the gate fails closed if that limit cannot be checked.
// With the build flag tafseer on (cfg.tafseer), POST /api/tafseer answers for one ayah from the
// Quran Foundation API (RQ-005, src/worker/tafseer.ts), and development builds with the gate on
// also serve the private catalogue page used to decide D-076.
// Every rate limit binding fails closed (D-095, S-1): if SEARCH_LIMIT or TAFSEER_LIMIT is missing or
// its limit() call throws, the request gets 503 with the full header set and no upstream call is
// made, as the gate does for AUTH_LIMIT. Any other thrown error also becomes a fixed 503 with the
// same headers, so the platform's error page never goes out.
import { handleJson, MAX_BODY, runQuery, type ApiOut } from '../core/api.ts';
import { MemoryLimiter, SERVER_LIMIT, WINDOW_MS } from '../core/ratelimit.ts';
import { openIndex } from '../core/search-core.ts';
import type { Lang } from '../core/strings.ts';
import { authorised, REALM, SignInGuard, type GateEnv, type RateLimit } from './gate.ts';
import { renderPage, type PageCfg } from './page.ts';
import { makeVerify, type VerifyHashes } from './verify.ts';
import { makeQuoteCheck, type LettersQuran } from './quote-check.ts';
import { makeReciters, RECITERS_PATH } from './reciters.ts';
import { AUDIO_LIMIT_PER_MINUTE, makeAudio, type AudioRecord } from './audio.ts';
import { AUDIO_ORIGIN } from '../core/audio.ts';
import { CATALOGUE_PATH, SHAPE_PATH, makeTafseer, TAFSEER_LIMIT_PER_MINUTE, type TafseerCfg, type TafseerEnv } from './tafseer.ts';

// testMemoryLimits: unit tests only. It lets tests that pass no binding use per-isolate counters
// (serverLimit, tafseerLimit). scripts/build.ts never sets it, so deployed builds have no fallback.
export type WorkerCfg = PageCfg & TafseerCfg & { serverLimit?: number; gate?: boolean; assetHeaders?: Record<string, string>; tafseer?: boolean; tafseerLimit?: number; testMemoryLimits?: boolean; verifyHashes?: VerifyHashes | null; lettersQuran?: LettersQuran | null; audio?: boolean; audioLimit?: number; audioRecord?: AudioRecord | null };
export type Env = GateEnv & TafseerEnv & { ASSETS?: { fetch(r: Request): Promise<Response> }; SEARCH_LIMIT?: RateLimit; AUTH_LIMIT?: RateLimit; TAFSEER_LIMIT?: RateLimit; AUDIO_LIMIT?: RateLimit };
export type WorkerDeps = Parameters<typeof makeTafseer>[1];

const BASE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
const PRIVATE_CACHE = 'private, no-store';
const JSON_CSP = "default-src 'none'; frame-ancestors 'none'";
const HTML_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const MAX_FORM = 8192;
const RETRY = String(Math.ceil(WINDOW_MS / 1000));

function json(status: number, data: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-security-policy': JSON_CSP, ...extra },
  });
}

function html(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': HTML_CSP, ...extra },
  });
}

// Reads at most cap bytes of the body as a stream (D-071, L-1). A declared length over the cap is
// refused before reading, and an undeclared or understated body is cut off as soon as it passes
// the cap, so no request can make the Worker hold more than cap bytes.
// Returns null when the body is too long, and 'bad_length' when content-length is not a number.
export async function readCapped(req: Request, cap: number): Promise<string | null | 'bad_length'> {
  const cl = req.headers.get('content-length');
  if (cl !== null && !/^\d{1,15}$/.test(cl.trim())) return 'bad_length';
  if (cl !== null && Number(cl) > cap) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

// The limit key (D-061): the client address as Cloudflare gives it. IPv6 clients usually hold a
// whole /64, so for IPv6 the key is the /64 prefix (D-071, L-3); IPv4 keeps the full address.
// The key is used only for the limit counts and is never stored or logged by RIFQ.
export function netKey(req: Request): string {
  const ip = (req.headers.get('cf-connecting-ip') ?? '').trim();
  if (!ip) return 'local';
  if (!ip.includes(':')) return ip;
  const v4 = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip); // IPv4-mapped IPv6
  if (v4) return v4[1];
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  if (ip.includes('::')) while (h.length + t.length < 8) h.push('0');
  const groups = [...h, ...t].slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''));
  return groups.join(':') + '::/64';
}

// D-071, L-4: refuse search requests sent by another site. Browsers send Sec-Fetch-Site and Origin;
// a request with neither (curl, the e2e request API) is not a browser cross-site request. With
// Referrer-Policy no-referrer, browsers send "Origin: null" on the site's own form posts, so
// "null" decides nothing and Sec-Fetch-Site is used for those.
function crossSite(req: Request): boolean {
  if ((req.headers.get('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') return true;
  const origin = req.headers.get('origin');
  if (origin === null || origin === 'null') return false;
  return origin !== new URL(req.url).origin;
}

// The 401 answer: a short body, no-store, the security headers and the Basic challenge.
export function unauthorised(): Response {
  return new Response('Authentication required.\n', {
    status: 401,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': JSON_CSP, 'www-authenticate': REALM },
  });
}

// Too many failed sign-ins from this network address: locked for the rest of the window. No Basic
// challenge, so the browser does not ask again straight away.
export function lockedOut(retry: number): Response {
  return new Response('Too many failed sign-in attempts. Try again later.\n', {
    status: 429,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': JSON_CSP, 'retry-after': String(retry) },
  });
}

// The sign-in limit could not be checked (binding missing or failing): refuse (fail closed).
export function gateUnavailable(): Response {
  return new Response('The test site is not available right now.\n', {
    status: 503,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': JSON_CSP, 'retry-after': '60' },
  });
}

// A rate limit binding is missing or failing (D-095), or the Worker hit an unexpected error: refuse
// with a fixed body and the full header set. Nothing is sent upstream.
export function unavailable(): Response {
  return new Response('Not available right now. Try again later.\n', {
    status: 503,
    headers: { ...BASE_HEADERS, 'cache-control': PRIVATE_CACHE, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': JSON_CSP, 'retry-after': '60' },
  });
}

export type LimitVerdict = 'ok' | 'limited' | 'unavailable';

// One rate limit check (D-095). The binding decides when it works. Missing, without a limit
// function, or throwing: 'unavailable' (fail closed). The memory counter is used only when a unit
// test asked for it (cfg.testMemoryLimits) and passed no binding.
export async function checkLimit(binding: RateLimit | undefined, key: string, mem: MemoryLimiter | null): Promise<LimitVerdict> {
  if (binding !== undefined && binding !== null) {
    if (typeof binding.limit !== 'function') return 'unavailable';
    try { return (await binding.limit({ key })).success === true ? 'ok' : 'limited'; } catch { return 'unavailable'; }
  }
  if (mem) return mem.allow(key) ? 'ok' : 'limited';
  return 'unavailable';
}

// Copies a response so its headers can be changed (asset responses have immutable headers).
function withHeaders(r: Response, set: Record<string, string>): Response {
  const out = new Response(r.body, r);
  for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
  return out;
}

const MAX_TAFSEER_BODY = 256;
export const FONT_CHECK_PATH = '/dev/font-check/';
// Documented in the Font Rendering guide: https://verses.quran.foundation/fonts/quran/...
export const QF_FONT_ORIGIN = 'https://verses.quran.foundation';
// RQ-006 AC39: reader pages (/N/ and /en/N/) are the only pages whose policy lists the audio host.
export const READER_PAGE = /^\/(?:en\/)?\d{1,3}\/?$/;
const MAX_AUDIO_BODY = 256;

export function makeWorker(indexBuf: ArrayBuffer, cfg: WorkerCfg, deps: WorkerDeps = {}) {
  const ix = openIndex(indexBuf);
  const mem = cfg.testMemoryLimits === true ? new MemoryLimiter(cfg.serverLimit ?? SERVER_LIMIT, WINDOW_MS) : null;
  const tfMem = cfg.testMemoryLimits === true ? new MemoryLimiter(cfg.tafseerLimit ?? TAFSEER_LIMIT_PER_MINUTE, WINDOW_MS) : null;
  const tafseer = cfg.tafseer ? makeTafseer(cfg, deps) : null;
  const catalogueOn = !!(tafseer && cfg.dev && cfg.gate);
  // RQ-006 preparation (D-110 to D-118): the reciters and timing check page, on the same terms as
  // the catalogue (development builds behind the gate, with the Tafseer client's credentials).
  // RQ-006: audio metadata routes when the build flag audio is on (src/worker/audio.ts).
  const audio = cfg.audio ? makeAudio({ dev: cfg.dev, counts: cfg.counts, audioRecord: cfg.audioRecord ?? null }, deps) : null;
  const auMem = cfg.testMemoryLimits === true ? new MemoryLimiter(cfg.audioLimit ?? AUDIO_LIMIT_PER_MINUTE, WINDOW_MS) : null;
  const reciters = catalogueOn && tafseer ? makeReciters({ dev: cfg.dev, counts: cfg.counts }, { ...deps, client: tafseer.client }) : null;
  // D-081: development builds behind the password gate only.
  const verify = cfg.dev && cfg.gate && cfg.verifyHashes ? makeVerify(cfg.verifyHashes, cfg.dev, deps) : null;
  // D-084 quote check page: development builds behind the gate, with Tafseer on.
  const quotes = cfg.dev && cfg.gate && tafseer && cfg.lettersQuran ? makeQuoteCheck(cfg.lettersQuran, cfg.dev, deps) : null;
  const guard = new SignInGuard();
  const assetHeaders = cfg.assetHeaders ? { ...BASE_HEADERS, ...cfg.assetHeaders } : null;
  if (assetHeaders) delete (assetHeaders as Record<string, string>)['cache-control'];

  async function handle(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    // D-076 helper: development builds behind the password gate only.
    if (catalogueOn && tafseer && (pathname === CATALOGUE_PATH || pathname === CATALOGUE_PATH.slice(0, -1))) {
      if (req.method !== 'GET') return json(405, { error: 'method' }, { allow: 'GET' });
      // D-096, S-2: another site cannot make a tester's browser spend API calls here.
      if (crossSite(req)) return json(403, { error: 'cross_site' });
      const v = await checkLimit(env.TAFSEER_LIMIT, netKey(req), tfMem);
      if (v === 'unavailable') return unavailable();
      if (v === 'limited') return json(429, { error: 'rate_limited' }, { 'retry-after': RETRY });
      const c = await tafseer.catalogue(url.origin, env);
      return html(c.status, c.html);
    }
    if (reciters && (pathname === RECITERS_PATH || pathname === RECITERS_PATH.slice(0, -1))) {
      if (req.method !== 'GET') return json(405, { error: 'method' }, { allow: 'GET' });
      if (crossSite(req)) return json(403, { error: 'cross_site' });
      const v = await checkLimit(env.TAFSEER_LIMIT, netKey(req), tfMem);
      if (v === 'unavailable') return unavailable();
      if (v === 'limited') return json(429, { error: 'rate_limited' }, { 'retry-after': RETRY });
      // Temporary (after the kit v22 report): the checks the player uses, and the AUDIO_LIMIT state.
      let extra = '';
      if (audio) {
        const h = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        const b = env.AUDIO_LIMIT as unknown as { limit?: unknown } | undefined;
        const binding = b === undefined || b === null ? 'missing (the audio routes answer 503)' : typeof b.limit !== 'function' ? 'present, but it has no limit() (the audio routes answer 503)' : `present; one check now: ${await checkLimit(env.AUDIO_LIMIT, netKey(req), auMem)}`;
        const d = await audio.diagnose(url.origin, env);
        const rows = d.reciters.flatMap((r) => r.surahs.length ? r.surahs.map((x) => `<tr data-diag="${r.id}:${x.s}" data-ok="${x.ok ? 'yes' : 'no'}"><td>${r.id}</td><td>${h(Array.isArray(r.catalogue) ? (r.catalogue.join('; ') || 'passes') : r.catalogue)}</td><td>${x.s}</td><td>${x.ok ? 'passes' : '<strong>fails</strong>'}</td><td>${h(x.problems.join('; '))}</td><td>${x.negatives}</td><td data-last-vs-duration>${x.shape ? h(`last ${JSON.stringify(x.shape.last)}; duration ${JSON.stringify(x.shape.duration)}; last end minus duration ${x.shape.lastEndMinusDuration ?? 'n/a'} ms`) : ''}</td><td data-url-path>${x.shape ? h(`${x.shape.urlPath ?? 'none'}${x.shape.urlHasQuery ? ' (has a query string, not shown)' : ''}`) : ''}</td></tr>`) : [`<tr data-diag="${r.id}"><td>${r.id}</td><td>${h(Array.isArray(r.catalogue) ? r.catalogue.join('; ') : r.catalogue)}</td><td colspan="4"></td></tr>`]).join('');
        extra = `<section aria-labelledby="pc"><h2 id="pc">Player check (RQ-006, temporary)</h2>
<p>The same checks the reader page player uses (AC59 catalogue, AC12/AC60 timings, AC61 file, approved host), run fresh on this page load.</p>
<p>AUDIO_LIMIT binding: <strong data-audio-limit>${h(binding)}</strong>.</p>
<p>Settings: ${h(d.config)}. Offered to the player now: <strong data-offered>${h(Array.isArray(d.offered) ? (d.offered.join(', ') || 'none') : d.offered)}</strong>.</p>
<table data-diag-table><thead><tr><th scope="col">ID</th><th scope="col">Catalogue (AC59)</th><th scope="col">Surah</th><th scope="col">Result</th><th scope="col">Problems</th><th scope="col">Negative durations</th><th scope="col">Last [from, to] vs duration</th><th scope="col">Address path ({s} = surah)</th></tr></thead><tbody>${rows}</tbody></table>
<h3>Record shape (D-125 B)</h3>
<p>Copy this block for the test fixtures. It holds types, counts, the first and last timing, and the address path only: no query string, no Quran text, no word segments, no audio.</p>
<pre data-record-shape>${h(JSON.stringify({ env: d.config, reciters: d.reciters.map((r) => ({ id: r.id, catalogue: r.catalogue, surahs: r.surahs.map((x) => ({ s: x.s, ok: x.ok, problems: x.problems, negatives: x.negatives, shape: x.shape ?? null })) })) }, null, 1))}</pre></section>`;
      }
      const c = await reciters.page(env, extra);
      return html(c.status, c.html);
    }
    if (catalogueOn && tafseer && (pathname === SHAPE_PATH || pathname === SHAPE_PATH.slice(0, -1))) {
      if (req.method !== 'GET') return json(405, { error: 'method' }, { allow: 'GET' });
      if (crossSite(req)) return json(403, { error: 'cross_site' });
      const v = await checkLimit(env.TAFSEER_LIMIT, netKey(req), tfMem);
      if (v === 'unavailable') return unavailable();
      if (v === 'limited') return json(429, { error: 'rate_limited' }, { 'retry-after': RETRY });
      const c = await tafseer.shape(env, url.searchParams);
      return html(c.status, c.html);
    }
    if (!pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        const r = await env.ASSETS.fetch(req);
        if (!assetHeaders) return r;
        // Font check page (development builds only): the one page allowed to load the QPC Hafs font
        // from Quran Foundation's documented font address.
        if (cfg.dev && (pathname === FONT_CHECK_PATH || pathname === FONT_CHECK_PATH.slice(0, -1))) {
          const csp = (assetHeaders['Content-Security-Policy'] ?? '').replace("font-src 'self'", `font-src 'self' ${QF_FONT_ORIGIN}`);
          return withHeaders(r, { ...assetHeaders, 'Content-Security-Policy': csp });
        }
        if (audio && READER_PAGE.test(pathname)) {
          const csp = `${assetHeaders['Content-Security-Policy'] ?? ''}; media-src ${AUDIO_ORIGIN}`;
          return withHeaders(r, { ...assetHeaders, 'Content-Security-Policy': csp });
        }
        return withHeaders(r, assetHeaders);
      }
      return new Response('Not found', { status: 404, headers: BASE_HEADERS });
    }
    if (pathname === '/api/dev/quote-check' && quotes) {
      if (req.method !== 'POST') return json(405, { status: 'method' }, { allow: 'POST' });
      if (!/^application\/json\s*(;|$)/.test((req.headers.get('content-type') ?? '').toLowerCase())) return json(415, { status: 'unsupported_type' });
      if (crossSite(req)) return json(403, { status: 'cross_site' });
      const v = await checkLimit(env.TAFSEER_LIMIT, netKey(req), tfMem);
      if (v === 'unavailable') return unavailable();
      if (v === 'limited') return json(429, { status: 'rate_limited' }, { 'retry-after': RETRY });
      const raw = await readCapped(req, MAX_TAFSEER_BODY);
      let s = 0;
      try { s = typeof raw === 'string' ? Number((JSON.parse(raw) as { s?: unknown }).s) : 0; } catch { s = 0; }
      const out = await quotes.surah(env, s);
      return json(out.status, out.data);
    }
    if (pathname === '/api/dev/verify-text' && verify) {
      if (req.method !== 'POST') return json(405, { status: 'method' }, { allow: 'POST' });
      if (!/^application\/json\s*(;|$)/.test((req.headers.get('content-type') ?? '').toLowerCase())) return json(415, { status: 'unsupported_type' });
      if (crossSite(req)) return json(403, { status: 'cross_site' });
      const v = await checkLimit(env.TAFSEER_LIMIT, netKey(req), tfMem);
      if (v === 'unavailable') return unavailable();
      if (v === 'limited') return json(429, { status: 'rate_limited' }, { 'retry-after': RETRY });
      const raw = await readCapped(req, MAX_TAFSEER_BODY);
      let s = 0;
      try { s = typeof raw === 'string' ? Number((JSON.parse(raw) as { s?: unknown }).s) : 0; } catch { s = 0; }
      const out = await verify.surah(env, s);
      return json(out.status, out.data);
    }
    if ((pathname === '/api/audio' || pathname === '/api/audio/reciters') && audio) {
      if (req.method !== 'POST') return json(405, { status: 'method' }, { allow: 'POST' });
      if (!/^application\/json\s*(;|$)/.test((req.headers.get('content-type') ?? '').toLowerCase())) return json(415, { status: 'unsupported_type' });
      if (crossSite(req)) return json(403, { status: 'cross_site' });
      const v = await checkLimit(env.AUDIO_LIMIT, netKey(req), auMem);
      if (v === 'unavailable') return json(503, { status: 'unavailable' }, { 'retry-after': '60' });
      if (v === 'limited') return json(429, { status: 'rate_limited' }, { 'retry-after': RETRY });
      const raw = await readCapped(req, MAX_AUDIO_BODY);
      if (raw === 'bad_length') return json(400, { status: 'bad_length' });
      if (raw === null) return json(413, { status: 'too_long' });
      const out = pathname === '/api/audio' ? await audio.file(url.origin, raw, env) : await audio.reciters(url.origin, raw, env);
      return json(out.status, out.data);
    }
    if (pathname === '/api/tafseer' && tafseer) {
      if (req.method !== 'POST') return json(405, { status: 'method' }, { allow: 'POST' });
      if (!/^application\/json\s*(;|$)/.test((req.headers.get('content-type') ?? '').toLowerCase())) return json(415, { status: 'unsupported_type' });
      if (crossSite(req)) return json(403, { status: 'cross_site' });
      const v = await checkLimit(env.TAFSEER_LIMIT, netKey(req), tfMem);
      if (v === 'unavailable') return json(503, { status: 'unavailable' }, { 'retry-after': '60' });
      if (v === 'limited') return json(429, { status: 'rate_limited' }, { 'retry-after': RETRY });
      const raw = await readCapped(req, MAX_TAFSEER_BODY);
      if (raw === 'bad_length') return json(400, { status: 'bad_length' });
      if (raw === null) return json(413, { status: 'too_long' });
      const out = await tafseer.api(url.origin, raw, env);
      return json(out.status, out.data);
    }
    if (pathname !== '/api/search') return json(404, { error: 'not_found' });
    if (req.method !== 'POST') return json(405, { error: 'method' }, { allow: 'POST' });

    const type = (req.headers.get('content-type') ?? '').toLowerCase();
    const form = type.startsWith('application/x-www-form-urlencoded');
    // D-071, L-4: the JSON path takes JSON only, and no path answers another site's request.
    if (!form && !/^application\/json\s*(;|$)/.test(type)) return json(415, { error: 'unsupported_type' });
    if (crossSite(req)) return json(403, { error: 'cross_site' });
    // D-095: SEARCH_LIMIT fails closed too. Searching never calls an upstream API.
    const verdict = await checkLimit(env.SEARCH_LIMIT, netKey(req), mem);
    if (verdict === 'unavailable' && !form) return json(503, { error: 'unavailable' }, { 'retry-after': '60' });
    const allowed = verdict === 'ok';

    const read = await readCapped(req, form ? MAX_FORM : MAX_BODY * 4);
    if (read === 'bad_length') return json(400, { error: 'bad_length' });
    const raw = read;
    if (form) {
      const p = new URLSearchParams(raw ?? '');
      const lang: Lang = p.get('lang') === 'en' ? 'en' : 'ar';
      const q = raw === null ? '' : (p.get('q') ?? '');
      if (verdict === 'unavailable') {
        return html(503, renderPage(lang, q, { status: 503, data: { error: 'unavailable' } }, cfg), { 'retry-after': '60' });
      }
      if (!allowed) {
        return html(429, renderPage(lang, q, { status: 429, data: { error: 'rate_limited' } }, cfg), { 'retry-after': RETRY });
      }
      const out: ApiOut = raw === null ? { status: 413, data: { error: 'too_long' } } : runQuery(ix, q, Number(p.get('page') ?? '1'));
      return html(out.status, renderPage(lang, q, out, cfg));
    }
    if (!allowed) return json(429, { error: 'rate_limited' }, { 'retry-after': RETRY });
    if (raw === null) return json(413, { error: 'too_long' });
    const out = handleJson(ix, raw);
    return json(out.status, out.data);
  }

  return {
    // D-095: any thrown error becomes the fixed 503 with the full header set.
    async fetch(req: Request, env: Env): Promise<Response> {
      try {
        if (!cfg.gate) return await handle(req, env);
        const v = await guard.check(req, env, netKey(req), authorised);
        if (v.kind === 'unavailable') return gateUnavailable();
        if (v.kind === 'locked') return lockedOut(v.retry);
        if (v.kind === 'denied') return unauthorised();
        return withHeaders(await handle(req, env), { 'cache-control': PRIVATE_CACHE });
      } catch {
        return unavailable();
      }
    },
  };
}
