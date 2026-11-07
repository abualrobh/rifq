// Builds the read-only binary search index. Port of the prototype builder: same format, same bytes.
// Display text is the raw source bytes. The search form is the placeholder (not D-027 or D-028).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { foldPlaceholder, NOT_WORD, WORD_SPLIT } from '../src/core/fold.ts';
import { INDEX_MAGIC, INDEX_VERSION } from '../src/core/search-core.ts';
import type { Source } from '../src/core/source-adapter.ts';

export function buildIndex(src: Pick<Source, 'list' | 'slices'>): { buf: Buffer; stats: Record<string, number> } {
  const { list, slices } = src;
  const enc = new TextEncoder();
  const terms = new Map<string, number[]>();
  const wordAyah: number[] = [];
  const ayahFirstWord: number[] = [];
  list.forEach((a, n) => {
    ayahFirstWord.push(wordAyah.length);
    for (const tok of a.aya_text.split(WORD_SPLIT)) {
      if (!tok || NOT_WORD.test(tok)) continue;
      const form = foldPlaceholder(tok);
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
  const nameBufs = names.slice(1).map((n) => Buffer.from(n, 'utf8'));
  const nameBlob = Buffer.concat(nameBufs);
  const nameOff = new Uint32Array(nSurah + 1);
  let no = 0; nameBufs.forEach((s, i) => { nameOff[i] = no; no += s.length; }); nameOff[nSurah] = no;

  const ayahSurah = Uint16Array.from(list, (a) => a.sora);
  const ayahNo = Uint16Array.from(list, (a) => a.aya_no);
  const wordAyahU16 = Uint16Array.from(wordAyah);
  const firstU32 = Uint32Array.from(ayahFirstWord);

  const u = (t: ArrayBufferView) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
  const sections = [termOff, postOff, postings, firstU32, textOff, nameOff, wordAyahU16, ayahSurah, ayahNo].map(u).concat([termBlob, textBlob, nameBlob]);
  const HEADER_U32 = 6 + sections.length;
  const header = new Uint32Array(HEADER_U32);
  header.set([INDEX_MAGIC, INDEX_VERSION, nAyah, nWords, nTerms, nSurah]);
  let off = HEADER_U32 * 4;
  sections.forEach((s, i) => { off = Math.ceil(off / 4) * 4; header[6 + i] = off; off += s.length; });
  const buf = Buffer.alloc(off);
  u(header).copy(buf, 0);
  sections.forEach((s, i) => s.copy(buf, header[6 + i]));
  return { buf, stats: { bytes: buf.length, nAyah, nWords, nTerms, nSurah, textBytes: textBlob.length } };
}

export function writeIndex(src: Pick<Source, 'list' | 'slices'>, outPath: string) {
  const r = buildIndex(src);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, r.buf);
  return r;
}
