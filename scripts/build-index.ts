// Builds the read-only binary search index (format version 2, see search-core.ts).
// Display text is the raw source bytes. Index words use the search form of the D-027 rules approved
// under D-073 (variants.ts); rules awaiting the D-012 reviewer follow the mode in search-config.ts. Surah names
// in Arabic and English are copied from the source as stored.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NOT_WORD, WORD_SPLIT } from '../src/core/fold.ts';
import { INDEX_MAGIC, INDEX_VERSION, indexFlags } from '../src/core/search-core.ts';
import { RULES_AWAITING_D012_REVIEWER, type PendingMode } from '../src/core/search-config.ts';
import { makeFolds, queryOnlyCodePoints } from '../src/core/variants.ts';
import type { Source } from '../src/core/source-adapter.ts';

export function buildIndex(src: Pick<Source, 'list' | 'slices'>, mode: PendingMode = RULES_AWAITING_D012_REVIEWER): { buf: Buffer; stats: Record<string, number> } {
  const { list, slices } = src;
  const enc = new TextEncoder();
  const fold = makeFolds(mode).term;
  // Query-only rules (V-24, V-25, V-26) must have nothing to act on in the source.
  const qOnly = queryOnlyCodePoints();
  let queryOnlyInSource = 0;
  for (const a of list) for (const ch of a.aya_text) if (qOnly.has(ch.codePointAt(0)!)) queryOnlyInSource++;
  if (queryOnlyInSource) throw new Error(`source holds ${queryOnlyInSource} code points that only query rules map`);
  const terms = new Map<string, number[]>();
  const wordAyah: number[] = [];
  const ayahFirstWord: number[] = [];
  list.forEach((a, n) => {
    ayahFirstWord.push(wordAyah.length);
    for (const tok of a.aya_text.split(WORD_SPLIT)) {
      if (!tok || NOT_WORD.test(tok)) continue;
      const form = fold(tok);
      if (!form) throw new Error('empty form at ayah index ' + n);
      const g = wordAyah.length;
      wordAyah.push(n);
      let p = terms.get(form);
      if (!p) terms.set(form, (p = []));
      p.push(g);
    }
  });
  ayahFirstWord.push(wordAyah.length);
  const nWords = wordAyah.length, nAyah = list.length;
  if (nAyah > 65535 || nWords > 0xffffffff) throw new Error('index too large for format v1');

  const sorted = [...terms.keys()].map((f) => [Buffer.from(enc.encode(f)), f] as const).sort((a, b) => Buffer.compare(a[0], b[0]));
  const nTerms = sorted.length;
  const termBlob = Buffer.concat(sorted.map((x) => x[0]));
  const termOff = new Uint32Array(nTerms + 1);
  const postOff = new Uint32Array(nTerms + 1);
  const postings = new Uint32Array(nWords);
  let tb = 0, pb = 0;
  sorted.forEach(([b, f], i) => {
    termOff[i] = tb; postOff[i] = pb; tb += b.length;
    for (const g of terms.get(f)!) postings[pb++] = g;
  });
  termOff[nTerms] = tb; postOff[nTerms] = pb;

  const textBlob = Buffer.concat(slices);
  const textOff = new Uint32Array(nAyah + 1);
  let to = 0; slices.forEach((s, i) => { textOff[i] = to; to += s.length; }); textOff[nAyah] = to;

  const names: string[] = [];
  for (const a of list) names[a.sora] = a.sora_name_ar;
  const nSurah = names.length - 1;
  const namesEn: string[] = [];
  for (const a of list) namesEn[a.sora] = a.sora_name_en;
  const blob = (arr: string[]) => {
    const bufs = arr.slice(1).map((n) => Buffer.from(n, 'utf8'));
    const off = new Uint32Array(nSurah + 1);
    let no = 0; bufs.forEach((s, i) => { off[i] = no; no += s.length; }); off[nSurah] = no;
    return { blob: Buffer.concat(bufs), off };
  };
  const { blob: nameBlob, off: nameOff } = blob(names);
  const { blob: nameEnBlob, off: nameEnOff } = blob(namesEn);

  const ayahSurah = Uint16Array.from(list, (a) => a.sora);
  const ayahNo = Uint16Array.from(list, (a) => a.aya_no);
  const wordAyahU16 = Uint16Array.from(wordAyah);
  const firstU32 = Uint32Array.from(ayahFirstWord);

  const u = (t: ArrayBufferView) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
  const sections = [termOff, postOff, postings, firstU32, textOff, nameOff, wordAyahU16, ayahSurah, ayahNo, nameEnOff].map(u).concat([termBlob, textBlob, nameBlob, nameEnBlob]);
  const flags = indexFlags(mode);
  const HEADER_U32 = 7 + sections.length;
  const header = new Uint32Array(HEADER_U32);
  header.set([INDEX_MAGIC, INDEX_VERSION, nAyah, nWords, nTerms, nSurah, flags]);
  let off = HEADER_U32 * 4;
  sections.forEach((s, i) => { off = Math.ceil(off / 4) * 4; header[7 + i] = off; off += s.length; });
  const buf = Buffer.alloc(off);
  u(header).copy(buf, 0);
  sections.forEach((s, i) => s.copy(buf, header[7 + i]));
  return { buf, stats: { bytes: buf.length, nAyah, nWords, nTerms, nSurah, flags, textBytes: textBlob.length } };
}

export function writeIndex(src: Pick<Source, 'list' | 'slices'>, outPath: string) {
  const r = buildIndex(src);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, r.buf);
  return r;
}
