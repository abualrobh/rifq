// RQ-007 v1.1 (English Tafseer, kit v34) in the Worker, the quote check, the coverage page, the
// catalogue and the release check, against the mock Quran Foundation API (test/mock/qf-mock.ts) and
// a fake Cache API. Synthetic Quran data only; the English passages are the mock's made-up "MOCK EN"
// test text (not Tafseer), and any Arabic in them is cut by program from the synthetic source.
// This file holds no Arabic and no Quran text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';
import { CASE, CLOSE, createMockQf, EN_CASE, enPassageText, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_EN_ID, MOCK_OTHER_LANG_ID, MOCK_TAFSIR_ID, OPEN, passageText } from '../mock/qf-mock.ts';
import { bareAyah, checkPassage, findPhrases, hasArabicLetters, indexFromSource, lettersOnly, newSummary, type ReviewItem } from '../../src/core/tafseer-quotes.ts';
import { computeMarks, markedNodes, markedText } from '../../src/core/tafseer-marks.ts';
import { sanitize, visibleText } from '../../src/core/tafseer-html.ts';
import { arabicRuns } from '../../src/core/bidi.ts';
import { STRINGS } from '../../src/core/strings.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { MAX_AGE_MS, type CacheLike } from '../../src/worker/tafseer.ts';
import { ARABIC_SCRIPT_LETTER, checkPassageEn, newOther } from '../../src/worker/quote-check.ts';
import { englishCatalogueProblems, englishRecordProblems, runTafseerCheck, TAFSEER_RECORD_FORMAT } from '../../scripts/tafseer-release-check.ts';

const { ab, src, syn } = synthetic('tafseer-en');
const ix = indexFromSource(src.list);
const lettersQuran = { counts: [0, ...SYN_COUNTS.slice(1)], letters: src.list.map((a) => lettersOnly(bareAyah(a.aya_text))), sha256: 'a'.repeat(64), checkVersion: 'm1-test' };
const BASE = 'http://127.0.0.1:9991';
const GATE = { SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), TAFSIR_EN_ID: String(MOCK_EN_ID), QF_TEST_BASE: BASE, ...GATE };
const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
const en = (a: number, s = 2) => enPassageText(s, a, src)!;

class FakeCache implements CacheLike {
  m = new Map<string, string>();
  async match(k: string) { const e = this.m.get(k); return e === undefined ? undefined : new Response(e); }
  async put(k: string, r: Response) { this.m.set(k, await r.text()); }
}

function setup(o: { dev?: boolean; gate?: boolean; limit?: number; mem?: boolean; parts?: { ar: boolean; en: boolean }; enSource?: Record<string, string>; fingerprints?: { ref: string; tafsirId: number; sha256: string; reviewed: string }[] } = {}) {
  let clock = Date.parse('2026-11-16T00:00:00Z');
  const now = () => clock;
  const mock = createMockQf({ quran: src, now, slowMs: 50 });
  const cache = new FakeCache();
  const w = makeWorker(ab, {
    testMemoryLimits: o.mem ?? true, dev: o.dev ?? true, gate: o.gate ?? false, tafseer: true, record: { name: 'S', edition: 'e', status: 's' },
    counts: [0, ...SYN_COUNTS.slice(1)], tafseerLimit: o.limit ?? 1000, lettersQuran,
    fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: o.fingerprints ?? [] },
    ...(o.parts ? { tafseerParts: o.parts } : {}), ...(o.enSource ? { tafseerEnSource: o.enSource } : {}),
  }, { fetch: mock.fetch, now, cache: () => cache, pauseMs: 0, timeoutMs: 2000 } as never);
  return { w, mock, cache, tick: (ms: number) => { clock += ms; } };
}
const post = (w: ReturnType<typeof makeWorker>, path: string, body: unknown, env: Record<string, unknown> = ENV, h: Record<string, string> = {}) =>
  w.fetch(new Request('http://127.0.0.1' + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.7.7.7', ...auth, ...h } }), env as never);
const askEn = (w: ReturnType<typeof makeWorker>, s: number, a: number, env: Record<string, unknown> = ENV) => post(w, '/api/tafseer', { s, a, l: 'en' }, env);
const askAr = (w: ReturnType<typeof makeWorker>, s: number, a: number, env: Record<string, unknown> = ENV) => post(w, '/api/tafseer', { s, a }, env);

test('AC1, AC4, AC14, AC23: the English passage byte for byte, with English source fields and "not stated" left empty', async () => {
  const { w, mock } = setup();
  const r = await askEn(w, 2, 20);
  assert.equal(r.status, 200);
  const raw = await r.text();
  const d = JSON.parse(raw);
  assert.equal(d.status, 'ok');
  assert.equal(d.lang, 'en');
  assert.ok(Buffer.from(d.text, 'utf8').equals(Buffer.from(en(20), 'utf8')), 'AC4: byte-equal');
  assert.deepEqual(d.range, { s: 2, from: 20, to: 20 });
  assert.deepEqual(d.source, { tafsirId: MOCK_EN_ID, title: 'Mock English Tafsir (abridged, made up)', author: 'Mock English Author', edition: null, publisher: null, translator: null, abridgement: null, original: null, language: 'english', provider: 'Quran Foundation' });
  assert.ok(!('review' in d));
  for (const x of [MOCK_CLIENT_SECRET, MOCK_CLIENT_ID, 'mock-token-']) assert.ok(!raw.includes(x), x);
  // AC23: the API request names only the work and the ayah.
  assert.ok(mock.state.paths.some((p) => p.startsWith(`/content/api/v4/tafsirs/${MOCK_EN_ID}/by_ayah/2:20?`)));
  assert.ok(mock.state.paths.every((p) => !/10\.7\.7\.7/.test(p)));
  // AC14: fields come only from Hamzeh's record (here a made-up test record), never filled otherwise.
  const rec = setup({ enSource: { translator: 'Rec T', abridgement: 'Rec A', original: 'Rec O', edition: 'Rec E', publisher: 'Rec P' } });
  const d2 = await (await askEn(rec.w, 2, 20)).json();
  assert.deepEqual([d2.source.translator, d2.source.abridgement, d2.source.original, d2.source.edition, d2.source.publisher], ['Rec T', 'Rec A', 'Rec O', 'Rec E', 'Rec P']);
});

test('AC2, AC10: the Arabic request and answer are unchanged and never carry the English work', async () => {
  const { w } = setup();
  const a1 = await (await askAr(w, 2, 20)).json();
  const a2 = await (await post(w, '/api/tafseer', { s: 2, a: 20, l: 'ar' })).json();
  assert.deepEqual(a1, a2);
  assert.equal(a1.source.tafsirId, MOCK_TAFSIR_ID);
  assert.ok(!('lang' in a1), 'no new field in the Arabic answer');
  assert.ok(Buffer.from(a1.text, 'utf8').equals(Buffer.from(passageText(MOCK_TAFSIR_ID, 2, 20)!, 'utf8')));
  assert.deepEqual(Object.keys(a1.source).sort(), ['author', 'edition', 'language', 'provider', 'publisher', 'tafsirId', 'title']);
  const e1 = await (await askEn(w, 2, 20)).json();
  assert.notEqual(e1.text, a1.text);
  // Asking again (from the cache) gives each work its own passage and marks.
  assert.deepEqual(await (await askAr(w, 2, 20)).json(), a1);
  assert.deepEqual(await (await askEn(w, 2, 20)).json(), e1);
  // Bad "l" values are refused.
  for (const l of ['fr', 'EN', 1, null, '']) assert.equal((await post(w, '/api/tafseer', { s: 2, a: 20, l })).status, 400, String(l));
});

test('AC10, AC22: separate cache entries; the Arabic key is the kit v33 key; keys hold work and ayah only', async () => {
  const { w, cache } = setup();
  await askAr(w, 2, 21); await askEn(w, 2, 21);
  const keys = [...cache.m.keys()].filter((k) => k.includes('2%3A21'));
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => /\/__rifq-cache\/tafseer\/v5\/prelive\/901\/2%3A21\/[^/]+$/.test(k)), 'Arabic key unchanged');
  assert.ok(keys.some((k) => /\/__rifq-cache\/tafseer\/v5\/prelive\/en\/169\/2%3A21\/[^/]+$/.test(k)), 'English key holds en and its ID');
  assert.ok([...cache.m.keys()].every((k) => !k.includes('10.7.7.7')));
});

test('AC8: no English setting: development builds name it; release builds name nothing; Arabic keeps working', async () => {
  const { TAFSIR_EN_ID: _x, ...noEn } = ENV;
  const { w } = setup();
  const r = await askEn(w, 1, 1, noEn);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { status: 'not_configured', lang: 'en', missing: ['TAFSIR_EN_ID'] });
  assert.equal((await askAr(w, 1, 1, noEn)).status, 200, 'AC12: the Arabic interface keeps working');
  for (const v of ['', ' ', '0', '-1', 'abc', '1e3']) assert.deepEqual((await (await askEn(w, 1, 1, { ...ENV, TAFSIR_EN_ID: v })).json()).missing, ['TAFSIR_EN_ID'], `"${v}"`);
  const rel = setup({ dev: false });
  assert.deepEqual(await (await askEn(rel.w, 1, 1, noEn)).json(), { status: 'not_configured', lang: 'en', missing: [] });
  // No default: TAFSIR_ID never stands in for the English work.
  assert.equal((await (await askEn(w, 2, 20, { ...noEn, TAFSIR_ID: String(MOCK_EN_ID) })).json()).status, 'not_configured');
});

test('AC9: each setting serves only its own language; others are "not configured" naming the expected language', async () => {
  const { w } = setup();
  for (const id of [MOCK_TAFSIR_ID, MOCK_OTHER_LANG_ID]) {
    const r = await askEn(w, 2, 20, { ...ENV, TAFSIR_EN_ID: String(id) });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { status: 'not_configured', lang: 'en', missing: ['english_tafsir (D-135)'] }, String(id));
  }
  // The same refusal for an ayah with no passage: the work's language decides first.
  assert.equal((await (await askEn(w, 2, CASE.none, { ...ENV, TAFSIR_EN_ID: String(MOCK_TAFSIR_ID) })).json()).status, 'not_configured');
  // The Arabic setting is unchanged: an English or other-language work is refused there.
  for (const id of [MOCK_EN_ID, MOCK_OTHER_LANG_ID]) assert.equal((await (await askAr(w, 2, 20, { ...ENV, TAFSIR_ID: String(id) })).json()).status, 'not_configured');
  const rel = setup({ dev: false });
  assert.deepEqual(await (await askEn(rel.w, 2, 20, { ...ENV, TAFSIR_EN_ID: String(MOCK_TAFSIR_ID) })).json(), { status: 'not_configured', lang: 'en', missing: [] });
});

test('AC9: when the language cannot be read (list down, passage silent), nothing is shown', async () => {
  let listDown = true;
  const mock = createMockQf({ quran: src });
  const fetchFn = async (u: string, i: RequestInit) => (listDown && u.includes('/resources/tafsirs') ? new Response('x', { status: 503 }) : mock.fetch(u, { ...i }));
  const w = makeWorker(ab, { testMemoryLimits: true, dev: true, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts: [0, ...SYN_COUNTS.slice(1)], tafseerLimit: 1000 }, { fetch: fetchFn, cache: () => null } as never);
  // The mock gives language_name on by_ayah when asked, so the passage says "english": served.
  assert.equal((await (await askEn(w, 2, 20)).json()).status, 'ok');
  // No passage (2:7) and the list is down: the language is unknown, so "unavailable".
  assert.deepEqual(await (await askEn(w, 2, CASE.none)).json(), { status: 'unavailable', lang: 'en' });
  listDown = false;
  assert.deepEqual(await (await askEn(w, 2, CASE.none)).json(), { status: 'none', lang: 'en', s: 2, a: CASE.none });
});

test('AC5, AC11, AC12: the English range is its own; no passage; API errors; the other work is never shown instead', async () => {
  const { w } = setup();
  const g = await (await askEn(w, 2, CASE.grouped[1])).json();
  assert.deepEqual(g.range, { s: 2, from: CASE.grouped[0], to: CASE.grouped[2] });
  assert.ok(g.text.includes('MOCK EN GROUPED'));
  const none = await askEn(w, 2, CASE.none);
  assert.equal(none.status, 404);
  assert.deepEqual(await none.json(), { status: 'none', lang: 'en', s: 2, a: CASE.none });
  for (const a of [CASE.error500, CASE.rate429]) assert.deepEqual(await (await askEn(w, 2, a)).json(), { status: 'unavailable', lang: 'en' }, String(a));
  // AC32: surahs 3 to 114 behave as the Arabic Tafseer does there (the pre-live API has no passage).
  const s3a = await (await askAr(w, 3, 1)).json(), s3e = await (await askEn(w, 3, 1)).json();
  assert.equal(s3a.status, 'none'); assert.equal(s3e.status, 'none');
});

test('AC26: an English copy fetched 7 days ago or more is not served', async () => {
  const { w, mock, tick } = setup();
  await askEn(w, 2, 22);
  const n0 = mock.state.contentRequests;
  await askEn(w, 2, 22);
  assert.equal(mock.state.contentRequests, n0, 'served from the copy');
  tick(MAX_AGE_MS - 1000);
  await askEn(w, 2, 22);
  assert.equal(mock.state.contentRequests, n0, 'still inside 7 days');
  tick(1000);
  await askEn(w, 2, 22);
  assert.ok(mock.state.contentRequests > n0, 'fetched again at 7 days');
});

test('AC25, AC27: one token scope; one shared Tafseer limit for both languages; failing closed', async () => {
  const { w, mock } = setup({ limit: 3 });
  const codes = [(await askAr(w, 2, 20)).status, (await askEn(w, 2, 20)).status, (await askEn(w, 2, 21)).status, (await askAr(w, 2, 21)).status, (await askEn(w, 2, 23)).status];
  assert.deepEqual(codes, [200, 200, 200, 429, 429], 'the 4th request in the minute is refused, whatever its language');
  assert.ok(mock.state.tokenBodies.every((b) => b === 'grant_type=client_credentials&scope=content.tafsirs.read'));
  const closed = setup({ mem: false });
  const r = await askEn(closed.w, 2, 20);
  assert.equal(r.status, 503, 'no TAFSEER_LIMIT binding: refused (D-095)');
  assert.equal(closed.mock.state.contentRequests, 0);
  const failing = await askEn(closed.w, 2, 20, { ...ENV, TAFSEER_LIMIT: { limit: async () => { throw new Error('down'); } } });
  assert.equal(failing.status, 503);
});

test('AC16: no fingerprint is used for English, and no review field in any English answer', async () => {
  const { w } = setup({ fingerprints: [{ ref: '2:20', tafsirId: MOCK_EN_ID, sha256: 'f'.repeat(64), reviewed: '2026-11-01' }] });
  const d = await (await askEn(w, 2, 20)).json();
  assert.equal(d.status, 'ok');
  assert.deepEqual(Object.keys(d).sort(), ['a', 'lang', 'marks', 'range', 's', 'source', 'status', 'text']);
});

test('AC12, AC18: release builds hold back a part whose release check failed, and only that part', async () => {
  const enHeld = setup({ dev: false, parts: { ar: true, en: false } });
  assert.deepEqual(await (await askEn(enHeld.w, 2, 20)).json(), { status: 'not_configured', lang: 'en', missing: [] });
  assert.equal((await (await askAr(enHeld.w, 2, 20)).json()).status, 'ok');
  const arHeld = setup({ dev: false, parts: { ar: false, en: true } });
  assert.deepEqual(await (await askAr(arHeld.w, 2, 20)).json(), { status: 'not_configured', missing: [] });
  assert.equal((await (await askEn(arHeld.w, 2, 20)).json()).status, 'ok');
  // Development builds never hold a part back.
  assert.equal((await (await askEn(setup({ dev: true, parts: { ar: false, en: false } }).w, 2, 20)).json()).status, 'ok');
});

test('AC33, AC34, AC37, P-11: English marks: Arabic-letter phrases classified as in Arabic; the rest "N"', async () => {
  const { w } = setup();
  const own = (a: number) => ({ s: 2, from: a, to: a });
  for (const a of [CASE.quoteExact, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.quoteUnmatched, CASE.braces, CASE.tooShort, EN_CASE.mix, EN_CASE.mixed, EN_CASE.paragraphs, 20]) {
    const d = await (await askEn(w, 2, a)).json();
    const want = computeMarks(ix, en(a), own(a), false);
    assert.deepEqual(d.marks, want, `2:${a}`);
    // Each phrase with no Arabic letters is "N"; each with Arabic letters gets what the Arabic
    // classification gives (computeMarks with arabicWork true), unless unclosed.
    const ps = findPhrases(en(a));
    const ar = computeMarks(ix, en(a), own(a), true);
    ps.forEach((p, i) => assert.equal(want.c[i], hasArabicLetters(p.text) ? ar.c[i] : 'N', `2:${a} phrase ${i}`));
  }
  const exact = computeMarks(ix, en(CASE.quoteExact), own(CASE.quoteExact), false);
  assert.equal(exact.c, 'O');
  assert.equal(computeMarks(ix, en(CASE.quoteElsewhere), own(CASE.quoteElsewhere), false).c, 'A');
  assert.equal(computeMarks(ix, en(CASE.quoteUnmatched), own(CASE.quoteUnmatched), false).c, 'P');
  assert.equal(computeMarks(ix, en(CASE.braces), own(CASE.braces), false).c, 'ON', 'an own word in braces, and English words in braces left as delivered');
  const mix = computeMarks(ix, en(EN_CASE.mix), own(EN_CASE.mix), false);
  assert.equal(mix.c, 'NNNNNN', 'AC34: ( ), { }, ornate, digits, Latin and the unclosed English bracket: all as delivered');
  assert.equal(computeMarks(ix, en(EN_CASE.mixed), own(EN_CASE.mixed), false).c[1], 'N');
  assert.notEqual(computeMarks(ix, en(EN_CASE.mixed), own(EN_CASE.mixed), false).c[0], 'N', 'P-11: a mixed phrase counts as Arabic letters');
});

test('AC35: displayed English text equals the delivered text except for swapped marks of Arabic-letter phrases', () => {
  const BR = new RegExp(`[(){}${OPEN}${CLOSE}]`, 'g');
  for (const a of [CASE.quoteExact, CASE.quoteSameSurah, CASE.braces, EN_CASE.mix, EN_CASE.mixed, EN_CASE.paragraphs, CASE.hostile]) {
    const html = en(a);
    const m = computeMarks(ix, html, { s: 2, from: a, to: a }, false);
    const nodes = markedNodes(html, m)!;
    const shown = markedText(nodes.nodes), delivered = visibleText(sanitize(html));
    assert.equal(shown.length, delivered.length, `2:${a}`);
    assert.equal(shown.replace(BR, ''), delivered.replace(BR, ''), `2:${a}: words unchanged`);
    // AC34: a phrase with no Arabic letters keeps even its own bracket marks.
    for (const p of findPhrases(html)) if (!hasArabicLetters(p.text) && !p.unclosed) assert.ok(shown.includes(p.text), `2:${a}`);
  }
  const mixHtml = en(EN_CASE.mix);
  const m = computeMarks(ix, mixHtml, { s: 2, from: EN_CASE.mix, to: EN_CASE.mix }, false);
  assert.equal(markedText(markedNodes(mixHtml, m)!.nodes), visibleText(sanitize(mixHtml)), 'no Arabic-letter phrase: shown exactly as delivered, brackets included');
});

test('AC20: Arabic runs are found without changing a character; spaces at the ends stay outside', () => {
  const ar = (src.list.find((x) => x.sora === 2 && x.aya_no === 20)!.aya_text).split(' ').slice(0, 3).join(' ');
  for (const t of [`Mock words ${ar} more words`, `${ar}`, 'Latin only (2:255) [x]', `(${ar}) and ${OPEN}${ar}${CLOSE}`, `a ${ar}${String.fromCodePoint(0x200a, 0x670, 0x2060)}${ar} b`, '']) {
    const parts = arabicRuns(t);
    assert.equal(parts.map((p) => p.text).join(''), t, 'joining the parts gives the text back');
    for (const p of parts) if (p.ar) assert.ok(!/^\s|\s$/.test(p.text), 'no space at the ends of a run');
    for (const p of parts) if (!p.ar) assert.ok(!hasArabicLetters(p.text), 'no Arabic letter left outside a run');
  }
  assert.equal(arabicRuns(`Mock ${ar} words`).filter((p) => p.ar).length, 1, 'a multi-word quote is one run');
  assert.deepEqual(arabicRuns('Latin only'), [{ text: 'Latin only', ar: false }]);
});

test('AC17, AC37: quote check for the English work: Arabic-letter phrases matched and listed; others counted only', async () => {
  const { w } = setup({ gate: true });
  const all: ReviewItem[] = [];
  const other = newOther();
  let phrases = 0, display = '';
  for (const s of [1, 2]) {
    let part: { page: number; skip: number } | null = { page: 1, skip: 0 };
    while (part) {
      const r = await post(w, '/api/dev/quote-check', { s, page: part.page, skip: part.skip, w: 'en' });
      assert.equal(r.status, 200);
      const d = await r.json();
      assert.equal(d.lang, 'en');
      assert.equal(d.tafsirId, MOCK_EN_ID);
      assert.equal(d.fingerprints, null, 'AC16: no fingerprints for English');
      all.push(...d.list); phrases += d.summary.phrases;
      other.phrases += d.other.phrases; other.unclosed += d.other.unclosed;
      for (const k of ['round', 'ornate', 'curly'] as const) other.byBracket[k] += d.other.byBracket[k];
      for (const p of d.display) {
        const [ps, pa] = p.ref.split(':').map(Number);
        const rng = /^(\d+):(\d+)-(\d+)$/.exec(p.range)!;
        assert.deepEqual({ n: p.n, c: p.c }, (({ n, c }) => ({ n, c }))(computeMarks(ix, enPassageText(ps, pa, src)!, { s: +rng[1], from: +rng[2], to: +rng[3] }, false)), `AC37: ${p.ref}`);
        display += p.c;
      }
      part = d.next;
    }
  }
  assert.ok(all.length > 0);
  for (const it of all) assert.ok(hasArabicLetters(it.phrase), 'only Arabic-letter phrases are listed');
  assert.ok(other.phrases >= 8, `English-only phrases counted: ${other.phrases}`);
  assert.equal(other.unclosed, 1);
  assert.ok(other.byBracket.round >= 4 && other.byBracket.curly >= 2 && other.byBracket.ornate >= 1, JSON.stringify(other));
  assert.equal([...display].filter((c) => c !== 'N').length, phrases, 'every Arabic-letter phrase gets a class');
  // Unknown work value refused; the Arabic run is unchanged (no "lang", fingerprints counted).
  assert.equal((await post(w, '/api/dev/quote-check', { s: 1, w: 'xx' })).status, 400);
  const ar = await (await post(w, '/api/dev/quote-check', { s: 1 })).json();
  assert.equal(ar.tafsirId, MOCK_TAFSIR_ID);
  assert.ok(!('lang' in ar) && !('other' in ar));
  assert.deepEqual(Object.keys(ar.fingerprints).sort(), ['checked', 'differ', 'same']);
  const { TAFSIR_EN_ID: _x, ...noEn } = ENV;
  assert.deepEqual(await (await post(w, '/api/dev/quote-check', { s: 1, w: 'en' }, noEn)).json(), { status: 'not_configured', lang: 'en', missing: ['TAFSIR_EN_ID'] });
});

test('checkPassageEn equals checkPassage on a passage whose phrases all have Arabic letters', () => {
  for (const a of [CASE.quoteExact, CASE.quoteAltered, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.quoteUnmatched, CASE.braces, CASE.tooShort]) {
    const html = passageText(MOCK_TAFSIR_ID, 2, a, src)!;
    const own = { s: 2, from: a, to: a };
    const s1 = newSummary(), s2 = newSummary(), l1: ReviewItem[] = [], l2: ReviewItem[] = [], o = newOther();
    checkPassage(ix, html, own, `2:${a}`, s1, l1);
    const c = checkPassageEn(ix, html, own, `2:${a}`, s2, l2, o);
    assert.deepEqual(s2, s1); assert.deepEqual(l2, l1); assert.equal(o.phrases, 0);
    assert.equal(c, computeMarks(ix, html, own, false).c);
  }
});

test('coverage page API: numbers only, no text; ranges, missing ayat and phrase counts; paced parts', async () => {
  const { w, mock } = setup({ gate: true });
  const rows: { from: number; to: number; chars: number; arabicPhrases: number; otherPhrases: number }[] = [];
  let requests = 0, pages = 0;
  let part: { page: number; skip: number } | null = { page: 1, skip: 0 };
  const before = mock.state.contentRequests;
  while (part) {
    const r = await post(w, '/api/dev/tafseer-coverage', { s: 2, page: part.page, skip: part.skip });
    requests++;
    assert.equal(r.status, 200);
    const raw = await r.text();
    assert.ok(!/MOCK|Not Tafseer|made-up/.test(raw), 'no passage text');
    assert.ok(!/[0-9a-f]{64}/.test(raw), 'no hash');
    assert.ok(!hasArabicLetters(raw), 'no Arabic text');
    const d = JSON.parse(raw);
    pages += d.pages;
    rows.push(...d.passages);
    part = d.next;
  }
  assert.equal(pages, mock.state.contentRequests - before);
  assert.equal(requests, Math.ceil(40 / 10));
  const covered = (n: number) => rows.find((p) => n >= p.from && n <= p.to);
  assert.equal(covered(CASE.none), undefined, 'no passage for 2:7');
  assert.deepEqual([covered(CASE.grouped[1])!.from, covered(CASE.grouped[1])!.to], [CASE.grouped[0], CASE.grouped[2]]);
  const mix = covered(EN_CASE.mix)!;
  assert.equal(mix.arabicPhrases, 0); assert.equal(mix.otherPhrases, 6);
  assert.equal(mix.chars, [...en(EN_CASE.mix)].length);
  assert.equal(covered(CASE.quoteExact)!.arabicPhrases, 1);
  const { TAFSIR_EN_ID: _x, ...noEn } = ENV;
  assert.equal((await post(w, '/api/dev/tafseer-coverage', { s: 2 }, noEn)).status, 503);
  // Not available without the gate, or in release builds.
  assert.equal((await post(setup({ gate: false }).w, '/api/dev/tafseer-coverage', { s: 2 })).status, 404);
  assert.equal((await post(setup({ gate: true, dev: false }).w, '/api/dev/tafseer-coverage', { s: 2 })).status, 404);
});

test('AC31: catalogue: "Other languages" is open by default; the English setting and its row are shown', async () => {
  const { w } = setup({ gate: true });
  const h = await (await w.fetch(new Request('http://127.0.0.1/dev/tafseer-catalogue/', { headers: auth }), ENV as never)).text();
  assert.ok(/<details open data-other-languages>/.test(h));
  assert.ok(h.includes('data-tafsir-en-id>169<'));
  assert.ok(h.includes('<tr data-tafsir-en><td>169</td><td>Mock English Tafsir (abridged, made up)</td><td>Mock English Author</td><td>english</td><td>mock-en-169</td>'));
  assert.ok(h.includes('data-tafsir-en-slug>mock-en-169<') && h.includes('data-tafsir-en-author>Mock English Author<'));
  assert.ok(h.includes('data-english-count>3<'));
  const { TAFSIR_EN_ID: _x, ...noEn } = ENV;
  const h2 = await (await w.fetch(new Request('http://127.0.0.1/dev/tafseer-catalogue/', { headers: auth }), noEn as never)).text();
  assert.ok(h2.includes('data-tafsir-en-id>not set<'));
  assert.ok(!h2.includes('data-tafsir-en>'));
});

test('AC18: the English release part needs its own records and never needs D-012, D-008, fingerprints or quote results', async () => {
  const good = {
    format: TAFSEER_RECORD_FORMAT,
    english: { tafsirId: MOCK_EN_ID, name: 'Mock English Tafsir (abridged, made up)', author: 'Mock English Author', slug: 'mock-en-169', language: 'english', approvedSourcesListed: true, qfProductionApproval: { date: '2026-12-05', scopes: ['content.tafsirs.read'], namesEnglishTafseer: true } },
  };
  const P = { QF_ENV: 'production' };
  assert.deepEqual(englishRecordProblems(good, P), []);
  assert.ok(englishRecordProblems(null, P).length >= 1);
  assert.equal(englishRecordProblems(good, { QF_ENV: 'prelive' }).length, 1);
  for (const k of ['tafsirId', 'name', 'author', 'slug', 'language', 'approvedSourcesListed', 'qfProductionApproval'] as const) {
    assert.equal(englishRecordProblems({ ...good, english: { ...good.english, [k]: undefined } }, P).length, 1, k);
  }
  assert.equal(englishRecordProblems({ ...good, english: { ...good.english, language: 'arabic' } }, P).length, 1);
  assert.equal(englishRecordProblems({ ...good, english: { ...good.english, qfProductionApproval: { date: '2026-12-05', scopes: ['content.tafsirs.read'] } } }, P).length, 1, 'the approval must come from the request naming English Tafseer');
  const all = englishRecordProblems({ format: TAFSEER_RECORD_FORMAT, english: {} }, P).join(' ');
  assert.ok(!/D-012|D-008|fingerprint|quote|review/i.test(all), all);
  // Against the (mock) production catalogue: same ID, name, author, slug and language.
  const mock = createMockQf({ quran: src });
  const env = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'production' };
  assert.deepEqual(await englishCatalogueProblems(good.english, env, mock.fetch), []);
  assert.equal((await englishCatalogueProblems({ ...good.english, slug: 'other' }, env, mock.fetch)).length, 1);
  assert.equal((await englishCatalogueProblems({ ...good.english, tafsirId: 999 }, env, mock.fetch)).length, 1);
  assert.equal((await englishCatalogueProblems(good.english, env, async () => new Response('x', { status: 500 }))).length, 1);
  // Independence: an English part that passes does not make the Arabic part pass, and the reverse.
  const relEnOnly = await runTafseerCheck({ recordPath: syn.recordPath, record: good, fingerprints: null, env, mode: 'release', surahs: [1], fetch: mock.fetch });
  assert.equal(relEnOnly.english.ok, true, relEnOnly.english.reasons.join('\n'));
  assert.equal(relEnOnly.ok, false);
  assert.ok(!relEnOnly.reasons.some((x) => x.startsWith('English')), 'English reasons never go into the Arabic reasons');
  const arOnly = { format: TAFSEER_RECORD_FORMAT, tafsirId: MOCK_TAFSIR_ID, d076: { status: 'approved', date: '2026-12-01' }, approvedSourcesListed: true, d008Audit: { date: '2026-12-03' }, qfProductionApproval: { date: '2026-12-04', scopes: ['content.tafsirs.read'] } };
  const relArOnly = await runTafseerCheck({ recordPath: syn.recordPath, record: arOnly, fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [] }, env, mode: 'release', surahs: [1], fetch: mock.fetch });
  assert.equal(relArOnly.ok, true, relArOnly.reasons.join('\n'));
  assert.equal(relArOnly.english.ok, false);
  const dry = await runTafseerCheck({ recordPath: syn.recordPath, record: good, fingerprints: null, env: { ...env, QF_ENV: 'prelive', QF_TEST_BASE: BASE }, mode: 'dry-run', surahs: [1], fetch: mock.fetch });
  assert.equal(dry.english.ok, false, 'a dry run is never release evidence');
});

test('strings: the six RQ-007 strings in both tables, exactly as drafted', () => {
  assert.equal(STRINGS.en.tafseerEnNote, 'Abridged English translation of Tafsir Ibn Kathir.');
  assert.equal(STRINGS.en.tfTranslator, 'Translator');
  assert.equal(STRINGS.en.tfAbridgement, 'Abridgement');
  assert.equal(STRINGS.en.tfOriginal, 'Original work');
  assert.equal(STRINGS.en.langEnglish, 'English');
  assert.equal(STRINGS.en.tafseerEnNotConfigured, 'The English Tafseer work is not set on this site yet (D-136), so no English Tafseer is shown.');
  for (const k of ['tafseerEnNote', 'tfTranslator', 'tfAbridgement', 'tfOriginal', 'langEnglish', 'tafseerEnNotConfigured'] as const) assert.ok(STRINGS.ar[k].length > 0 && STRINGS.ar[k] !== STRINGS.en[k], k);
});

test('coverage: the cheap Arabic-letter class accepts every code point that hasArabicLetters accepts', () => {
  let missed = 0;
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const x = String.fromCodePoint(c);
    if (hasArabicLetters(x) && !ARABIC_SCRIPT_LETTER.test(x)) missed++;
  }
  assert.equal(missed, 0);
});
