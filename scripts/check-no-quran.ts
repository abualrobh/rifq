// Fails if Quran text, surah names, or text derived from them appear in the public repository.
//   node scripts/check-no-quran.ts [--root <dir>] [--source <source-record.json>]
// Layer 1 (always, no data needed):
//   - Arabic-script characters may appear only in src/core/strings.ts (interface strings).
//   - Quranic annotation signs, small high marks and alef wasla may appear nowhere.
//   - Runs of 4 or more escaped Arabic code points (\uXXXX, \u{...}, &#...;) may appear nowhere.
// Layer 2 (with --source, run in the private build): no ayah, no surah name in Arabic (as stored
// or with marks removed), no English surah name, and no 3-word run of Quran words may appear in
// any file, and no Arabic interface word may equal a surah name. Reports give file, line and code
// point in hex only, never the matched text.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldPlaceholder, NOT_WORD, WORD_SPLIT } from '../src/core/fold.ts';
import { loadSource } from '../src/core/source-adapter.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.out', '.synthetic', '.astro', '.wrangler', 'test-results', 'playwright-report', '.git']);
export const ALLOWED_ARABIC = new Set(['src/core/strings.ts']);

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
// Signs used in Quran text and essentially nowhere else: small high signs, waqf marks, rub el
// hizb, sajda, end of ayah, alef wasla, superscript alef, and the extended Quranic marks block.
const QURANIC = /[\u0610-\u061a\u0670-\u0671\u06d6-\u06ed\u08d3-\u08ff]/u;
const ARABIC_RUN = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u00a0 ]+/gu;
const ESC = String.raw`(?:\\u0[6-8][0-9a-fA-F]{2}|\\u\{0?[6-8][0-9a-fA-F]{2}\}|&#x0?[6-8][0-9a-fA-F]{2};|&#1[5-9]\d\d;|&#2[0-2]\d\d;)`;
const ESC_RUN = new RegExp(`${ESC}{4,}`);

export type Finding = { file: string; line: number; reason: string; codepoint?: string };

export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (SKIP_DIRS.has(n)) continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 8 * 1024 * 1024) out.push(p);
    }
  };
  walk(root);
  return out;
}

const hex = (c: string) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');

export function layer1(root: string): Finding[] {
  const f: Finding[] = [];
  for (const p of listFiles(root)) {
    const rel = relative(root, p);
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((ln, i) => {
      const q = QURANIC.exec(ln);
      if (q) f.push({ file: rel, line: i + 1, reason: 'Quranic sign', codepoint: hex(q[0]) });
      const a = ARABIC.exec(ln);
      if (a && !ALLOWED_ARABIC.has(rel)) f.push({ file: rel, line: i + 1, reason: 'Arabic-script character outside the interface strings file', codepoint: hex(a[0]) });
      if (ESC_RUN.test(ln)) f.push({ file: rel, line: i + 1, reason: 'run of 4 or more escaped Arabic code points' });
    });
  }
  return f;
}

const words = (s: string) => s.split(WORD_SPLIT).filter((w) => w && !NOT_WORD.test(w));

export function layer2(root: string, recordPath: string): Finding[] {
  const src = loadSource(recordPath);
  const f: Finding[] = [];
  const files = listFiles(root).map((p) => ({ rel: relative(root, p), buf: readFileSync(p) })).filter((x) => !x.buf.includes(0));
  const texts = files.map((x) => ({ rel: x.rel, text: x.buf.toString('utf8') }));

  // Whole ayat, as stored.
  for (const x of texts) {
    for (const a of src.list) if (x.text.includes(a.aya_text)) { f.push({ file: x.rel, line: 0, reason: `ayah ${a.sora}:${a.aya_no} found` }); break; }
  }
  // Surah names in Arabic (stored and with marks removed) and in English.
  const arNames = new Map<string, number>(), enNames = new Map<string, number>();
  for (const a of src.list) {
    arNames.set(a.sora_name_ar, a.sora); arNames.set(foldPlaceholder(a.sora_name_ar), a.sora);
    enNames.set(a.sora_name_en.toLowerCase(), a.sora);
  }
  // Arabic names are matched as whole words (or whole word runs), with marks removed on both sides.
  const foldedNameMap = new Map<string, number>();
  for (const [n, s] of arNames) foldedNameMap.set(words(foldPlaceholder(n)).join(' '), s);
  for (const x of texts) {
    const lower = x.text.toLowerCase();
    if (ARABIC.test(x.text)) {
      for (const run of x.text.match(ARABIC_RUN) ?? []) {
        const w = ' ' + words(foldPlaceholder(run).trim()).join(' ') + ' ';
        for (const [n, s] of foldedNameMap) if (n && w.includes(' ' + n + ' ')) f.push({ file: x.rel, line: 0, reason: `Arabic name of surah ${s} found` });
      }
    }
    for (const [n, s] of enNames) {
      if (n.length < 3) continue;
      const re = new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
      if (re.test(lower)) f.push({ file: x.rel, line: 0, reason: `English name of surah ${s} found` });
    }
  }
  // 3-word runs of Quran words (marks removed on both sides) in any Arabic text in the repository,
  // and single Arabic words equal to a surah name.
  const tri = new Set<string>();
  for (const a of src.list) {
    const w = words(a.aya_text).map(foldPlaceholder);
    for (let i = 0; i + 2 < w.length; i++) tri.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  }
  const foldedNames = new Set([...arNames.keys()].map(foldPlaceholder));
  for (const x of texts) {
    if (!ARABIC.test(x.text)) continue;
    x.text.split('\n').forEach((ln, i) => {
      for (const run of ln.match(ARABIC_RUN) ?? []) {
        const w = words(run.trim()).map(foldPlaceholder).filter(Boolean);
        for (let k = 0; k + 2 < w.length; k++) if (tri.has(`${w[k]} ${w[k + 1]} ${w[k + 2]}`)) f.push({ file: x.rel, line: i + 1, reason: '3-word run of Quran text found' });
        for (const one of w) if (foldedNames.has(one)) f.push({ file: x.rel, line: i + 1, reason: 'word equal to a surah name found' });
      }
    });
  }
  return f;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = resolve(i > 0 ? process.argv[i + 1] : ROOT);
  const j = process.argv.indexOf('--source');
  const findings = layer1(root);
  let mode = 'layer 1 only (no source given)';
  if (j > 0) { findings.push(...layer2(root, resolve(process.argv[j + 1]))); mode = 'layers 1 and 2'; }
  const files = listFiles(root).length;
  console.log(JSON.stringify({ root: relative(process.cwd(), root) || '.', mode, filesScanned: files, findings: findings.length }));
  for (const x of findings.slice(0, 50)) console.log(JSON.stringify(x));
  process.exit(findings.length ? 1 : 0);
}
