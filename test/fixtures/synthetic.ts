// Made-up test data. It is generated at run time from code points and a fixed seed, so the
// repository holds no Arabic text at all. It is NOT Quran text and must never be shown as such.
// Output uses the same JSON layout as the development source, so the same reader code is tested.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SYN_COUNTS = [0, 7, 40, 12, 3, 120, 9, 5];

function rng(seed: number) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

const LETTERS = Array.from({ length: 0x64a - 0x628 + 1 }, (_, i) => 0x628 + i).filter((c) => c < 0x63b || c > 0x640);
const MARKS = [0x64e, 0x64f, 0x650, 0x652, 0x651];
const digits = (n: number) => String(n).replace(/\d/g, (d) => String.fromCodePoint(0x660 + Number(d)));

export function synWord(r: () => number, min = 3, max = 6): string {
  const n = min + Math.floor(r() * (max - min + 1));
  let s = '';
  for (let i = 0; i < n; i++) {
    s += String.fromCodePoint(LETTERS[Math.floor(r() * LETTERS.length)]);
    if (r() < 0.6) s += String.fromCodePoint(MARKS[Math.floor(r() * MARKS.length)]);
  }
  return s;
}

// Two strings that look the same but differ in bytes: shadda then kasra, and kasra then shadda.
// They are canonically equivalent, so any normalizing tool would make them equal (TP1-10).
export const SYN_EQUIV_A = String.fromCodePoint(0x628, 0x651, 0x650, 0x631);
export const SYN_EQUIV_B = String.fromCodePoint(0x628, 0x650, 0x651, 0x631);

export type SynOut = { dir: string; recordPath: string; sourcePath: string; sha256: string; common: string; rare: string };

export function makeSynthetic(dir: string, status = 'UNVERIFIED, synthetic test data'): SynOut {
  const r = rng(20261107);
  const common = synWord(r, 4, 4);
  const rare = synWord(r, 5, 5);
  const rows: string[] = [];
  let id = 0;
  for (let s = 1; s < SYN_COUNTS.length; s++) {
    const nameAr = synWord(r, 4, 6);
    for (let a = 1; a <= SYN_COUNTS[s]; a++) {
      const words: string[] = [];
      const n = 3 + Math.floor(r() * 9);
      for (let w = 0; w < n; w++) words.push(synWord(r));
      if ((s * 31 + a) % 5 < 3) words.splice(Math.floor(r() * words.length), 0, common);
      if (s === 3 && a === 2) words.push(rare);
      if (s === 2 && a === 5) words.push(SYN_EQUIV_A, SYN_EQUIV_B);
      if (s === 5 && a === 60) words.push(String.fromCodePoint(0x6de));
      const text = words.join(' ') + '\u00a0' + digits(a);
      id++;
      rows.push(`\t{\n\t\t"id" : ${id},\n\t\t"jozz" : 1,\n\t\t"sora" : ${s},\n\t\t"sora_name_en" : "Synthetic ${s}",\n\t\t"sora_name_ar" : "${nameAr}",\n\t\t"page" : 1,\n\t\t"line_start" : 1,\n\t\t"line_end" : 1,\n\t\t"aya_no" : ${a},\n\t\t"aya_text" : "${text}",\n\t\t"aya_text_emlaey" : ""\n\t}`);
    }
  }
  const body = Buffer.from('[\n' + rows.join(',\n') + '\n]\n', 'utf8');
  mkdirSync(dir, { recursive: true });
  const sourcePath = join(dir, 'synthetic-source.json');
  writeFileSync(sourcePath, body);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const recordPath = join(dir, 'source-record.json');
  writeFileSync(recordPath, JSON.stringify({ name: 'RIFQ synthetic test data', edition: 'generator seed 20261107', file: 'synthetic-source.json', sha256, status, decision: 'none' }, null, 2));
  return { dir, recordPath, sourcePath, sha256, common, rare };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = makeSynthetic(process.argv[2] ?? '.synthetic', process.argv[3]);
  console.log(JSON.stringify({ recordPath: out.recordPath, sha256: out.sha256 }));
}
