// Fails if Quran text, surah names, or text derived from them appear in the public repository.
//   node scripts/check-no-quran.ts [--root <dir>] [--source <source-record.json>]
// Every file is read, whatever its size (D-071, M-1).
// Layer 0 (always, no data needed):
//   - Archive and binary-blob file names (.zip, .gz, .tgz, .7z, .br, .tar, .xz, .bz2, .zst, .rar,
//     .bin) fail.
//   - A file that is not plain UTF-8 text (it holds a NUL byte or is not valid UTF-8) fails unless
//     its path and SHA-256 are on the reviewed allow list in scripts/binary-allowlist.json.
//   - The search index header (magic plus a format version) fails in any file.
//   - gzip, zlib and Brotli streams are opened and their contents are checked like a file.
//   - Long base64 runs are decoded and checked, and runs of percent-encoded Arabic fail.
// Layer 1 (always, no data needed), on every text file and every decoded stream:
//   - Arabic-script characters may appear only in src/core/strings.ts (interface strings).
//   - Quranic annotation signs, small high marks and alef wasla may appear nowhere.
//   - Runs of 4 or more escaped Arabic code points (\uXXXX, \u{...}, &#...;, %XX) may appear nowhere.
// Layer 2 (with --source, run in the private build): no ayah in UTF-8, UTF-16LE or UTF-16BE bytes
// in any file (binary files included), no surah name in Arabic (as stored or with marks removed),
// no English surah name, and no 3-word run of Quran words in any text, and no Arabic interface word
// may equal a surah name. Reports give file, line and code point in hex only, never the matched text.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { foldPlaceholder, NOT_WORD, WORD_SPLIT } from '../src/core/fold.ts';
import { loadSource } from '../src/core/source-adapter.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.out', '.synthetic', '.astro', '.wrangler', 'test-results', 'playwright-report', '.git']);
export const ALLOWED_ARABIC = new Set(['src/core/strings.ts']);
export const ARCHIVE_EXT = /\.(zip|gz|tgz|7z|br|tar|xz|bz2|zst|rar|bin)$/i;

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
// Signs used in Quran text and essentially nowhere else: small high signs, waqf marks, rub el
// hizb, sajda, end of ayah, alef wasla, superscript alef, and the extended Quranic marks block.
const QURANIC = /[\u0610-\u061a\u0670-\u0671\u06d6-\u06ed\u08d3-\u08ff]/u;
const ARABIC_RUN_CHAR = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u00a0 ]/u;
// Runs of Arabic letters, marks and spaces, found with a plain loop (a regular expression can run
// out of stack on a very long run). Runs made only of spaces are skipped.
export function arabicRuns(t: string): string[] {
  const out: string[] = [];
  let cur = '', hasAr = false;
  for (const ch of t) {
    if (ARABIC_RUN_CHAR.test(ch)) { cur += ch; if (ch !== ' ' && ch !== '\u00a0') hasAr = true; continue; }
    if (hasAr) out.push(cur);
    cur = ''; hasAr = false;
  }
  if (hasAr) out.push(cur);
  return out;
}
const ESC = String.raw`(?:\\u0[6-8][0-9a-fA-F]{2}|\\u\{0?[6-8][0-9a-fA-F]{2}\}|&#x0?[6-8][0-9a-fA-F]{2};|&#1[5-9]\d\d;|&#2[0-2]\d\d;)`;
const ESC_RUN = new RegExp(`${ESC}{4,}`);
// UTF-8 Arabic block bytes written as %XX (URL encoding), 4 or more characters in a row.
const PCT_RUN = /(?:%[dD][89aAbB]%[89aAbB][0-9a-fA-F]){4,}/;
// Runs of 64 or more base64 characters, found with a plain loop (a regular expression can run out
// of stack on a very long run).
export function b64Runs(t: string): string[] {
  const out: string[] = [];
  let start = -1;
  const isB64 = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;
  for (let i = 0; i <= t.length; i++) {
    const ok = i < t.length && isB64(t.charCodeAt(i));
    if (ok && start < 0) start = i;
    else if (!ok && start >= 0) {
      let end = i;
      while (end < t.length && t.charCodeAt(end) === 61 && end - i < 2) end++;
      if (i - start >= 64) out.push(t.slice(start, end));
      start = -1;
    }
  }
  return out;
}
// Index header: the magic 0x51464952 and a format version 1 or 2, little-endian.
const INDEX_HEADERS = [1, 2].map((v) => { const b = Buffer.alloc(8); b.writeUInt32LE(0x51464952, 0); b.writeUInt32LE(v, 4); return b; });

export type Finding = { file: string; line: number; reason: string; codepoint?: string };
type AllowEntry = { path: string; sha256: string; reason: string };

export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (SKIP_DIRS.has(n)) continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

const hex = (c: string) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const relPath = (root: string, p: string) => relative(root, p).split(sep).join('/');

export function loadAllowList(root: string): AllowEntry[] {
  try { return (JSON.parse(readFileSync(join(root, 'scripts/binary-allowlist.json'), 'utf8')).files ?? []) as AllowEntry[]; } catch { return []; }
}

// Plain UTF-8 text: no NUL byte and valid UTF-8. Returns the text, or null for anything else.
const strict = new TextDecoder('utf-8', { fatal: true });
export function asText(buf: Uint8Array): string | null {
  if (buf.includes(0)) return null;
  try { return strict.decode(buf); } catch { return null; }
}

// Tries to open buf as a gzip, zlib or Brotli stream. Only a full, valid stream counts.
export function decompressed(buf: Buffer): { kind: string; data: Buffer }[] {
  const out: { kind: string; data: Buffer }[] = [];
  const opts = { maxOutputLength: 256 * 1024 * 1024 };
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) { try { out.push({ kind: 'gzip', data: gunzipSync(buf, opts) }); } catch { /* not gzip */ } }
  if (buf.length > 2 && buf[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buf[1])) { try { out.push({ kind: 'zlib', data: inflateSync(buf, opts) }); } catch { /* not zlib */ } }
  try { const d = brotliDecompressSync(buf, opts); if (d.length) out.push({ kind: 'brotli', data: d }); } catch { /* not brotli */ }
  return out;
}

function textChecks(rel: string, text: string, f: Finding[], where = '') {
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const q = QURANIC.exec(ln);
    if (q) f.push({ file: rel, line: i + 1, reason: 'Quranic sign' + where, codepoint: hex(q[0]) });
    const a = ARABIC.exec(ln);
    if (a && (where || !ALLOWED_ARABIC.has(rel))) f.push({ file: rel, line: i + 1, reason: 'Arabic-script character outside the interface strings file' + where, codepoint: hex(a[0]) });
    if (ESC_RUN.test(ln)) f.push({ file: rel, line: i + 1, reason: 'run of 4 or more escaped Arabic code points' + where });
    if (PCT_RUN.test(ln)) f.push({ file: rel, line: i + 1, reason: 'run of 4 or more percent-encoded Arabic characters' + where });
  });
}

// Bytes that are not plain text, or that came out of a decoder: check them as far as possible
// without the source.
function blobChecks(rel: string, buf: Buffer, f: Finding[], depth: number, where: string) {
  for (const h of INDEX_HEADERS) if (buf.indexOf(h) >= 0) { f.push({ file: rel, line: 0, reason: 'search index header found' + where }); break; }
  if (depth > 2) return;
  const t = asText(buf);
  if (t !== null && where) textChecks(rel, t, f, where);
  for (const d of decompressed(buf)) {
    const inner = ` (inside ${d.kind}${where})`;
    if (asText(d.data) === null) f.push({ file: rel, line: 0, reason: 'compressed stream holds binary data' + inner });
    blobChecks(rel, d.data, f, depth + 1, inner);
  }
  if (t !== null) {
    for (const m of b64Runs(t)) {
      let b: Buffer;
      try { b = Buffer.from(m, 'base64'); } catch { continue; }
      const inner = ` (inside base64${where})`;
      const bt = asText(b);
      if (bt !== null && ARABIC.test(bt)) f.push({ file: rel, line: 0, reason: 'base64 run decodes to Arabic-script text' + inner });
      blobChecks(rel, b, f, depth + 1, inner);
    }
  }
}

export function layer1(root: string): Finding[] {
  const f: Finding[] = [];
  const allow = loadAllowList(root);
  for (const p of listFiles(root)) {
    const rel = relPath(root, p);
    const buf = readFileSync(p);
    if (ARCHIVE_EXT.test(rel)) f.push({ file: rel, line: 0, reason: 'archive or binary blob file name' });
    const text = asText(buf);
    if (text === null) {
      const ok = allow.some((a) => a.path === rel && a.sha256 === sha256(buf));
      if (!ok) f.push({ file: rel, line: 0, reason: 'not plain UTF-8 text and not on the reviewed allow list' });
      blobChecks(rel, buf, f, 0, ok ? ' (allow-listed file)' : ' (binary file)');
      continue;
    }
    textChecks(rel, text, f);
    blobChecks(rel, buf, f, 0, '');
  }
  return f;
}

const words = (s: string) => s.split(WORD_SPLIT).filter((w) => w && !NOT_WORD.test(w));
const utf16be = (s: string) => { const b = Buffer.from(s, 'utf16le'); return b.swap16(); };

// Every byte stream a file holds: the file itself plus anything decompressed or base64-decoded.
function streams(buf: Buffer, depth = 0): Buffer[] {
  const out = [buf];
  if (depth > 2) return out;
  for (const d of decompressed(buf)) out.push(...streams(d.data, depth + 1));
  const t = asText(buf);
  if (t !== null) for (const m of b64Runs(t)) out.push(...streams(Buffer.from(m, 'base64'), depth + 1));
  return out;
}

export function layer2(root: string, recordPath: string): Finding[] {
  const src = loadSource(recordPath);
  const f: Finding[] = [];
  const files = listFiles(root).map((p) => ({ rel: relPath(root, p), buf: readFileSync(p) }));

  // Whole ayat, as stored, in UTF-8, UTF-16LE and UTF-16BE, in every file and decoded stream.
  const enc: [string, Buffer[]][] = [
    ['UTF-8', src.slices.map((b) => Buffer.from(b))],
    ['UTF-16LE', src.list.map((a) => Buffer.from(a.aya_text, 'utf16le'))],
    ['UTF-16BE', src.list.map((a) => utf16be(a.aya_text))],
  ];
  for (const x of files) {
    for (const s of streams(x.buf)) {
      // Arabic letters in these encodings always hold 0xD8 to 0xDB (UTF-8) or 0x06 (UTF-16).
      const mayUtf8 = s.includes(0xd8) || s.includes(0xd9), mayUtf16 = s.includes(0x06);
      for (const [name, list] of enc) {
        if (name === 'UTF-8' ? !mayUtf8 : !mayUtf16) continue;
        const n = list.findIndex((b) => s.indexOf(b) >= 0);
        if (n >= 0) { f.push({ file: x.rel, line: 0, reason: `ayah ${src.list[n].sora}:${src.list[n].aya_no} found (${name})` }); break; }
      }
    }
  }
  const texts = files.flatMap((x) => streams(x.buf).map(asText).filter((t): t is string => t !== null).map((text) => ({ rel: x.rel, text })));

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
      for (const run of arabicRuns(x.text)) {
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
      for (const run of arabicRuns(ln)) {
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
  let mode = 'layers 0 and 1 (no source given)';
  if (j > 0) { findings.push(...layer2(root, resolve(process.argv[j + 1]))); mode = 'layers 0, 1 and 2'; }
  const all = listFiles(root);
  const bytes = all.reduce((n, p) => n + statSync(p).size, 0);
  console.log(JSON.stringify({ root: relative(process.cwd(), root) || '.', mode, filesScanned: all.length, bytesScanned: bytes, allowListed: loadAllowList(root).length, findings: findings.length }));
  for (const x of findings.slice(0, 50)) console.log(JSON.stringify(x));
  process.exit(findings.length ? 1 : 0);
}
