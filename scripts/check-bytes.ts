// RQ-001 AC4 (TP1-11, TP1-12): every ayah delivered in HTML must equal the source bytes, with no
// Unicode normalization and no text decoding on either side. Reports show references and hashes
// only, never Quran text.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Source } from '../src/core/source-adapter.ts';
import { AYAH_NO_CLOSE, AYAH_NO_OPEN } from '../src/core/ayah-number.ts';

// Kit v39 (RQ-008 D-186 B, P-23, AC99, AC107): on reader routes the stored number is wrapped in one
// element for the end-of-ayah ornament. A reader ayah is equal only when its delivered bytes are the
// stored bytes with exactly AYAH_NO_OPEN inserted right after the last no-break space and
// AYAH_NO_CLOSE at the end (so its text content is the stored text byte for byte); an ayah whose
// stored text does not end with a no-break space and digits must be delivered exactly as stored, and
// its reference is listed in `plain` (AC107). Tafseer routes keep the plain number (P-24).
export type ByteReport = { route: string; pages: number; ayat: number; equal: number; mismatches: string[]; refErrors: string[]; ornament?: number; plain?: string[] };

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
    const exp = rep.ornament === undefined ? src.slices[n] : ornamented(src.slices[n]);
    if (rep.ornament !== undefined) { if (exp === src.slices[n]) rep.plain!.push(ref); else rep.ornament++; }
    if (sameBytes(g.bytes, exp)) rep.equal++;
    else rep.mismatches.push(`${ref} delivered ${h8(g.bytes)} source ${h8(src.slices[n])}`);
  }
}

// The stored bytes with the ornament element around the trailing digits, or the same buffer when the
// text does not end with U+00A0 (bytes C2 A0) and 1 to 4 decimal digits (ASCII or Arabic-Indic or
// Extended Arabic-Indic, as UTF-8). Byte level only, the same split as splitAyahNumber.
const NBSP = Buffer.from([0xc2, 0xa0]);
const OPEN_B = Buffer.from(AYAH_NO_OPEN), CLOSE_B = Buffer.from(AYAH_NO_CLOSE);
export function ornamented(b: Uint8Array): Uint8Array {
  const buf = Buffer.from(b);
  const i = buf.lastIndexOf(NBSP);
  if (i < 0) return b;
  const tail = buf.subarray(i + 2).toString('utf8');
  if (!/^\p{Nd}{1,4}$/u.test(tail)) return b;
  return Buffer.concat([buf.subarray(0, i + 2), OPEN_B, buf.subarray(i + 2), CLOSE_B]);
}

// Reader routes, and the RQ-005 Tafseer routes (AC5) when the build has Tafseer on.
export const READER_ROUTES = ['', 'en/'];
export const TAFSEER_ROUTES = ['tafseer/', 'en/tafseer/'];

export function checkBuilt(src: Pick<Source, 'list' | 'slices'>, siteDir: string, routes: string[] = READER_ROUTES): ByteReport[] {
  const nSurah = src.list[src.list.length - 1].sora;
  return routes.map((route) => {
    const rep: ByteReport = { route: '/' + route, pages: 0, ayat: 0, equal: 0, mismatches: [], refErrors: [], ...(READER_ROUTES.includes(route) ? { ornament: 0, plain: [] } : {}) };
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
    const rep: ByteReport = { route: '/' + route, pages: 0, ayat: 0, equal: 0, mismatches: [], refErrors: [], ...(READER_ROUTES.includes(route) ? { ornament: 0, plain: [] } : {}) };
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

// Kit v43 (RQ-009 v0.3 AC6, AC7, AC108 to AC110): every Mushaf page in both interfaces. For page N:
// its ayah references, in order, are the records whose `page` is N (AC108); each ayah element's
// bytes are the scroll reader's (the stored bytes with the ornament element, AC109); and the text of
// each surah part's list, with all tags removed, is its ayat's stored texts joined by single spaces,
// so nothing else is in the text between ayat (AC110). Counts and references only, never text.
export const MUSHAF_ROUTES = ['page/', 'en/page/'];
export type MushafReport = { route: string; pages: number; ayat: number; equal: number; refErrors: string[]; mismatches: string[]; flowErrors: string[] };
const OL = /<ol class="ayat mp-flow"[^>]*>([\s\S]*?)<\/ol>/g;
const TAGS = /<[^>]*>/g;
export function checkMushaf(src: Pick<Source, 'list' | 'slices'>, siteDir: string, pages = 604): MushafReport[] {
  const byPage = new Map<number, number[]>();
  src.list.forEach((a, n) => { const p = (a as { page?: number }).page ?? 0; if (!byPage.has(p)) byPage.set(p, []); byPage.get(p)!.push(n); });
  return MUSHAF_ROUTES.map((route) => {
    const rep: MushafReport = { route: '/' + route, pages: 0, ayat: 0, equal: 0, refErrors: [], mismatches: [], flowErrors: [] };
    for (let p = 1; p <= pages; p++) {
      const f = join(siteDir, route, String(p), 'index.html');
      if (!existsSync(f)) { rep.refErrors.push(`missing page ${route}${p}`); continue; }
      const html = readFileSync(f);
      rep.pages++;
      const want = byPage.get(p) ?? [];
      const got = extractAyat(html);
      const wantRefs = want.map((n) => `${src.list[n].sora}:${src.list[n].aya_no}`);
      if (got.map((g) => g.ref).join(',') !== wantRefs.join(',')) { rep.refErrors.push(`${route}${p}: references differ from the file's page ${p}`); continue; }
      got.forEach((g, i) => {
        rep.ayat++;
        if (sameBytes(g.bytes, ornamented(src.slices[want[i]]))) rep.equal++;
        else rep.mismatches.push(`${route}${p} ${g.ref}`);
      });
      // AC110: each list's text is its ayat's stored texts joined by one space each.
      let k = 0;
      for (const m of html.toString('utf8').matchAll(OL)) {
        const text = m[1].replace(TAGS, '');
        const n = (m[1].match(/ data-r="/g) ?? []).length;
        const exp = want.slice(k, k + n).map((x) => src.slices[x].toString('utf8')).join(' ');
        k += n;
        if (text !== exp) rep.flowErrors.push(`${route}${p}: text between ayat is not one space`);
      }
      if (k !== want.length) rep.flowErrors.push(`${route}${p}: ${k} ayat in lists, ${want.length} on the page`);
    }
    return rep;
  });
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
  const summary = reps.map((r) => ({ route: r.route, via: a('http') ? 'http' : 'file', pages: r.pages, ayat: r.ayat, equal: r.equal, mismatches: r.mismatches.length, refErrors: r.refErrors.length, ornament: r.ornament, plain: r.plain, firstProblems: [...r.mismatches, ...r.refErrors].slice(0, 5) }));
  console.log(JSON.stringify(summary));
  process.exit(reps.every((r) => r.equal === src.list.length && !r.mismatches.length && !r.refErrors.length) ? 0 : 1);
}
