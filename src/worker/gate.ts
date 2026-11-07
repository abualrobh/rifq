// Password gate for the private test site. HTTP Basic auth is checked by the Worker before any
// page, asset or API response is made. Credentials come from the Worker secrets SITE_USER and
// SITE_PASSWORD. If either is missing or empty, every request is refused (fail closed).
// Nothing here logs, stores or echoes the credentials.

export const REALM = 'Basic realm="RIFQ private test", charset="UTF-8"';

export type GateEnv = { SITE_USER?: string; SITE_PASSWORD?: string };

const enc = new TextEncoder();

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// Constant-time comparison of two strings: both are hashed to 32 bytes first, so the loop always
// runs the same number of steps whatever the input lengths, and it never exits early.
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// Returns the user and password from an Authorization header, or null if it is not valid Basic.
export function parseBasic(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const m = /^basic[ \t]+([A-Za-z0-9+/]+={0,2})[ \t]*$/i.exec(header);
  if (!m) return null;
  let bin: string;
  try { bin = atob(m[1]); } catch { return null; }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  const i = text.indexOf(':');
  if (i < 0) return null;
  return { user: text.slice(0, i), pass: text.slice(i + 1) };
}

export async function authorised(req: Request, env: GateEnv): Promise<boolean> {
  const user = typeof env.SITE_USER === 'string' ? env.SITE_USER : '';
  const pass = typeof env.SITE_PASSWORD === 'string' ? env.SITE_PASSWORD : '';
  const got = parseBasic(req.headers.get('authorization'));
  // Both comparisons always run, so a wrong user and a wrong password take the same path.
  const [u, p] = await Promise.all([sameSecret(got?.user ?? '', user), sameSecret(got?.pass ?? '', pass)]);
  const configured = user.length > 0 && pass.length > 0;
  return configured && got !== null && u && p;
}

// Failed sign-in limit with a lockout (D-071, M-2).
//
// The Workers rate limit binding can only count, it cannot be read without counting. So:
// - every request with wrong credentials counts once against AUTH_LIMIT for its network address;
// - a request with the right credentials also counts once, unless this isolate has already seen the
//   right credentials from that address within the last minute (and no failure since). An
//   attacker never has the right credentials before the guess that finds them, so that guess is
//   counted too and is refused while the address is over the limit;
// - once the binding says the address is over the limit, the address is locked in this isolate
//   for LOCK_MS, and every request from it gets 429 without its credentials being checked.
// A request with no Authorization header (a browser's first request) is refused with 401 and is
// not counted. If the binding is missing or fails, every request is refused (fail closed).
// Addresses are held in memory only, for at most a minute, and are never logged or stored.
export type RateLimit = { limit(o: { key: string }): Promise<{ success: boolean }> };
export const AUTH_LIMIT_PER_MINUTE = 10;
export const LOCK_MS = 60_000;
const OK_MEMO_MS = 60_000;
const MAX_KEYS = 10_000;

export type GuardVerdict = { kind: 'ok' } | { kind: 'denied' } | { kind: 'locked'; retry: number } | { kind: 'unavailable' };

export class SignInGuard {
  private locked = new Map<string, number>();
  private okSeen = new Map<string, number>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  private static trim(m: Map<string, number>) {
    if (m.size <= MAX_KEYS) return;
    const first = m.keys().next().value;
    if (first !== undefined) m.delete(first);
  }

  async check(req: Request, env: GateEnv & { AUTH_LIMIT?: RateLimit }, key: string,
    auth: (r: Request, e: GateEnv) => Promise<boolean>): Promise<GuardVerdict> {
    const t = this.now();
    const until = this.locked.get(key);
    if (until !== undefined) {
      if (until > t) return { kind: 'locked', retry: Math.max(1, Math.ceil((until - t) / 1000)) };
      this.locked.delete(key);
    }
    const limiter = env.AUTH_LIMIT;
    if (!limiter || typeof limiter.limit !== 'function') return { kind: 'unavailable' };
    const sent = req.headers.has('authorization');
    const ok = await auth(req, env);
    if (!ok && !sent) return { kind: 'denied' };
    if (ok) {
      const seen = this.okSeen.get(key);
      if (seen !== undefined && t - seen < OK_MEMO_MS) return { kind: 'ok' };
    } else {
      this.okSeen.delete(key);
    }
    let under: boolean;
    try { under = (await limiter.limit({ key: 'auth:' + key })).success === true; } catch { return { kind: 'unavailable' }; }
    if (!under) {
      this.okSeen.delete(key);
      this.locked.set(key, t + LOCK_MS);
      SignInGuard.trim(this.locked);
      return { kind: 'locked', retry: Math.ceil(LOCK_MS / 1000) };
    }
    if (!ok) return { kind: 'denied' };
    this.okSeen.set(key, t);
    SignInGuard.trim(this.okSeen);
    return { kind: 'ok' };
  }
}
