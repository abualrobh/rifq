// D-157 proof: the letters-only Quran matching data (D-084, D-085) lives only in the Worker bundle.
// This scan reads every file under a folder (the static site, or a deploy kit's site/) and reports
// any file that holds the letters-only form of an ayah, in either form (aya_text or
// aya_text_emlaey). Text is read as UTF-8 and as UTF-16LE (kit v32), and JavaScript \uXXXX escapes and HTML numeric
// character references are decoded first, so escaped copies are found too.
//
// Probes: every ayah whose letters-only form has at least PROBE_MIN_WORDS words (shorter ones are
// too likely to occur by chance in other text). A hit is a run of bare Arabic letters and single
// spaces that contains a probe whole. The scan prints counts and file paths only, never text.
//
// Usage: node scripts/letters-scan.ts <record.json> <folder> [<folder> ...]
// Exit code 0 when no file holds a probe, 3 otherwise.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareAyah, lettersOnly } from '../src/core/tafseer-quotes.ts';
import { loadSource } from '../src/core/source-adapter.ts';

export const PROBE_MIN_WORDS = 4;
// The Arabic letters the check keeps (src/core/tafseer-quotes.ts NOT_LETTER), as escapes.
const L = '\\u0621-\\u063a\\u0641-\\u064a\\u0671-\\u06d3\\u06d5\\u06ee\\u06ef\\u06fa-\\u06fc\\u06ff\\u0750-\\u077f\\u08a0-\\u08c9';
const RUN = new RegExp(`[${L}]+(?: [${L}]+){${PROBE_MIN_WORDS - 1},}`, 'gu');

export type Probes = { byHead: Map<string, Set<string>>; count: number };

export function probesFrom(list: { aya_text: string; aya_text_emlaey?: string }[]): Probes {
  const byHead = new Map<string, Set<string>>();
  let count = 0;
  const add = (s: string) => {
    const w = s.split(' ');
    if (w.length < PROBE_MIN_WORDS) return;
    const k = w.slice(0, PROBE_MIN_WORDS).join(' ');
    if (!byHead.has(k)) byHead.set(k, new Set());
    const set = byHead.get(k)!;
    if (!set.has(s)) { set.add(s); count++; }
  };
  for (const a of list) {
    add(lettersOnly(bareAyah(a.aya_text)));
    if (typeof a.aya_text_emlaey === 'string') add(lettersOnly(a.aya_text_emlaey));
  }
  return { byHead, count };
}

const decode = (s: string) => s
  .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h: string) => { const n = parseInt(h, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : m; })
  .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h: string) => { const n = parseInt(h, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : m; })
  .replace(/&#([0-9]{1,7});/g, (m, d: string) => { const n = Number(d); return n <= 0x10ffff ? String.fromCodePoint(n) : m; });

// Number of probes found whole in one text.
export function hitsIn(text: string, p: Probes): number {
  let hits = 0;
  for (const m of decode(text).matchAll(RUN)) {
    const run = ' ' + m[0] + ' ';
    const w = m[0].split(' ');
    for (let i = 0; i + PROBE_MIN_WORDS <= w.length; i++) {
      const set = p.byHead.get(w.slice(i, i + PROBE_MIN_WORDS).join(' '));
      if (!set) continue;
      for (const full of set) if (run.includes(' ' + full + ' ')) { hits++; break; }
    }
  }
  return hits;
}

export function scanFolder(dir: string, p: Probes): { files: number; hits: { file: string; n: number }[] } {
  let files = 0;
  const hits: { file: string; n: number }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) { walk(f); continue; }
      files++;
      // Kit v32: each file is also read as UTF-16LE (the Worker's data module holds the letters as
      // UTF-16 code units), so a copy in either encoding is found.
      const b = readFileSync(f);
      const k = Math.max(hitsIn(b.toString('utf8'), p), hitsIn(b.toString('utf16le'), p), b.length > 1 ? hitsIn(b.subarray(1).toString('utf16le'), p) : 0);
      if (k) hits.push({ file: relative(dir, f), n: k });
    }
  };
  walk(dir);
  return { files, hits };
}

export function checkLettersNotServed(list: { aya_text: string; aya_text_emlaey?: string }[], siteDir: string) {
  const p = probesFrom(list);
  return { probes: p.count, ...scanFolder(siteDir, p) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [rec, ...dirs] = process.argv.slice(2);
  if (!rec || !dirs.length) { console.error('usage: node scripts/letters-scan.ts <record.json> <folder> [...]'); process.exit(1); }
  const p = probesFrom(loadSource(rec).list);
  let bad = false;
  for (const d of dirs) {
    const r = scanFolder(d, p);
    console.log(JSON.stringify({ folder: d, files: r.files, probes: p.count, filesWithHits: r.hits.length, hits: r.hits.reduce((a, b) => a + b.n, 0), paths: r.hits.map((h) => h.file) }));
    if (r.hits.length) bad = true;
  }
  process.exitCode = bad ? 3 : 0;
}
