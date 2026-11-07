// RIFQ Worker (D-054, D-057). It answers /api/*; every other path is a static asset.
// It stores nothing and logs nothing: there is no console call in this file on purpose, and
// scripts/check-no-quran.ts plus test/unit/worker.test.ts check that no logging call is added.
// With the build flag gate on (cfg.gate), every request, assets included, must pass HTTP Basic
// auth first (src/worker/gate.ts). The build then sets run_worker_first: true so no asset is served
// without the Worker, and the Worker adds the security headers itself, because the platform does not
// apply _headers to responses the Worker returns. Failed sign-ins are limited per network address
// with a lockout (D-071, M-2), and the gate fails closed if that limit cannot be checked.
import { handleJson, MAX_BODY, runQuery, type ApiOut } from '../core/api.ts';
import { MemoryLimiter, SERVER_LIMIT, WINDOW_MS } from '../core/ratelimit.ts';
import { openIndex } from '../core/search-core.ts';
import type { Lang } from '../core/strings.ts';
import { authorised, REALM, SignInGuard, type GateEnv, type RateLimit } from './gate.ts';
import { renderPage, type PageCfg } from './page.ts';

export type WorkerCfg = PageCfg & { serverLimit?: number; gate?: boolean; assetHeaders?: Record<string, string> };
export type Env = GateEnv & { ASSETS?: { fetch(r: Request): Promise<Response> }; SEARCH_LIMIT?: RateLimit; AUTH_LIMIT?: RateLimit };

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

// Copies a response so its headers can be changed (asset responses have immutable headers).
function withHeaders(r: Response, set: Record<string, string>): Response {
  const out = new Response(r.body, r);
  for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
  return out;
}

export function makeWorker(indexBuf: ArrayBuffer, cfg: WorkerCfg) {
  const ix = openIndex(indexBuf);
  const mem = new MemoryLimiter(cfg.serverLimit ?? SERVER_LIMIT, WINDOW_MS);
  const guard = new SignInGuard();
  const assetHeaders = cfg.assetHeaders ? { ...BASE_HEADERS, ...cfg.assetHeaders } : null;
  if (assetHeaders) delete (assetHeaders as Record<string, string>)['cache-control'];

  async function handle(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        const r = await env.ASSETS.fetch(req);
        return assetHeaders ? withHeaders(r, assetHeaders) : r;
      }
      return new Response('Not found', { status: 404, headers: BASE_HEADERS });
    }
    if (pathname !== '/api/search') return json(404, { error: 'not_found' });
    if (req.method !== 'POST') return json(405, { error: 'method' }, { allow: 'POST' });

    const type = (req.headers.get('content-type') ?? '').toLowerCase();
    const form = type.startsWith('application/x-www-form-urlencoded');
    // D-071, L-4: the JSON path takes JSON only, and no path answers another site's request.
    if (!form && !/^application\/json\s*(;|$)/.test(type)) return json(415, { error: 'unsupported_type' });
    if (crossSite(req)) return json(403, { error: 'cross_site' });
    const key = netKey(req);
    const allowed = env.SEARCH_LIMIT ? (await env.SEARCH_LIMIT.limit({ key })).success : mem.allow(key);

    const read = await readCapped(req, form ? MAX_FORM : MAX_BODY * 4);
    if (read === 'bad_length') return json(400, { error: 'bad_length' });
    const raw = read;
    if (form) {
      const p = new URLSearchParams(raw ?? '');
      const lang: Lang = p.get('lang') === 'en' ? 'en' : 'ar';
      const q = raw === null ? '' : (p.get('q') ?? '');
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
    async fetch(req: Request, env: Env): Promise<Response> {
      if (!cfg.gate) return handle(req, env);
      const v = await guard.check(req, env, netKey(req), authorised);
      if (v.kind === 'unavailable') return gateUnavailable();
      if (v.kind === 'locked') return lockedOut(v.retry);
      if (v.kind === 'denied') return unauthorised();
      return withHeaders(await handle(req, env), { 'cache-control': PRIVATE_CACHE });
    },
  };
}
