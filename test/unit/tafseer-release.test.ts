// D-084 quote check (changes D-078), D-079 store format, and the AC15 release check, on synthetic
// data and the mock. Phrases are cut from the synthetic source by program; no Arabic is typed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { bareAyah, uthmaniLetters, stripInvisibles, composeHamza, lettersIndex, chapterPassages, checkPassage, findPhrases, indexFromSource, lettersOnly, lettersOnlyWords, matchPhrase, newSummary, reviewCsv, type ReviewItem } from '../../src/core/tafseer-quotes.ts';
import { checkFingerprints, sha256Hex } from '../../src/core/tafseer-fingerprints.ts';
import { releaseRecordProblems, runTafseerCheck, TAFSEER_RECORD_FORMAT } from '../../scripts/tafseer-release-check.ts';
import { fingerprintEntries } from '../../scripts/tafseer-fingerprint.ts';
import { CASE, CLOSE, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID, OPEN, passageText, quoteFrom } from '../mock/qf-mock.ts';

const { src, syn } = synthetic('tafseer-release');
const ix = indexFromSource(src.list);
const words = (s: number, a: number) => bareAyah(src.list.find((x) => x.sora === s && x.aya_no === a)!.aya_text).split(' ');
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', QF_TEST_BASE: 'http://127.0.0.1:9998' };
const cp = (...c: number[]) => String.fromCodePoint(...c);
const own = (s: number, a: number) => ({ s, from: a, to: a });

test('D-084 letters-only form: marks, Quranic signs, tatweel, digits and punctuation go; spelling rules apply', () => {
  // A word with fatha, shadda, sukun, tanween, superscript alef, a small high mark (U+06D6), an
  // annotation sign (U+0610) and tatweel reads as its bare letters.
  const bare = cp(0x628, 0x644, 0x645);
  assert.equal(lettersOnly(cp(0x628, 0x64e, 0x651, 0x644, 0x640, 0x652, 0x670, 0x645, 0x64b, 0x6d6, 0x610)), bare);
  // Ayah numbers in Arabic-Indic, extended and Latin digits, and punctuation, are dropped.
  assert.deepEqual(lettersOnlyWords(`${bare} ${cp(0x662)} ${cp(0x6f3)} 7 , ${cp(0x60c)} ${bare}. "${bare}"`), [bare, bare, bare]);
  // Alef wasla reads as alef (rule V-12, D-073; nothing added).
  assert.equal(lettersOnly(cp(0x671, 0x644, 0x62b, 0x632)), lettersOnly(cp(0x627, 0x644, 0x62b, 0x632)));
  // Hamza on alef reads as alef (V-14, D-074); a Farsi yeh as yeh (V-25, D-072).
  assert.equal(lettersOnly(cp(0x623, 0x62b, 0x632)), cp(0x627, 0x62b, 0x632));
  assert.equal(lettersOnly(cp(0x641, 0x6cc)), cp(0x641, 0x64a));
  // Alef maqsura and yeh stay apart (V-17 awaits the D-012 reviewer).
  assert.notEqual(lettersOnly(cp(0x62b, 0x632, 0x649)), lettersOnly(cp(0x62b, 0x632, 0x64a)));
  assert.deepEqual(lettersOnlyWords('Latin words only'), []);
});

test('API superscript alef: HAIR SPACE + U+0670 + WORD JOINER stays inside the word', () => {
  // The exact sequence seen in the real pre-live text, built from code points: sad, kasra, ra,
  // fatha, HAIR SPACE, superscript alef, WORD JOINER, ta, fatha.
  const api = cp(0x635, 0x650, 0x631, 0x64e, 0x200a, 0x670, 0x2060, 0x637, 0x64e);
  assert.deepEqual(lettersOnlyWords(api), [cp(0x635, 0x631, 0x637)]);
  // The same word as the approved file would store it (no spaces or joiners) gives the same letters.
  assert.equal(lettersOnly(cp(0x635, 0x650, 0x631, 0x64e, 0x670, 0x637, 0x64e)), lettersOnly(api));
  // Every listed invisible is removed, not turned into a space.
  for (const inv of [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0xad, 0x34f, 0x61c, 0x180e]) {
    assert.deepEqual(lettersOnlyWords(cp(0x628, inv, 0x644)), [cp(0x628, 0x644)], inv.toString(16));
  }
  // A narrow space before any combining mark is removed; elsewhere it still separates words.
  for (const sp of [0x2000, 0x2005, 0x2009, 0x200a, 0x202f]) {
    assert.deepEqual(lettersOnlyWords(cp(0x628, sp, 0x64e, 0x644)), [cp(0x628, 0x644)], sp.toString(16));
    assert.deepEqual(lettersOnlyWords(cp(0x628, sp, 0x644)), [cp(0x628), cp(0x644)], sp.toString(16) + ' between letters');
  }
  // stripInvisibles changes nothing else, and the Tafseer text itself is never touched.
  const plain = cp(0x628, 0x64e, 0x20, 0x644);
  assert.equal(stripInvisibles(plain), plain);
  assert.equal(api.length, 9, 'the input string is unchanged');
});

test('regression: Uthmani quotes written the API way match their own ayah (1:6 and 1:7 style)', () => {
  // Made-up "ayat" built from code points, each with a superscript alef, as the approved file would
  // store it; the "quote" is the same words written with HAIR SPACE + U+0670 + WORD JOINER, an ayah
  // number inside, in ornate parentheses. Not Quran text.
  // Made-up words (arbitrary letters with marks and a superscript alef), not Quran words.
  const w1 = cp(0x62b, 0x64e, 0x62c, 0x652, 0x62e, 0x650, 0x632);
  const w2 = cp(0x634, 0x64f, 0x63a, 0x64e, 0x670, 0x641, 0x650);
  const w3 = cp(0x636, 0x64e, 0x638, 0x651, 0x64e, 0x670, 0x642, 0x652, 0x643);
  const w4 = cp(0x630, 0x650, 0x632, 0x64e, 0x670, 0x62d, 0x64f);
  const w5 = cp(0x62c, 0x64e, 0x636, 0x652, 0x62b, 0x650, 0x63a);
  const stored6 = [w1, w2, w3].join(' ');
  const stored7 = [w4, w5].join(' ');
  const idx = lettersIndex([{ s: 9, a: 6, letters: lettersOnly(stored6) }, { s: 9, a: 7, letters: lettersOnly(stored7) }]);
  const apiWay = (t: string) => t.replace(/\u0670/gu, '\u200a\u0670\u2060');
  const q6 = findPhrases(`<p>${OPEN}${apiWay(stored6)} ${cp(0x666)}${CLOSE}</p>`)[0];
  const q7 = findPhrases(`<p>${OPEN}${apiWay(stored7)} ${cp(0x667)}${CLOSE}</p>`)[0];
  assert.ok(q6.text.includes('\u200a') && q6.text.includes('\u2060'), 'the phrase is kept as delivered');
  assert.equal(matchPhrase(idx, q6.text, { s: 9, from: 6, to: 6 }).result, 'matched_own_ayah');
  assert.equal(matchPhrase(idx, q7.text, { s: 9, from: 7, to: 7 }).result, 'matched_own_ayah');
  // Before this fix the hair space split the word: the letters had one word more than the ayah.
  assert.equal(lettersOnlyWords(q6.text).length, 3);
});

test('QPC encodings: every combining mark and format character goes; open tanween U+08F0 no longer splits a word', () => {
  // Made-up word: ba, damma, dal, open tanween (U+08F0, Arabic Extended-A), alef maqsura.
  assert.deepEqual(lettersOnlyWords(cp(0x628, 0x64f, 0x62f, 0x8f0, 0x649)), [cp(0x628, 0x62f, 0x649)]);
  // Other Extended-A marks (U+08D3 to U+08FF that are combining) are removed too, not spaced.
  for (const m of [0x8d4, 0x8e3, 0x8f1, 0x8f2, 0x8f3, 0x8fe]) assert.deepEqual(lettersOnlyWords(cp(0x628, m, 0x644)), [cp(0x628, 0x644)], m.toString(16));
  // A format character anywhere (category Cf, for example U+2066 or U+06DD) is removed, not spaced.
  for (const f of [0x2066, 0x2069, 0x6dd, 0x600]) assert.deepEqual(lettersOnlyWords(cp(0x628, f, 0x644)), [cp(0x628, 0x644)], f.toString(16));
  // Small waw and small yeh (U+06E5, U+06E6: modifier letters, not Mn) are still removed.
  assert.deepEqual(lettersOnlyWords(cp(0x628, 0x6e5, 0x644, 0x6e6)), [cp(0x628, 0x644)]);
  // The narrow space before a mark rule still applies, now for any Mn mark, U+08F0 included.
  assert.deepEqual(lettersOnlyWords(cp(0x628, 0x200a, 0x8f0, 0x644)), [cp(0x628, 0x644)]);
});

test('QPC encodings: a base letter plus a combining hamza composes to the hamza letter, on both sides', () => {
  // Made-up word in the API's way: tha, fatha, lam, tatweel, superscript alef, U+06E4, alef
  // maqsura, HAMZA BELOW (U+0655), kasra, kaf; and the same word as the file stores it, with U+0626.
  const api = cp(0x62b, 0x64e, 0x644, 0x640, 0x670, 0x6e4, 0x649, 0x655, 0x650, 0x643);
  const file = cp(0x62b, 0x64e, 0x644, 0x640, 0x670, 0x6e4, 0x626, 0x650, 0x643);
  assert.equal(lettersOnly(api), lettersOnly(file));
  assert.equal(lettersOnly(api), cp(0x62b, 0x644, 0x626, 0x643));
  // Each pair, with a mark in between allowed; marks between are kept for step 2.
  assert.equal(composeHamza(cp(0x64a, 0x654)), cp(0x626));
  assert.equal(composeHamza(cp(0x649, 0x654)), cp(0x626));
  assert.equal(composeHamza(cp(0x649, 0x650, 0x655)), cp(0x626, 0x650));
  assert.equal(composeHamza(cp(0x648, 0x654)), cp(0x624));
  assert.equal(composeHamza(cp(0x648, 0x64e, 0x655)), cp(0x624, 0x64e));
  assert.equal(composeHamza(cp(0x627, 0x654)), cp(0x623));
  assert.equal(composeHamza(cp(0x627, 0x655)), cp(0x625));
  // After composing, the approved rules apply as before: V-14 reads alef with hamza as alef.
  assert.equal(lettersOnly(cp(0x627, 0x654, 0x62b, 0x632)), cp(0x627, 0x62b, 0x632));
  // A hamza mark on any other letter, or after a letter, is not composed (removed with the marks).
  assert.equal(composeHamza(cp(0x628, 0x654)), cp(0x628, 0x654));
  assert.equal(lettersOnly(cp(0x628, 0x654, 0x644)), cp(0x628, 0x644));
  assert.equal(composeHamza(cp(0x64a, 0x628, 0x654)), cp(0x64a, 0x628, 0x654), 'a letter in between stops it');
  // A phrase written the API way matches the ayah written the file way.
  const idx = lettersIndex([{ s: 9, a: 1, letters: lettersOnly([file, cp(0x628, 0x64f, 0x62f, 0x64b, 0x649)].join(' ')) }]);
  assert.equal(matchPhrase(idx, `${api} ${cp(0x628, 0x64f, 0x62f, 0x8f0, 0x649)} ${cp(0x661)}`, { s: 9, from: 1, to: 1 }).result, 'matched_own_ayah');
});

test('D-084 phrases: ( ), ornate parentheses either way, and { } as qiraah_or_quote, kept as delivered', () => {
  const w = words(3, 2).slice(0, 2).join(' ');
  const p = findPhrases(`<p>a (${w}) b ${OPEN}${w}${CLOSE} c ${CLOSE}${w}${OPEN} d {${w}} e (x</p><p>y)</p>`);
  assert.deepEqual(p.map((x) => [x.bracket, x.label, x.text === w, !!x.unclosed]), [
    ['()', 'quote', true, false], ['\ufd3f\ufd3e', 'quote', true, false], ['\ufd3f\ufd3e', 'quote', true, false], ['{}', 'qiraah_or_quote', true, false], ['()', 'quote', false, true],
  ]);
  assert.equal(p[4].text, 'x', 'a phrase never runs across paragraphs');
});

test('D-084 matching: own ayah, same surah, elsewhere, unmatched, too short', () => {
  const w = words(5, 10);
  // Plain spelling with an ayah number inside still matches the own ayah.
  const plain = w.slice(1, 4).join(' ').replace(/[\u064b-\u0652]/gu, '') + ' ' + cp(0x661, 0x660);
  assert.equal(matchPhrase(ix, plain, own(5, 10)).result, 'matched_own_ayah');
  assert.equal(matchPhrase(ix, w.slice(1, 4).join(' '), own(5, 11)).result, 'matched_same_surah');
  assert.equal(matchPhrase(ix, w.slice(1, 4).join(' '), own(4, 1)).result, 'matched_elsewhere');
  // Across two ayat, consecutive words.
  const across = `${words(5, 10).slice(-2).join(' ')} ${words(5, 11).slice(0, 2).join(' ')}`;
  assert.equal(matchPhrase(ix, across, { s: 5, from: 10, to: 11 }).result, 'matched_own_ayah');
  assert.equal(matchPhrase(ix, across, own(5, 10)).result, 'matched_same_surah', 'outside the own range');
  // Words out of order do not match.
  assert.equal(matchPhrase(ix, [w[3], w[2], w[1]].join(' '), own(5, 10)).result, 'unmatched');
  // One word: too short unless it is in the own ayah.
  assert.equal(matchPhrase(ix, w[2], own(5, 10)).result, 'matched_own_ayah');
  const lone = words(5, 30)[1];
  const inOwn = uthmaniLetters(ix)[ix.at.get('5:10')!].split(' ').includes(lettersOnly(lone));
  assert.equal(matchPhrase(ix, lone, own(5, 10)).result, inOwn ? 'matched_own_ayah' : 'too_short');
  assert.equal(matchPhrase(ix, '', own(5, 10)).result, 'too_short');
  // Part of a word is not a word.
  assert.equal(matchPhrase(ix, `${w[1].slice(1)} ${w[2]}`, own(5, 10)).result === 'matched_own_ayah', false);
});

test('D-085: a phrase in the plain spelling of the file (aya_text_emlaey) matches; the form is recorded', () => {
  const rec = src.list.find((x) => x.sora === 5 && x.aya_no === 10)! as { aya_text: string; aya_text_emlaey: string };
  const em = rec.aya_text_emlaey.split(' ');
  // Pick three consecutive words that include a word of 4 or more letters, so the plain form
  // differs from the Uthmani one (an added alef).
  let k = 0;
  while (k + 3 <= em.length && !words(5, 10).slice(k, k + 3).some((w) => [...w.replace(/[\u064b-\u0652]/gu, '')].length >= 4)) k++;
  const fromEmlaey = em.slice(k, k + 3).join(' ');
  const m = matchPhrase(ix, fromEmlaey, own(5, 10));
  assert.deepEqual([m.result, m.form], ['matched_own_ayah', 'emlaey']);
  // The same words from aya_text match the Uthmani form only.
  const u = matchPhrase(ix, words(5, 10).slice(k, k + 3).join(' '), own(5, 10));
  assert.deepEqual([u.result, u.form], ['matched_own_ayah', 'uthmani']);
  // Words that are written the same in both forms (no word of 4 or more letters) match both.
  const shortWords = (s: number, a: number) => words(s, a).filter((w) => [...w.replace(/[\u064b-\u0652]/gu, '')].length < 4);
  const both = src.list.map((x) => ({ x, w: shortWords(x.sora, x.aya_no) })).find(({ x, w }) => w.length >= 2 && words(x.sora, x.aya_no).join(' ').includes(w.slice(0, 2).join(' ')));
  if (both) assert.equal(matchPhrase(ix, both.w.slice(0, 2).join(' '), own(both.x.sora, both.x.aya_no)).form, 'both');
  // Elsewhere through the plain form.
  const e = matchPhrase(ix, fromEmlaey, own(4, 1));
  assert.deepEqual([e.result, e.form], ['matched_elsewhere', 'emlaey']);
  // Without the emlaey form (an index built from aya_text only) the plain phrase does not match.
  const uOnly = indexFromSource(src.list.map(({ sora, aya_no, aya_text }) => ({ sora, aya_no, aya_text })));
  assert.equal(matchPhrase(uOnly, fromEmlaey, own(5, 10)).result, 'unmatched');
  assert.equal(matchPhrase(ix, 'no match at all', own(5, 10)).form, null);
});

test('D-084 reviewer list: everything not matched to its own ayat, all braces; CSV quoting', () => {
  const sum = newSummary(); const list: ReviewItem[] = [];
  const w = words(5, 10).slice(0, 3).join(' ');
  checkPassage(ix, `<p>(${w}) {${w}} (${words(5, 20).slice(0, 3).join(' ')})</p>`, own(5, 10), '5:10', sum, list);
  assert.equal(sum.phrases, 3);
  assert.equal(sum.byResult.matched_own_ayah, 2);
  assert.equal(sum.braces, 1);
  assert.deepEqual(list.map((x) => [x.bracket, x.label, x.result]), [['{}', 'qiraah_or_quote', 'matched_own_ayah'], ['()', 'quote', 'matched_same_surah']]);
  assert.equal(list[0].phrase, w, 'phrase as delivered');
  const csv = reviewCsv([{ ...list[0], phrase: 'a "b", c' }]);
  assert.ok(csv.startsWith('ref,range,bracket,label,phrase,letters_only,result,matched_form,unclosed\r\n'));
  assert.ok(csv.includes('"a ""b"", c"'));
  // by_chapter records with identical neighbouring text form one passage with a range.
  assert.deepEqual(chapterPassages([{ verse_key: '2:4', text: 'T' }, { verse_key: '2:3', text: 'T' }, { verse_key: '2:5', text: 'U' }, { verse_key: '2:6', text: '' }]).map((p) => [p.ref, p.from, p.to]), [['2:3', 3, 4], ['2:5', 5, 5]]);
});

test('D-079 store: format, references, hashes, dates and duplicates are checked', async () => {
  const sha = await sha256Hex('x');
  assert.deepEqual(checkFingerprints({ format: 'rifq-tafseer-fingerprints/1', entries: [{ ref: '2:5', tafsirId: 1, sha256: sha, reviewed: '2026-11-08' }] }, [0, 7, 40]), []);
  const bad = checkFingerprints({ format: 'x', entries: [
    { ref: '2:41', tafsirId: 1, sha256: sha, reviewed: '2026-11-08' },
    { ref: '2-5', tafsirId: 0, sha256: 'ABC', reviewed: '8/11/2026' },
    { ref: '1:1', tafsirId: 1, sha256: sha, reviewed: '2026-11-08', text: 'no' },
    { ref: '1:1', tafsirId: 1, sha256: sha, reviewed: '2026-11-08' },
  ] }, [0, 7, 40]);
  assert.equal(bad.length, 8, bad.join('\n'));
  assert.equal(sha, '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
});

test('AC15: a release needs every record, and production', () => {
  const all = releaseRecordProblems({}, {});
  assert.equal(all.length, 8);
  const ok = {
    format: TAFSEER_RECORD_FORMAT, tafsirId: 5, d076: { status: 'approved', date: '2026-12-01' }, approvedSourcesListed: true,
    reviewerCheck: { date: '2026-12-02' }, d008Audit: { date: '2026-12-03' }, qfProductionApproval: { date: '2026-12-04', scopes: ['content.tafsirs.read'] },
  };
  assert.deepEqual(releaseRecordProblems(ok, { QF_ENV: 'production' }), []);
  assert.equal(releaseRecordProblems(ok, { QF_ENV: 'prelive' }).length, 1);
  assert.equal(releaseRecordProblems({ ...ok, qfProductionApproval: { date: '2026-12-04', scopes: ['content.read'] } }, { QF_ENV: 'production' }).length, 1);
  assert.equal(releaseRecordProblems({ ...ok, d076: { status: 'deferred' } }, { QF_ENV: 'production' }).length, 1);
});

test('release check against the mock: D-084 results are reported, never block; a changed passage still fails (D-079)', async () => {
  const mock = createMockQf({ quran: src });
  const old = await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.changed, undefined, 1)!);
  const good = await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.reviewed)!);
  const run = (entries: { ref: string; tafsirId: number; sha256: string; reviewed: string }[]) => runTafseerCheck({
    recordPath: syn.recordPath, record: { tafsirId: MOCK_TAFSIR_ID }, fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries },
    env: ENV, mode: 'dry-run', surahs: [1, 2], fetch: mock.fetch,
  });
  const rep = await run([{ ref: `2:${CASE.changed}`, tafsirId: MOCK_TAFSIR_ID, sha256: old, reviewed: '2026-11-01' }, { ref: `2:${CASE.reviewed}`, tafsirId: MOCK_TAFSIR_ID, sha256: good, reviewed: '2026-11-01' }]);
  assert.equal(rep.ok, false);
  assert.deepEqual(rep.reasons, ['D-079: 1 passages changed since review'], 'the quote check adds no reason');
  assert.equal(rep.passages, 7 + 40 - 1, 'every ayah but the one with no passage');
  const r = (ref: number) => rep.reviewerList.filter((x) => x.ref === `2:${ref}`).map((x) => x.result);
  assert.deepEqual(r(CASE.quoteExact), [], 'own words as stored: matched, not listed');
  assert.deepEqual(r(CASE.quoteAltered), [], 'plain spelling plus ayah number: matched, not listed');
  assert.deepEqual(r(CASE.quoteSameSurah), ['matched_same_surah']);
  assert.deepEqual(r(CASE.quoteElsewhere), ['matched_elsewhere']);
  assert.deepEqual(r(CASE.quoteUnmatched), ['unmatched']);
  const braces = rep.reviewerList.filter((x) => x.ref === `2:${CASE.braces}`);
  assert.deepEqual(braces.map((x) => [x.label, x.result]), [['qiraah_or_quote', 'matched_own_ayah'], ['qiraah_or_quote', 'too_short']]);
  const lone = (quoteFrom(src, 2, 20) ?? '').split(' ')[0];
  const inOwn = uthmaniLetters(ix)[ix.at.get(`2:${CASE.tooShort}`)!].split(' ').includes(lettersOnly(lone));
  assert.deepEqual(r(CASE.tooShort), inOwn ? [] : ['too_short']);
  assert.equal(rep.quotes.phrases, 10);
  assert.deepEqual(r(CASE.apiAlef), [], 'HAIR SPACE + U+0670 + WORD JOINER inside a word: matched, not listed');
  assert.equal(rep.quotes.braces, 2);
  // Without the changed fingerprint the check passes, whatever the quote results.
  const ok = await run([{ ref: `2:${CASE.reviewed}`, tafsirId: MOCK_TAFSIR_ID, sha256: good, reviewed: '2026-11-01' }]);
  assert.equal(ok.ok, true);
  assert.ok(ok.reviewerList.some((x) => x.result === 'unmatched'));
  // In release mode, the AC15 records come first.
  const rel = await runTafseerCheck({ recordPath: syn.recordPath, record: null, fingerprints: null, env: ENV, mode: 'release', surahs: [1], fetch: mock.fetch });
  assert.equal(rel.ok, false);
  assert.ok(rel.reasons.some((x) => x.startsWith('tafseer record missing')));
  assert.ok(rel.reasons.some((x) => x.includes('fingerprint store missing')));
  assert.ok(rel.reasons.some((x) => x.includes('not "production"')));
  assert.ok(rel.reasons.some((x) => x === 'no tafsir ID to check'));
  assert.equal(rel.passages, 0, 'nothing fetched without a recorded work');
});

test('fingerprint helper prints hashes only, made with the Worker parser', async () => {
  const mock = createMockQf({ quran: src });
  const rows = await fingerprintEntries(ENV, MOCK_TAFSIR_ID, ['2:20', `2:${CASE.none}`, 'x'], '2026-11-08', mock.fetch, true);
  assert.deepEqual(rows[0], { ref: '2:20', tafsirId: MOCK_TAFSIR_ID, sha256: await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, 20)!), reviewed: '2026-11-08' });
  assert.deepEqual(rows.slice(1), [{ ref: `2:${CASE.none}`, error: 'no_passage' }, { ref: 'x', error: 'bad_ref' }]);
});
