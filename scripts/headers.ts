// Writes the static assets _headers file. Inline scripts and styles are allowed by SHA-256 hash
// only, never by 'unsafe-inline'. The build fails if any HTML file has an inline style attribute,
// an inline event handler, or an inline script or style whose hash is not in the policy.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (n.endsWith('.html')) out.push(p);
  }
  return out;
}

const b64 = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64');

export function inlineHashes(html: string) {
  const scripts = new Set<string>(), styles = new Set<string>();
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] ?? '';
    if (/\ssrc=/.test(attrs)) continue;
    if (/type="application\/(ld\+)?json"/.test(attrs)) continue;
    scripts.add(`'sha256-${b64(m[2])}'`);
  }
  for (const m of html.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/g)) styles.add(`'sha256-${b64(m[2])}'`);
  const problems: string[] = [];
  if (/<[a-z][^>]*\sstyle="/i.test(html)) problems.push('inline style attribute');
  if (/<[a-z][^>]*\son[a-z]+="/i.test(html)) problems.push('inline event handler attribute');
  return { scripts, styles, problems };
}

export function buildPolicy(scripts: Iterable<string>, styles: Iterable<string>) {
  return [
    "default-src 'none'",
    `script-src 'self' ${[...scripts].sort().join(' ')}`.trim(),
    `style-src 'self' ${[...styles].sort().join(' ')}`.trim(),
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

// RQ-006 AC39: the reader page policy adds media-src for the approved audio host only.
export const readerPolicy = (csp: string, audioOrigin: string) => `${csp}; media-src ${audioOrigin}`;
const READER_DIR = /^\/(?:en\/)?\d{1,3}\/$/;

// _headers rules that give reader pages (/N/ and /en/N/) the reader policy. The file allows at most
// 100 rules, so the 228 reader pages are matched by the placeholders /:p/ and /en/:p/, and every
// other built page those placeholders would also match (such as /en/ or /privacy/) gets the base
// policy back. "! Name" removes the header set by an earlier rule. A path that is not built (a 404
// answer) under /:p/ keeps the reader policy; no page there has a player.
export function readerRules(pages: string[], csp: string, audioOrigin: string): string {
  const reader = readerPolicy(csp, audioOrigin);
  const clash = pages.filter((p) => !READER_DIR.test(p) && (/^\/[^/]+\/$/.test(p) || /^\/en\/[^/]+\/$/.test(p))).sort();
  const rule = (path: string, value: string) => `${path}\n  ! Content-Security-Policy\n  Content-Security-Policy: ${value}\n`;
  return rule('/:p/', reader) + rule('/en/:p/', reader) + clash.map((p) => rule(p, csp)).join('');
}

export function writeHeaders(siteDir: string, opts: { audioOrigin?: string } = {}) {
  const scripts = new Set<string>(), styles = new Set<string>();
  const problems: string[] = [];
  for (const f of htmlFiles(siteDir)) {
    const r = inlineHashes(readFileSync(f, 'utf8'));
    r.scripts.forEach((x) => scripts.add(x));
    r.styles.forEach((x) => styles.add(x));
    r.problems.forEach((p) => problems.push(`${f.slice(siteDir.length)}: ${p}`));
  }
  if (problems.length) throw new Error('CSP check failed:\n' + problems.slice(0, 20).join('\n'));
  const csp = buildPolicy(scripts, styles);
  const headers = assetHeaderMap(csp);
  let body = '/*\n' + Object.entries(headers).map(([k, v]) => `  ${k}: ${v}\n`).join('');
  if (opts.audioOrigin) {
    const pages = htmlFiles(siteDir).map((f) => f.slice(siteDir.length).replace(/index\.html$/, '')).filter((p) => p.endsWith('/'));
    body += readerRules(pages, csp, opts.audioOrigin);
  }
  writeFileSync(join(siteDir, '_headers'), body);
  return { csp, headers, scripts: scripts.size, styles: styles.size };
}

// The headers every static asset gets. Written to _headers, and also passed to the Worker, which
// sets them itself when it serves assets first (the platform does not apply _headers then).
export function assetHeaderMap(csp: string): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
