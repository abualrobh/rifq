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
  const text = new TextDecoder('utf-8').decode(bytes);
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
