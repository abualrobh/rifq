// RQ-004 v1.0 decisions (unit level): D-092 article matching (index and search offers share it),
// D-091 English name matching, D-090 juz starts, and the bidi isolation of Latin runs in Arabic text.
// Names here are built from code points (only strings.ts may hold Arabic characters) or made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterArticle, enKeys, foldEn, matchSurahNames, matchSurahNamesEn } from '../../src/core/surah-match.ts';
import { filterIndex, visibleRows } from '../../src/core/index-filter.ts';
import { juzStarts, type Ayah } from '../../src/core/source-adapter.ts';
import { bidiHtml, bidiParts } from '../../src/core/bidi.ts';
import { escapeHtml } from '../../src/core/highlight.ts';

const ar = (...cps: number[]) => String.fromCodePoint(...cps);
const AL = [0x627, 0x644];
// Made-up names: 1 = article + beh qaf reh, 2 = beh qaf (no article), 3 = article + lam yeh
const folded = ['', ar(...AL, 0x628, 0x642, 0x631), ar(0x628, 0x642), ar(...AL, 0x644, 0x64a)];

test('D-092: a start of 2 or more letters matches from just after the Arabic article too', () => {
  assert.equal(afterArticle(folded[1]), ar(0x628, 0x642, 0x631));
  assert.equal(afterArticle(folded[2]), '');
  assert.deepEqual(matchSurahNames(folded, ar(0x628, 0x642)), [1, 2]);
  assert.deepEqual(matchSurahNames(folded, ar(...AL, 0x628)), [1]);
  assert.deepEqual(matchSurahNames(folded, ar(0x644, 0x64a)), [3]);
  // One letter is still not a start-of-name match.
  assert.deepEqual(matchSurahNames(folded, ar(0x628)), []);
  // The article alone matches every name that starts with it (2 letters), as before.
  assert.deepEqual(matchSurahNames(folded, ar(...AL)), [1, 3]);
});

test('D-091: English keys ignore case, macrons, dots below, marks, hyphens and the article', () => {
  assert.equal(foldEn('Āl-‘Ostrāv'), 'alostrav');
  assert.deepEqual(enKeys('Al-Zorbin'), ['alzorbin', 'zorbin']);
  assert.deepEqual(enKeys('Aṣ-Ṣeltāf'), ['asseltaf', 'seltaf']);
  assert.deepEqual(enKeys('Ash-Shorvan'), ['ashshorvan', 'shorvan']);
  assert.deepEqual(enKeys('Āl-‘Ostrāv'), ['alostrav', '']);
  assert.deepEqual(enKeys('Ṭā-Ki'), ['taki', '']);
  assert.deepEqual(enKeys('Yūmek'), ['yumek', '']);
  const keys = [['', ''], enKeys('Al-Zorbin'), enKeys('Āl-‘Ostrāv'), enKeys('Yūmek')] as [string, string][];
  for (const q of ['zor', 'ZOR', 'al-zor', 'Al Zorbin', 'alzorbin']) assert.deepEqual(matchSurahNamesEn(keys, q), [1], q);
  // "Āl" (with a macron, a made-up name here) is not the article, so only the whole-name start matches.
  for (const [q, want] of [['Al Ostrav', true], ['al-ost', true], ['ost', false], ['aal', false]] as const) assert.equal(matchSurahNamesEn(keys, q).includes(2), want, q);
  assert.deepEqual(matchSurahNamesEn(keys, 'yumek'), [3]);
  assert.deepEqual(matchSurahNamesEn(keys, 'y'), []);
});

test('D-091: Latin letters match English names in the English interface only', () => {
  const counts = [0, 7, 7, 7];
  const en = [['', ''], enKeys('Al-Zorbin'), enKeys('Yūmek'), enKeys('Al-Vintar')] as [string, string][];
  assert.equal(filterIndex(folded, counts, 'zor').kind, 'latin');
  assert.deepEqual(visibleRows(filterIndex(folded, counts, 'zor', en)), [1]);
  assert.deepEqual(visibleRows(filterIndex(folded, counts, 'zzz', en)), []);
  // Arabic and references still work in the English interface.
  assert.deepEqual(visibleRows(filterIndex(folded, counts, ar(0x628, 0x642), en)), [1, 2]);
  assert.deepEqual(visibleRows(filterIndex(folded, counts, '2:3', en)), [2]);
});

test('D-090: juz N starts at the first record whose jozz is N, in source order', () => {
  const rec = (sora: number, aya_no: number, jozz: number) => ({ sora, aya_no, jozz, sora_name_ar: '', sora_name_en: '', aya_text: '' }) as Ayah;
  const list = [rec(1, 1, 1), rec(1, 2, 1), rec(2, 1, 1), rec(2, 2, 2), rec(2, 3, 2), rec(3, 1, 3)];
  assert.deepEqual(juzStarts(list), [{ juz: 1, s: 1, a: 1 }, { juz: 2, s: 2, a: 2 }, { juz: 3, s: 3, a: 1 }]);
  assert.deepEqual(juzStarts([{ ...rec(1, 1, 1), jozz: undefined }]), []);
});

test('bidi: each Latin run in Arabic text is isolated, and the text is unchanged', () => {
  const comma = ar(0x60c);
  const text = `${ar(0x646, 0x633)} (D-076${comma} D-012${comma} D-008).`;
  const parts = bidiParts(text, true);
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(parts.filter((p) => p.ltr).map((p) => p.text), ['D-076', 'D-012', 'D-008']);
  assert.deepEqual(bidiParts(`${ar(0x628)} SHA-256`, true).filter((p) => p.ltr).map((p) => p.text), ['SHA-256']);
  assert.deepEqual(bidiParts(`${ar(0x645, 0x646)} Quran Foundation.`, true).filter((p) => p.ltr).map((p) => p.text), ['Quran Foundation']);
  assert.deepEqual(bidiParts('Search D-027 rules', false), [{ text: 'Search D-027 rules', ltr: false }]);
  assert.equal(bidiHtml(`${ar(0x628)} (D-045) <x>`, true, escapeHtml), `${ar(0x628)} (<bdi dir="ltr">D-045</bdi>) &lt;<bdi dir="ltr">x</bdi>&gt;`);
});
