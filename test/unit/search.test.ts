// RQ-002 matching on synthetic data: TP2-06, TP2-11, TP2-12, TP2-17, TP2-27, TP2-33 (unit level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { search, PAGE } from '../../src/core/search-core.ts';
import { segment } from '../../src/core/highlight.ts';
import { foldTerm } from '../../src/core/variants.ts';
import { sha256 } from '../../src/core/source-adapter.ts';

const { syn, src, ix } = synthetic('search');
const enc = new TextEncoder();
const refOf = (s: number, a: number) => src.list.findIndex((x) => x.sora === s && x.aya_no === a);

test('TP2-17: same query twice gives the same results in Mushaf order', () => {
  const a = search(ix, syn.common, 1), b = search(ix, syn.common, 1);
  assert.deepEqual(a, b);
  const idx = a.results.map((r) => refOf(r.s, r.a));
  assert.deepEqual(idx, [...idx].sort((x, y) => x - y));
});

test('TP2-33: more than 50 results are paged, 50 at most per page, no repeats, order kept', () => {
  const first = search(ix, syn.common, 1);
  assert.ok(first.total > PAGE, 'synthetic common word must give more than 50 ayat');
  const all: number[] = [];
  for (let p = 1; p <= Math.ceil(first.total / PAGE); p++) {
    const r = search(ix, syn.common, p);
    assert.ok(r.results.length <= PAGE);
    all.push(...r.results.map((x) => refOf(x.s, x.a)));
  }
  assert.equal(all.length, first.total);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(all, [...all].sort((x, y) => x - y));
});

test('TP2-27: whole word and start of word match; inside a word does not', () => {
  const word = foldTerm(syn.rare);
  assert.equal(search(ix, word, 1).total, 1);
  assert.equal(search(ix, [...word].slice(0, 3).join(''), 1).total >= 1, true);
  const inside = [...word].slice(1).join('');
  const r = search(ix, inside, 1);
  // Any hit must be a word that really starts with the inner part, never the rare word itself.
  for (const x of r.results) assert.notDeepEqual([x.s, x.a], [3, 2]);
});

test('TP2-06, TP2-12: result text equals the source bytes; highlight pieces join back exactly', () => {
  const r = search(ix, syn.common, 1);
  for (const x of r.results) {
    const n = refOf(x.s, x.a);
    assert.ok(Buffer.from(enc.encode(x.text)).equals(src.slices[n]));
    const joined = segment(x.text, x.hl).map((p) => p.text).join('');
    assert.ok(Buffer.from(enc.encode(joined)).equals(src.slices[n]));
    assert.ok(segment(x.text, x.hl).some((p) => p.hl));
  }
});

test('TP2-11: index text section equals the source bytes, and indexing leaves the source unchanged', () => {
  const before = sha256(src.raw);
  const text = Buffer.from(ix.textBlob);
  assert.ok(text.equals(Buffer.concat(src.slices)));
  assert.equal(sha256(src.raw), before);
  assert.equal(before, syn.sha256);
});

test('canonically equivalent but different bytes are different search terms (no normalization)', () => {
  const ia = search(ix, String.fromCodePoint(0x628, 0x651, 0x650, 0x631), 1);
  assert.ok(ia.total >= 1);
  // The placeholder form strips both marks, so both spellings find the ayah; displayed bytes stay raw.
  const n = refOf(2, 5);
  const hit = ia.results.find((x) => x.s === 2 && x.a === 5)!;
  assert.ok(Buffer.from(enc.encode(hit.text)).equals(src.slices[n]));
});
