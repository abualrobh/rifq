// D-084 quote check (changes D-078), D-079 store format, and the AC15 release check, on synthetic
// data and the mock. Phrases are cut from the synthetic source by program; no Arabic is typed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { bareAyah, chapterPassages, checkPassage, findPhrases, indexFromSource, lettersOnly, lettersOnlyWords, matchPhrase, newSummary, reviewCsv, type ReviewItem } from '../../src/core/tafseer-quotes.ts';
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
  assert.equal(lettersOnly(cp(0x671, 0x644, 0x644, 0x647)), lettersOnly(cp(0x627, 0x644, 0x644, 0x647)));
  // Hamza on alef reads as alef (V-14, D-074); a Farsi yeh as yeh (V-25, D-072).
  assert.equal(lettersOnly(cp(0x623, 0x645, 0x631)), cp(0x627, 0x645, 0x631));
  assert.equal(lettersOnly(cp(0x641, 0x6cc)), cp(0x641, 0x64a));
  // Alef maqsura and yeh stay apart (V-17 awaits the D-012 reviewer).
  assert.notEqual(lettersOnly(cp(0x639, 0x644, 0x649)), lettersOnly(cp(0x639, 0x644, 0x64a)));
  assert.deepEqual(lettersOnlyWords('Latin words only'), []);
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
  const inOwn = ix.letters[ix.at.get('5:10')!].split(' ').includes(lettersOnly(lone));
  assert.equal(matchPhrase(ix, lone, own(5, 10)).result, inOwn ? 'matched_own_ayah' : 'too_short');
  assert.equal(matchPhrase(ix, '', own(5, 10)).result, 'too_short');
  // Part of a word is not a word.
  assert.equal(matchPhrase(ix, `${w[1].slice(1)} ${w[2]}`, own(5, 10)).result === 'matched_own_ayah', false);
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
  assert.ok(csv.startsWith('ref,range,bracket,label,phrase,letters_only,result,unclosed\r\n'));
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
  const inOwn = ix.letters[ix.at.get(`2:${CASE.tooShort}`)!].split(' ').includes(lettersOnly(lone));
  assert.deepEqual(r(CASE.tooShort), inOwn ? [] : ['too_short']);
  assert.equal(rep.quotes.phrases, 9);
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
