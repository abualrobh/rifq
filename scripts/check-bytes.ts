// RQ-001 AC4 (TP1-11, TP1-12): every ayah delivered in HTML must equal the source bytes, with no
// Unicode normalization and no text decoding on either side. Reports show references and hashes
// only, never Quran text.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Source } from '../src/core/source-adapter.ts';

export type ByteReport = { route: string; pages: number; ayat: number; equal: number; mismatches: string[]; refErrors: string[] };

const OPEN = Buffer.from(' data-r="');
const CLOSE = Buffer.from('</p>');
const h8 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);

// Byte-level equality only. No decode, no normalization.
export const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// Finds every <p ... data-r="S:A">TEXT</p> in a page, as raw bytes.
export function extractAyat(html: Buffer): { ref: string; bytes: Buffer }[] {
  const out: { ref: string; bytes: Buffer }[] = [];
  let i = 0;
  for (;;) {
    const k = html.indexOf(OPEN, i);
    if (k < 0) break;
    const q = html.indexOf(0x22, k + OPEN.length);
    const ref = html.subarray(k + OPEN.length, q).toString('latin1');
    const gt = html.indexOf(0x3e, q);
    const end = html.indexOf(CLOSE, gt);
    out.push({ ref, bytes: html.subarray(gt + 1, end) });
    i = end + CLOSE.length;
  }
  return out;
}

export function compareSurahPage(src: Pick<Source, 'list' | 'slices'>, s: number, html: Buffer, rep: ByteReport) {
  const want: number[] = [];
  src.list.forEach((a, n) => { if (a.sora === s) want.push(n); });
  const got = extractAyat(html);
  rep.pages++;
  if (got.length !== want.length) rep.refErrors.push(`${rep.route}${s}: ${got.length} ayat on page, ${want.length} in source`);
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const n = want[i];
    const g = got[i];
    if (n === undefined || !g) continue;
    rep.ayat++;
    const ref = `${src.list[n].sora}:${src.list[n].aya_no}`;
    if (g.ref !== ref) { rep.refErrors.push(`${rep.route}${s}: position ${i + 1} is ${g.ref}, source has ${ref}`); continue; }
    if (sameBytes(g.bytes, src.slices[n])) rep.equal++;
    else rep.mismatches.push(`${ref} delivered ${h8(g.bytes)} source ${h8(src.slices[n])}`);
  }
}

// Reader routes, and the RQ-005 Tafseer routes (AC5) when the build has Tafseer on.
export const READER_ROUTES = ['', 'en/'];
export const TAFSEER_ROUTES = ['tafseer/', 'en/tafseer/'];

export function checkBuilt(src: Pick<Source, 'list' | 'slices'>, siteDir: string, routes: string[] = READER_ROUTES): ByteReport[] {
  const nSurah = src.list[src.list.length - 1].sora;
  return routes.map((route) => {
    const rep: ByteReport = { route: '/' + route, pages: 0, ayat: 0, equal: 0, mismatches: [], refErrors: [] };
    for (let s = 1; s <= nSurah; s++) {
      const f = join(siteDir, route, String(s), 'index.html');
      if (!existsSync(f)) { rep.refErrors.push(`missing page ${route}${s}`); continue; }
      compareSurahPage(src, s, readFileSync(f), rep);
    }
    return rep;
  });
}

export async function checkHttp(src: Pick<Source, 'list' | 'slices'>, base: string, routes: string[] = READER_ROUTES, headers: Record<string, string> = {}): Promise<ByteReport[]> {
  const nSurah = src.list[src.list.length - 1].sora;
  const out: ByteReport[] = [];
  for (const route of routes) {
    const rep: ByteReport = { route: '/' + route, pages: 0, ayat: 0, equal: 0, mismatches: [], refErrors: [] };
    for (let s = 1; s <= nSurah; s++) {
      const r = await fetch(`${base}/${route}${s}/`, { headers: { 'accept-encoding': 'gzip', ...headers } });
      if (!r.ok) { rep.refErrors.push(`HTTP ${r.status} for ${route}${s}`); continue; }
      compareSurahPage(src, s, Buffer.from(await r.arrayBuffer()), rep);
    }
    out.push(rep);
  }
  return out;
}

// No ayah may appear in client JavaScript (the text is delivered only as HTML).
export function scanClientJs(src: Pick<Source, 'slices'>, siteDir: string): { files: number; hits: number } {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js') || n.endsWith('.mjs')) files.push(p); } };
  walk(siteDir);
  let hits = 0;
  for (const f of files) {
    const b = readFileSync(f);
    for (const s of src.slices) if (b.indexOf(s) >= 0) hits++;
  }
  return { files: files.length, hits };
}

// CLI: node scripts/check-bytes.ts --record <source-record.json> [--site <dir>] [--http <base-url>] [--tafseer]
import { fileURLToPath } from 'node:url';
import { loadSource } from '../src/core/source-adapter.ts';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
  const src = loadSource(a('record')!);
  const reps: ByteReport[] = [];
  const routes = process.argv.includes('--tafseer') ? [...READER_ROUTES, ...TAFSEER_ROUTES] : READER_ROUTES;
  if (a('site')) reps.push(...checkBuilt(src, a('site')!, routes));
  if (a('http')) reps.push(...(await checkHttp(src, a('http')!, routes)));
  const summary = reps.map((r) => ({ route: r.route, via: a('http') ? 'http' : 'file', pages: r.pages, ayat: r.ayat, equal: r.equal, mismatches: r.mismatches.length, refErrors: r.refErrors.length, firstProblems: [...r.mismatches, ...r.refErrors].slice(0, 5) }));
  console.log(JSON.stringify(summary));
  process.exit(reps.every((r) => r.equal === src.list.length && !r.mismatches.length && !r.refErrors.length) ? 0 : 1);
}
