// D-078 quote check, D-079 store format, and the AC15 release check, on synthetic data and the mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { compareQuote, findQuotes, quranIndex, bareAyah } from '../../src/core/tafseer-quotes.ts';
import { checkFingerprints, sha256Hex } from '../../src/core/tafseer-fingerprints.ts';
import { releaseRecordProblems, runTafseerCheck, TAFSEER_RECORD_FORMAT } from '../../scripts/tafseer-release-check.ts';
import { fingerprintEntries } from '../../scripts/tafseer-fingerprint.ts';
import { alter, CASE, CLOSE, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID, OPEN, passageText } from '../mock/qf-mock.ts';

const { src, syn } = synthetic('tafseer-release');
const ix = quranIndex(src.list);
const words = (s: number, a: number) => bareAyah(src.list.find((x) => x.sora === s && x.aya_no === a)!.aya_text).split(' ');
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', QF_TEST_BASE: 'http://127.0.0.1:9998' };

test('D-078: quotes are found between ornate parentheses in either order, and braces', () => {
  const w = words(3, 2).slice(0, 2).join(' ');
  const q = findQuotes(`<p>a ${OPEN}${w}${CLOSE} b ${CLOSE}${w}${OPEN} c {${w}} d</p>`);
  assert.equal(q.length, 3);
  assert.ok(q.every((x) => x.text === w && x.via === 'delimiter'));
  const un = findQuotes(`<p>${OPEN}${w}</p><p>${CLOSE}</p>`);
  assert.ok(un[0].unclosed, 'a quote never runs across paragraphs');
  assert.equal(findQuotes('<p>no quotes here</p>').length, 0);
  const mk = findQuotes(`<p><span class="x quran">${w}</span></p>`, { pairs: [], markup: [{ tag: 'span', className: 'quran' }] });
  assert.deepEqual(mk.map((x) => [x.via, x.text]), [['markup', w]]);
});

test('D-078: exact bytes on word edges pass; a one-mark change, a part word, or an unknown run fail', () => {
  const w = words(5, 10);
  const exact = w.slice(1, 4).join(' ');
  assert.deepEqual(compareQuote(ix, { via: 'delimiter', text: ` ${exact} `, start: 0, end: 0 }), { result: 'exact', from: '5:10', to: '5:10' });
  // Across two ayat, joined by one space.
  const tail = words(5, 10).slice(-2).join(' '), head = words(5, 11).slice(0, 2).join(' ');
  assert.deepEqual(compareQuote(ix, { via: 'delimiter', text: `${tail} ${head}`, start: 0, end: 0 }), { result: 'exact', from: '5:10', to: '5:11' });
  const changed = alter(exact);
  const r = compareQuote(ix, { via: 'delimiter', text: changed, start: 0, end: 0 });
  assert.equal(r.result, 'mismatch');
  const part = w[1].slice(1);
  assert.equal(compareQuote(ix, { via: 'delimiter', text: part, start: 0, end: 0 }).result, 'mismatch', 'inside a word does not count');
  assert.deepEqual(compareQuote(ix, { via: 'delimiter', text: 'not quran', start: 0, end: 0 }), { result: 'mismatch', reason: 'not_found' });
  assert.deepEqual(compareQuote(ix, { via: 'delimiter', text: '  ', start: 0, end: 0 }), { result: 'mismatch', reason: 'empty' });
  // Different spacing (a no-break space between words) is different bytes: a mismatch.
  assert.equal(compareQuote(ix, { via: 'delimiter', text: w.slice(1, 3).join('\u00a0'), start: 0, end: 0 }).result, 'mismatch');
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

test('release check against the mock: an altered quote and a changed passage fail it; the report holds no text', async () => {
  const mock = createMockQf({ quran: src });
  const old = await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.changed, undefined, 1)!);
  const good = await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.reviewed)!);
  const rep = await runTafseerCheck({
    recordPath: syn.recordPath, record: { tafsirId: MOCK_TAFSIR_ID },
    fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [
      { ref: `2:${CASE.changed}`, tafsirId: MOCK_TAFSIR_ID, sha256: old, reviewed: '2026-11-01' },
      { ref: `2:${CASE.reviewed}`, tafsirId: MOCK_TAFSIR_ID, sha256: good, reviewed: '2026-11-01' }] },
    env: ENV, mode: 'dry-run', surahs: [1, 2], fetch: mock.fetch,
  });
  assert.equal(rep.ok, false);
  assert.equal(rep.passages, 7 + 40 - 1, 'every ayah but the one with no passage');
  assert.equal(rep.quotes, 2);
  assert.equal(rep.exact, 1);
  assert.deepEqual(rep.mismatches.map((m) => [m.ref, m.result]), [[`2:${CASE.quoteAltered}`, 'mismatch']]);
  assert.deepEqual(rep.fingerprints.changed, [`2:${CASE.changed}`]);
  assert.equal(rep.fingerprints.matched, 1);
  const text = JSON.stringify(rep);
  for (const a of src.list.slice(0, 60)) for (const w of bareAyah(a.aya_text).split(' ')) if (w.length > 3) assert.ok(!text.includes(w), 'no Quran words in the report');
  assert.ok(!text.includes('MOCK'), 'no passage text in the report');
  // In release mode, the AC15 records come first.
  const rel = await runTafseerCheck({ recordPath: syn.recordPath, record: null, fingerprints: null, env: ENV, mode: 'release', surahs: [1], fetch: mock.fetch });
  assert.equal(rel.ok, false);
  assert.ok(rel.reasons.some((r) => r.startsWith('tafseer record missing')));
  assert.ok(rel.reasons.some((r) => r.includes('fingerprint store missing')));
  assert.ok(rel.reasons.some((r) => r.includes('not "production"')));
  assert.ok(rel.reasons.some((r) => r === 'no tafsir ID to check'));
  assert.equal(rel.passages, 0, 'nothing fetched without a recorded work');
});

test('fingerprint helper prints hashes only, made with the Worker parser', async () => {
  const mock = createMockQf({ quran: src });
  const rows = await fingerprintEntries(ENV, MOCK_TAFSIR_ID, ['2:20', `2:${CASE.none}`, 'x'], '2026-11-08', mock.fetch, true);
  assert.deepEqual(rows[0], { ref: '2:20', tafsirId: MOCK_TAFSIR_ID, sha256: await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, 20)!), reviewed: '2026-11-08' });
  assert.deepEqual(rows.slice(1), [{ ref: `2:${CASE.none}`, error: 'no_passage' }, { ref: 'x', error: 'bad_ref' }]);
});
