// D-072 and D-073 search-form rules, on code points only (no Quran text, no Arabic in this file).
// The rules apply to search input and index words, never to displayed text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldQuery, foldTerm, makeFolds, RULES, isOn } from '../../src/core/variants.ts';
import { RULES_AWAITING_D012_REVIEWER } from '../../src/core/search-config.ts';
import { foldPlaceholder } from '../../src/core/fold.ts';
import { parseRef } from '../../src/core/query.ts';
import { buildIndex } from '../../scripts/build-index.ts';
import { openIndex } from '../../src/core/search-core.ts';
import { runQuery, type SearchOk } from '../../src/core/api.ts';
import { synthetic } from '../fixtures/load.ts';

const c = (...cps: number[]) => String.fromCodePoint(...cps);
const BA = 0x628, LAM = 0x644, MEEM = 0x645, YEH = 0x64a, KAF = 0x643, HEH = 0x647, ALEF = 0x627;

test('rule table: 15 rules under D-073, 3 under D-072, V-14 under D-074, 9 awaiting the D-012 reviewer', () => {
  const by = (s: string) => RULES.filter((r) => r.status === s).map((r) => r.id);
  assert.deepEqual(by('D-073'), ['V-01', 'V-02', 'V-03', 'V-04', 'V-06', 'V-08', 'V-12', 'V-16', 'V-19', 'V-20', 'V-21', 'V-22', 'V-23', 'V-24', 'V-28']);
  assert.deepEqual(by('D-072'), ['V-25', 'V-26', 'V-27']);
  assert.deepEqual(by('D-074'), ['V-14']);
  assert.deepEqual(by('awaiting D-012 reviewer'), ['V-05', 'V-07', 'V-09', 'V-10', 'V-11', 'V-13', 'V-15', 'V-17', 'V-18']);
  assert.equal(RULES.length, 28);
  assert.equal(RULES_AWAITING_D012_REVIEWER, 'interim-placeholder', 'interim mode awaiting the D-012 reviewer');
  assert.ok(RULES.filter((r) => r.status === 'awaiting D-012 reviewer').every((r) => !isOn(r)), 'no draft operation is on');
});

test('D-074: alef with hamza above or below reads as plain alef, in queries and index words', () => {
  for (const h of [0x623, 0x625]) {
    assert.equal(foldTerm(c(h, LAM)), c(ALEF, LAM));
    assert.equal(foldQuery(c(h, LAM)), c(ALEF, LAM));
    assert.equal(makeFolds('off').term(c(h, LAM)), c(ALEF, LAM), 'on in every mode');
  }
});

test('D-073: vowels, tanwin, shadda, sukun forms, maddah, tatweel, waqf and annotation signs are removed; alef wasla reads as alef', () => {
  const word = c(0x671, LAM, 0x651, 0x64e, MEEM, 0x6e1, 0x640, 0x653, BA, 0x64d, 0x6d6, 0x6e9, 0x658);
  assert.equal(foldTerm(word), c(ALEF, LAM, MEEM, BA));
  assert.equal(foldQuery(word), c(ALEF, LAM, MEEM, BA));
  assert.equal(foldQuery(c(0x621, BA)), c(0x621, BA), 'V-16 keeps standalone hamza');
});

test('awaiting the reviewer, interim mode: the placeholder removes the marks and maps no letter', () => {
  const removed = [0x656, 0x657, 0x65e, 0x670, 0x6e5, 0x6e6, 0x6e7, 0x6e8, 0x654, 0x655];
  const kept = [0x622, 0x624, 0x626, 0x649, 0x629];
  for (const p of removed) {
    assert.equal(foldTerm(c(BA, p, LAM)), c(BA, LAM), `U+${p.toString(16)} removed from index words`);
    assert.equal(foldQuery(c(BA, p, LAM)), c(BA, LAM), `U+${p.toString(16)} removed from queries`);
  }
  for (const p of kept) assert.equal(foldQuery(c(BA, p, LAM)), c(BA, p, LAM), `U+${p.toString(16)} kept`);
  // On every placeholder mark, the interim form equals the round 1 placeholder form.
  const marks = [...Array(0x65f - 0x64b + 1).keys()].map((i) => 0x64b + i).concat([0x670, 0x640], [...Array(0x6ed - 0x6d6 + 1).keys()].map((i) => 0x6d6 + i));
  for (const m of marks) assert.equal(foldTerm(c(BA, m, LAM)), foldPlaceholder(c(BA, m, LAM)), `U+${m.toString(16)}`);
});

test('awaiting the reviewer, off mode: those code points are left as they are', () => {
  const off = makeFolds('off');
  for (const p of [0x656, 0x657, 0x65e, 0x670, 0x6e5, 0x6e6, 0x6e7, 0x6e8, 0x654, 0x655, 0x622, 0x624, 0x626, 0x649, 0x629]) {
    assert.equal(off.term(c(BA, p, LAM)), c(BA, p, LAM), `U+${p.toString(16)} kept in index words`);
    assert.equal(off.query(c(BA, p, LAM)), c(BA, p, LAM), `U+${p.toString(16)} kept in queries`);
  }
});

test('awaiting the reviewer, draft mode: the draft operations apply', () => {
  const on = makeFolds('draft');
  assert.equal(on.term(c(BA, 0x670, LAM)), c(BA, LAM), 'V-07 draft removes the dagger alef');
  assert.equal(on.term(c(0x623, LAM)), c(ALEF, LAM), 'V-14 draft folds alef with hamza');
  assert.equal(on.query(c(0x622, LAM)), c(0x621, ALEF, LAM), 'V-13 draft');
  assert.equal(on.term(c(HEH, 0x640, 0x6e7, MEEM)), c(HEH, YEH, MEEM), 'V-10 draft sequence before tatweel removal');
});

test('V-24: invisible controls are removed from queries only', () => {
  for (const z of [0x61c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff]) {
    assert.equal(foldQuery(c(BA, z, LAM)), c(BA, LAM), z.toString(16));
    assert.equal(foldTerm(c(BA, z, LAM)), c(BA, z, LAM), 'not an index rule');
  }
});

test('D-072 V-25: Persian and Urdu keyboard letters read as Arabic (query side)', () => {
  assert.equal(foldQuery(c(0x6a9, 0x6cc)), c(KAF, YEH));
  for (const h of [0x6c1, 0x6be, 0x6d5]) assert.equal(foldQuery(c(BA, h)), c(BA, HEH));
  assert.equal(foldTerm(c(0x6a9)), c(0x6a9), 'not an index rule');
});

test('D-072 V-26: presentation forms and ligatures read as their letters (query side, fixed table)', () => {
  assert.equal(foldQuery(c(0xfe8f, 0xfedf, 0xfee3)), c(BA, LAM, MEEM), 'isolated, initial and medial forms');
  assert.equal(foldQuery(c(0xfefb)), c(LAM, ALEF), 'lam-alef ligature');
  assert.equal(foldQuery(c(0xfb50)), c(ALEF), 'alef wasla form, then V-12');
  assert.equal(foldQuery(c(0xfbfc)), c(YEH), 'Farsi yeh form, then V-25');
  assert.equal(foldQuery(c(BA, 0xfe72)), c(BA), 'isolated mark form gives the mark, which V-02 removes, with no space');
  assert.equal(foldQuery(c(0xfd3e, BA, 0xfd3f)), c(BA), 'V-21 ornate parentheses removed');
  const src = readFileSync('src/core/variants.ts', 'utf8') + readFileSync('src/core/presentation-forms.ts', 'utf8');
  assert.ok(!/\.normalize\(/.test(src), 'no run-time Unicode normalization');
});

test('D-072 V-27 and Q081: Extended Arabic-Indic digits and "S : A" with spaces are references', () => {
  const ext = (s: string) => s.replace(/\d/g, (d) => c(0x6f0 + Number(d)));
  assert.deepEqual(parseRef(ext('2:5')), { s: 2, a: 5 });
  assert.deepEqual(parseRef('2 : 5'), { s: 2, a: 5 });
  assert.deepEqual(parseRef(' 2 :5 '), { s: 2, a: 5 });
  assert.equal(parseRef('2 5'), null);
});

test('index: built with the same rule setting as the code, English names included', () => {
  const { src, ix } = synthetic('variants');
  const { buf } = buildIndex(src, 'draft');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  assert.throws(() => openIndex(ab), /different search rule setting/);

  assert.equal(ix.flags, 2 | 16, 'default index records the interim mode and D-074');
  assert.equal(openIndex(ab, 1 | 16).flags, 1 | 16);
  const r = runQuery(ix, '2:5', 1).data as SearchOk;
  assert.equal(r.offers[0].en, 'Synthetic 2');
  assert.equal(r.offers[0].name, src.list.find((a) => a.sora === 2)!.sora_name_ar);
});

test('index: a source holding a query-only code point is refused', () => {
  const { src } = synthetic('variants-q');
  const bad = { list: src.list.map((a, i) => (i === 3 ? { ...a, aya_text: a.aya_text + c(0x200d) } : a)), slices: src.slices };
  assert.throws(() => buildIndex(bad), /only query rules map/);
});
