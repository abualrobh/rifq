// Kit v39, unit level.
//   (Part A, D-208 C, is in kit-v39a.test.ts.)
//   RQ-008 stage 3: the 17 new keys exist in both tables, the English text exactly as drafted
//   in RQ-008 v1.0's table (the Arabic text is compared with the table by a private check outside the
//   repository: no Arabic characters in test files); splitAyahNumber (P-23, AC99, AC107); the byte
//   check's ornament form; the Go to rules (core/goto.ts: AC60 to AC63, D-190 C, D-064, D-092).
// No Arabic characters and no Quran text in this file: Arabic names and the juz keyword are built
// from code points or taken from strings.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../../src/core/strings.ts';
import { splitAyahNumber, AYAH_NO_OPEN, AYAH_NO_CLOSE } from '../../src/core/ayah-number.ts';
import { ornamented, compareSurahPage, type ByteReport } from '../../scripts/check-bytes.ts';
import { gotoResults, type GotoData } from '../../src/core/goto.ts';
import { enKeys, foldName } from '../../src/core/surah-match.ts';

const cp = (...c: number[]) => String.fromCodePoint(...c);
const NBSP = ' ';

const EN: Record<string, string> = {
  surahMeta: 'Surah {s} · {n} · Juz {j}',
  goTo: 'Go to',
  back: 'Back',
  gotoLabel: 'Go to a surah, ayah or juz',
  gotoPlaceholder: 'e.g. {ref}, {name} {a} or juz {j}',
  gotoSearchLabel: 'Go to or search',
  kindAyah: 'Ayah',
  kindSurah: 'Surah',
  kindJuz: 'Juz',
  gotoAyahResult: '{name}, ayah {a}',
  gotoSurahSub: 'Surah {s} · {n}',
  gotoJuzSub: 'Starts at {s}:{a}',
  searchTextTitle: 'Search the Quran text',
  searchTextHint: 'Type an Arabic word to search the ayat',
  youCanType: 'You can type',
  notSaved: 'Nothing you type here is saved',
  juzMissing: 'There is no juz with this number. Juz run from 1 to 30.',
};

test('RQ-008 stage 3 strings: 17 new keys in both tables; English as drafted in RQ-008 v1.0', () => {
  assert.equal(Object.keys(EN).length, 17);
  for (const [k, v] of Object.entries(EN)) {
    assert.equal((STRINGS.en as Record<string, string>)[k], v, `en.${k}`);
    const ar = (STRINGS.ar as Record<string, string>)[k];
    assert.ok(ar && ar.trim(), `ar.${k}`);
    assert.deepEqual((ar.match(/\{\w+\}/g) ?? []).sort(), (v.match(/\{\w+\}/g) ?? []).sort(), `placeholders of ${k}`);
  }
});

test('P-23: splitAyahNumber isolates the digits after the last no-break space; head + no is the text', () => {
  const word = cp(0x628, 0x633, 0x645);
  for (const no of [cp(0x661), cp(0x662, 0x668, 0x666), '7', cp(0x6f1, 0x6f2)]) {
    const text = `${word} ${word}${NBSP}${no}`;
    const x = splitAyahNumber(text)!;
    assert.equal(x.no, no);
    assert.equal(x.head + x.no, text);
    assert.ok(x.head.endsWith(NBSP));
  }
  // AC107: no ornament when the stored text does not end that way.
  for (const bad of [`${word}`, `${word} 5`, `${word}${NBSP}`, `${word}${NBSP}5${word}`, `${word}${NBSP}12345`, `${word}${NBSP}5 `]) assert.equal(splitAyahNumber(bad), null, JSON.stringify(bad));
  // No END OF AYAH sign is ever added.
  assert.ok(!(splitAyahNumber(`${word}${NBSP}${cp(0x661)}`)!.head + AYAH_NO_OPEN).includes(cp(0x6dd)));
});

test('P-23 byte check: a reader ayah equals only the stored bytes with the one ornament element at the exact place', () => {
  const word = cp(0x628, 0x633, 0x645);
  const text = `${word}${NBSP}${cp(0x661, 0x662)}`;
  const b = Buffer.from(text);
  const o = Buffer.from(ornamented(b));
  assert.equal(o.toString(), `${word}${NBSP}${AYAH_NO_OPEN}${cp(0x661, 0x662)}${AYAH_NO_CLOSE}`);
  assert.equal(Buffer.from(ornamented(Buffer.from(word))).toString(), word);
  const src = { list: [{ sora: 1, aya_no: 1 }], slices: [b] } as never;
  const page = (inner: string) => Buffer.from(`<p class="ayah" data-r="1:1">${inner}</p>`);
  const run = (inner: string, reader: boolean) => {
    const rep: ByteReport = { route: '/', pages: 0, ayat: 0, equal: 0, mismatches: [], refErrors: [], ...(reader ? { ornament: 0, plain: [] } : {}) };
    compareSurahPage(src, 1, page(inner), rep);
    return rep;
  };
  assert.equal(run(o.toString(), true).equal, 1);
  assert.equal(run(o.toString(), true).ornament, 1);
  assert.equal(run(text, true).equal, 0, 'a reader page without the element fails');
  assert.equal(run(`${word}${NBSP}<span class="x">${cp(0x661, 0x662)}</span>`, true).equal, 0, 'another element fails');
  assert.equal(run(`${word} ${NBSP}${AYAH_NO_OPEN}${cp(0x661, 0x662)}${AYAH_NO_CLOSE}`, true).equal, 0, 'a changed character fails');
  assert.equal(run(text, false).equal, 1, 'other routes keep the plain text');
});

// A made-up 5-surah source: names built from code points, English names with articles.
const AR = [
  cp(0x627, 0x644, 0x641, 0x627, 0x62a, 0x62d, 0x629),
  cp(0x627, 0x644, 0x628, 0x642, 0x631, 0x629),
  cp(0x622, 0x644, 0x20, 0x639, 0x645, 0x631, 0x627, 0x646),
  cp(0x627, 0x644, 0x646, 0x633, 0x627, 0x621),
  cp(0x627, 0x644, 0x628, 0x642, 0x645),
];
const EN_NAMES = ['Al-Fatihah', 'Al-Baqarah', 'Ali Imran', 'An-Nisa', 'Al-Baqm'];
const data = (lang: 'ar' | 'en'): GotoData => ({
  lang,
  folded: ['', ...AR.map(foldName)],
  en: lang === 'en' ? [['', ''], ...EN_NAMES.map(enKeys)] : undefined,
  counts: [0, 7, 286, 200, 176, 3],
  juz: Array.from({ length: 30 }, (_, i) => ({ juz: i + 1, s: Math.min(5, 1 + Math.floor(i / 6)), a: 1 + (i % 6) })),
});
const JUZ = t('ar', 'kindJuz');
const ART = cp(0x627, 0x644);
const kinds = (q: string, lang: 'ar' | 'en' = 'ar') => { const r = gotoResults(q, data(lang)); return r.msg ?? r.results.map((x) => (x.kind === 'juz' ? `juz ${x.j} ${x.s}:${x.a}` : x.kind === 'ayah' ? `ayah ${x.s}:${x.a}` : `surah ${x.s}`)).join(','); };

test('Go to (AC60, D-064, D-072): references in any digits; a valid ayah also gives its surah; out of range is refMissing; a bare number is a surah', () => {
  assert.equal(kinds('2:255'), 'ayah 2:255,surah 2');
  assert.equal(kinds(' 2 : 255 '), 'ayah 2:255,surah 2');
  assert.equal(kinds(cp(0x662, 0x3a, 0x662, 0x665, 0x665)), 'ayah 2:255,surah 2');
  assert.equal(kinds(cp(0x6f3)), 'surah 3');
  assert.equal(kinds('5'), 'surah 5');
  assert.equal(kinds('6'), 'refMissing');
  assert.equal(kinds('0'), 'refMissing');
  assert.equal(kinds('2:287'), 'refMissing');
  assert.equal(kinds('2:0'), 'refMissing');
  assert.equal(kinds(''), '');
  assert.equal(kinds('   '), '');
  assert.equal(kinds('1'.repeat(101)), 'tooLong');
});

test('Go to (AC61, AC62, D-092): names by the start rule, also after the article; name and ayah; source order', () => {
  assert.equal(kinds(AR[1]), 'surah 2');
  assert.equal(kinds(cp(0x628, 0x642)), 'surah 2,surah 5'); // start after the article, 2 letters, source order
  assert.equal(kinds(cp(0x628)), ''); // one letter is not enough for a start match
  assert.equal(kinds(`${AR[1]} 255`), 'ayah 2:255');
  assert.equal(kinds(`${cp(0x628, 0x642)} 3`), 'ayah 2:3,ayah 5:3');
  assert.equal(kinds(`${cp(0x628, 0x642)} 4`), 'ayah 2:4');
  assert.equal(kinds(`${AR[0]} 8`), 'refMissing');
  assert.equal(kinds(`${AR[1]} ${cp(0x662, 0x665, 0x665)}`), 'ayah 2:255');
});

test('Go to (AC63, D-190 C, D-050): the juz keyword in Arabic (with or without the article) in both interfaces; Latin juz in English only', () => {
  for (const lang of ['ar', 'en'] as const) {
    assert.equal(kinds(`${JUZ} 30`, lang), 'juz 30 5:6');
    assert.equal(kinds(`${ART}${JUZ} 3`, lang), 'juz 3 1:3');
    assert.equal(kinds(`${JUZ}${cp(0x663)}`, lang), 'juz 3 1:3');
    assert.equal(kinds(`${JUZ} 31`, lang), 'juzMissing');
    assert.equal(kinds(`${JUZ} 0`, lang), 'juzMissing');
  }
  assert.equal(kinds('juz 30', 'en'), 'juz 30 5:6');
  assert.equal(kinds('JUZ 2', 'en'), 'juz 2 1:2');
  assert.equal(kinds('juz 31', 'en'), 'juzMissing');
  assert.equal(kinds('juz 30', 'ar'), 'latinOnly');
  assert.equal(kinds('baqarah', 'ar'), 'latinOnly');
});

test('Go to (AC61, D-091, D-190 C): English names match in the English interface only, with and without the article', () => {
  assert.equal(kinds('Al-Baqarah', 'en'), 'surah 2');
  assert.equal(kinds('baqa', 'en'), 'surah 2');
  assert.equal(kinds('baq', 'en'), 'surah 2,surah 5');
  assert.equal(kinds('Al-Baqarah 255', 'en'), 'ayah 2:255');
  assert.equal(kinds('nisa 177', 'en'), 'refMissing');
  // Arabic names still match in the English interface.
  assert.equal(kinds(AR[3], 'en'), 'surah 4');
});
