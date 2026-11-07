// Build-time reader for the source file named by the source record. Node only.
// The file is read as bytes. Ayah text is taken as exact byte slices, and the parsed JSON is
// checked against those bytes, so nothing downstream can depend on a changed string.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SourceRecord } from './source-gate.ts';

export type Ayah = { sora: number; aya_no: number; sora_name_ar: string; sora_name_en: string; aya_text: string };
export type Loaded = { record: SourceRecord; recordPath: string; filePath: string; sha256: string | null; raw: Buffer | null };
export type Source = Loaded & { raw: Buffer; list: Ayah[]; slices: Buffer[] };

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export function readRecord(recordPath: string): Loaded {
  const record = JSON.parse(readFileSync(recordPath, 'utf8')) as SourceRecord;
  const filePath = resolve(dirname(recordPath), String(record?.file ?? ''));
  if (!record?.file || !existsSync(filePath)) return { record, recordPath, filePath, sha256: null, raw: null };
  const raw = readFileSync(filePath);
  return { record, recordPath, filePath, sha256: sha256(raw), raw };
}

const KEY = Buffer.from('"aya_text" : "');

// Exact byte slices of every aya_text, taken from the raw file without JSON parsing.
// Valid only when the file has no backslash escapes, which is checked.
export function rawAyahSlices(raw: Buffer): Buffer[] {
  if (raw.includes(0x5c)) throw new Error('source has escapes; raw slicing is not valid');
  const out: Buffer[] = [];
  let i = 0;
  for (;;) {
    const k = raw.indexOf(KEY, i);
    if (k < 0) break;
    const start = k + KEY.length;
    const end = raw.indexOf(0x22, start);
    out.push(raw.subarray(start, end));
    i = end + 1;
  }
  return out;
}

export function loadSource(recordPath: string): Source {
  const l = readRecord(recordPath);
  if (!l.raw) throw new Error('source file missing');
  if (l.sha256 !== l.record.sha256) throw new Error('source SHA-256 does not match the record');
  const list = JSON.parse(l.raw.toString('utf8')) as Ayah[];
  const slices = rawAyahSlices(l.raw);
  if (slices.length !== list.length) throw new Error('slice count mismatch');
  list.forEach((a, n) => {
    if (!Buffer.from(a.aya_text, 'utf8').equals(slices[n])) throw new Error('parse changed bytes at index ' + n);
  });
  // Order check: surah numbers never go down, ayah numbers run 1..n inside each surah.
  let ps = 0, pa = 0;
  for (const a of list) {
    if (a.sora === ps) { if (a.aya_no !== pa + 1) throw new Error(`ayah order break at ${a.sora}:${a.aya_no}`); }
    else { if (a.sora !== ps + 1 || a.aya_no !== 1) throw new Error(`surah order break at ${a.sora}:${a.aya_no}`); }
    ps = a.sora; pa = a.aya_no;
  }
  return { ...l, raw: l.raw, list, slices };
}

export type Surah = { n: number; ar: string; en: string; items: Ayah[] };
export function surahsOf(list: Ayah[]): Surah[] {
  const out: Surah[] = [];
  for (const a of list) {
    let s = out[a.sora - 1];
    if (!s) s = out[a.sora - 1] = { n: a.sora, ar: a.sora_name_ar, en: a.sora_name_en, items: [] };
    s.items.push(a);
  }
  return out;
}
