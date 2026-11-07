// RIFQ Worker (D-054, D-057). It answers /api/*; every other path is a static asset.
// It stores nothing and logs nothing: there is no console call in this file on purpose, and
// scripts/check-no-quran.ts plus test/unit/worker.test.ts check that no logging call is added.
// With the build flag gate on (cfg.gate), every request, assets included, must pass HTTP Basic
// auth first (src/worker/gate.ts). The build then sets run_worker_first: true so no asset is served
// without the Worker, and the Worker adds the security headers itself, because the platform does not
// apply _headers to responses the Worker returns.
import { handleJson, MAX_BODY, runQuery, type ApiOut } from '../core/api.ts';
import { MemoryLimiter, SERVER_LIMIT, WINDOW_MS } from '../core/ratelimit.ts';
import { openIndex } from '../core/search-core.ts';
import type { Lang } from '../core/strings.ts';
import { authorised, REALM, type GateEnv } from './gate.ts';
import { renderPage, type PageCfg } from './page.ts';

export type WorkerCfg = PageCfg & { serverLimit?: number; gate?: boolean; assetHeaders?: Record<string, string> };
type RateLimit = { limit(o: { key: string }): Promise<{ success: boolean }> };
export type Env = GateEnv & { ASSETS?: { fetch(r: Request): Promise<Response> }; SEARCH_LIMIT?: RateLimit };

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
const HTML_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
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

// Reads at most cap bytes of the body; anything longer is refused without being kept.
async function readCapped(req: Request, cap: number): Promise<string | null> {
  const n = Number(req.headers.get('content-length') ?? '0');
  if (n > cap) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > cap) return null;
  return new TextDecoder('utf-8').decode(buf);
}

// The 401 answer: a short body, no-store, the security headers and the Basic challenge.
export function unauthorised(): Response {
  return new Response('Authentication required.\n', {
    status: 401,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': JSON_CSP, 'www-authenticate': REALM },
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

    const form = (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded');
    // The key is used only for the limit count and is never stored by RIFQ.
    const key = req.headers.get('cf-connecting-ip') ?? 'local';
    const allowed = env.SEARCH_LIMIT ? (await env.SEARCH_LIMIT.limit({ key })).success : mem.allow(key);

    const raw = await readCapped(req, form ? MAX_FORM : MAX_BODY * 4);
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
      if (!(await authorised(req, env))) return unauthorised();
      return withHeaders(await handle(req, env), { 'cache-control': PRIVATE_CACHE });
    },
  };
}
