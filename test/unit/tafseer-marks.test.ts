// D-149 bracket display (RQ-005 v1.1 AC29 to AC37, RQ-007 v1.1 AC33 to AC37), classified in the
// Worker as D-156 A sets, and D-157 (the matching data stays in the Worker bundle). Synthetic Quran
// data and the mock Quran Foundation API only; this file holds no Arabic and no Quran text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';
import { CASE, CLOSE, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID, OPEN, passageText, quoteFrom } from '../mock/qf-mock.ts';
import { blockText, sanitize, visibleText } from '../../src/core/tafseer-html.ts';
import { bareAyah, indexFromSource, lettersIndex, lettersOnly, matchPhrase, findPhrases, packedIndex, packLetters, phraseMatcher, phrasesAt, wordListHas, type Result } from '../../src/core/tafseer-quotes.ts';
import { blockTextOf, classOf, computeMarks, markedNodes, markedText, MARKS_VERSION, sanitizeViaWalk, validMarks, type MNode } from '../../src/core/tafseer-marks.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { CACHE_VERSION, type CacheLike } from '../../src/worker/tafseer.ts';
import { makeLetters } from '../../src/worker/letters.ts';
import { hitsIn, probesFrom, PROBE_MIN_WORDS } from '../../scripts/letters-scan.ts';
import { checkVersion, MATCHING_FILES } from '../../scripts/build.ts';

const { ab, src } = synthetic('marks');
const ix = indexFromSource(src.list);
const lettersQuran = { counts: [0, ...SYN_COUNTS.slice(1)], letters: src.list.map((a) => lettersOnly(bareAyah(a.aya_text))), sha256: 'a'.repeat(64), checkVersion: 'm1-test' };
const BASE = 'http://127.0.0.1:9993';
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), QF_TEST_BASE: BASE, SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
const BRACKETS = new RegExp(`[(){}${OPEN}${CLOSE}]`, 'g');
const own = (a: number) => ({ s: 2, from: a, to: a });
const html = (a: number) => passageText(MOCK_TAFSIR_ID, 2, a, src)!;

class FakeCache implements CacheLike {
  m = new Map<string, string>();
  async match(k: string) { const e = this.m.get(k); return e === undefined ? undefined : new Response(e); }
  async put(k: string, r: Response) { this.m.set(k, await r.text()); }
}

function worker(o: { gate?: boolean; letters?: typeof lettersQuran | null; cache?: FakeCache } = {}) {
  const mock = createMockQf({ quran: src });
  const cache = o.cache ?? new FakeCache();
  const w = makeWorker(ab, { testMemoryLimits: true, dev: true, gate: o.gate ?? false, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts: [0, ...SYN_COUNTS.slice(1)], tafseerLimit: 1000, lettersQuran: o.letters === undefined ? lettersQuran : o.letters }, { fetch: mock.fetch, cache: () => cache, pauseMs: 0 } as never);
  return { w, mock, cache };
}
const ask = (w: ReturnType<typeof makeWorker>, s: number, a: number, h: Record<string, string> = {}) =>
  w.fetch(new Request('http://127.0.0.1/api/tafseer', { method: 'POST', body: JSON.stringify({ s, a }), headers: { 'content-type': 'application/json', ...h } }), ENV as never);

test('AC29: the six check results, unclosed phrases and D-152 map to the three styles', () => {
  const p = { text: 'x' };
  const want: Record<Result, string> = { matched_own_ayah: 'O', matched_same_surah: 'A', matched_elsewhere: 'A', unmatched: 'P', too_short: 'P', fragment: 'P' };
  for (const [r, c] of Object.entries(want)) assert.equal(classOf(r as Result, p, true), c, r);
  assert.equal(classOf('matched_own_ayah', { text: 'x', unclosed: true }, true), 'N', 'P-2: unclosed is shown as delivered');
  // D-152 A: a { } phrase that matches nothing is plain, between ( ).
  const m = computeMarks(ix, html(CASE.braces), own(CASE.braces), true);
  assert.equal(m.c, 'OP');
  const nodes = markedNodes(html(CASE.braces), m)!.nodes;
  const q = flat(nodes).filter((n) => typeof n !== 'string' && 'tfq' in n) as { tfq: string; open: string; close: string }[];
  assert.deepEqual(q.map((x) => x.open + x.close), ['{}', '()']);
});

test('AC29, AC32 shape: own, same surah, elsewhere, unmatched, too short, as the check finds them', () => {
  // The synthetic one-word phrase of CASE.tooShort may also be a word of its own ayah (the made-up
  // words repeat), so its class is taken from the check itself (below), not fixed here.
  const cases: [number, string | null][] = [[CASE.quoteExact, 'O'], [CASE.quoteAltered, 'O'], [CASE.quoteSameSurah, 'A'], [CASE.quoteElsewhere, 'A'], [CASE.quoteUnmatched, 'P'], [CASE.tooShort, null], [CASE.wasla, 'O'], [CASE.apiAlef, 'O']];
  for (const [a, c] of cases) {
    const m = computeMarks(ix, html(a), own(a), true);
    if (c !== null) assert.deepEqual(m, { v: MARKS_VERSION, n: 1, c }, `2:${a}`);
    // AC31: the same code as the quote check, phrase by phrase.
    const ps = findPhrases(html(a));
    assert.equal(ps.length, m.n);
    ps.forEach((p, i) => assert.equal(classOf(matchPhrase(ix, p.text, own(a)).result, p, true), m.c[i]));
  }
  assert.deepEqual(computeMarks(ix, html(30), own(30), true), { v: 1, n: 0, c: '' }, 'no phrase, no mark');
});

test('RQ-007 P-11, AC34: in a work that is not Arabic, a phrase with no Arabic letters is left as delivered', () => {
  const quote = quoteFrom(src, 2, 40)!;
  const t = `<p>MOCK ENGLISH (made-up words) and {more words} and [square] and (${quote}) and (12).</p>`;
  const en = computeMarks(ix, t, own(40), false);
  assert.equal(en.c, 'NNON', 'English: Latin and digits untouched; the Arabic phrase is classified');
  const ar = computeMarks(ix, t, own(40), true);
  assert.equal(ar.c, 'PPOP', 'Arabic work: every phrase is classified (AC29)');
  const out = markedNodes(t, en)!;
  const s = markedText(out.nodes);
  assert.ok(s.includes('(made-up words) and {more words} and [square]'), 'kept with its own brackets');
  assert.ok(s.includes(`{${quote}}`));
});

test('AC30, AC4: only the bracket characters change; the words are byte-identical', () => {
  for (const a of [CASE.quoteExact, CASE.quoteAltered, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.quoteUnmatched, CASE.braces, CASE.tooShort, CASE.wasla, CASE.apiAlef, CASE.hostile, 20]) {
    const t = html(a);
    const m = computeMarks(ix, t, own(a), true);
    const out = markedNodes(t, m)!;
    assert.ok(out, `2:${a}`);
    const shown = markedText(out.nodes), delivered = visibleText(sanitize(t));
    assert.equal(shown.length, delivered.length, 'nothing added or removed');
    assert.ok(Buffer.from(shown.replace(BRACKETS, ''), 'utf8').equals(Buffer.from(delivered.replace(BRACKETS, ''), 'utf8')), `2:${a} words byte-equal`);
    for (const n of flat(out.nodes)) if (typeof n !== 'string' && 'tfq' in n) assert.ok(findPhrases(t).some((p) => p.text === n.text), 'a phrase is its delivered words');
  }
});

test('AC37: missing, malformed or unfitting marks are ignored (shown as delivered)', () => {
  const t = html(CASE.braces);
  const good = computeMarks(ix, t, own(CASE.braces), true);
  assert.ok(validMarks(good, 2));
  for (const bad of [undefined, null, 'OP', ['O', 'P'], {}, { ...good, v: 2 }, { ...good, n: 3 }, { ...good, c: 'O' }, { ...good, c: 'OX' }, { ...good, c: 'op' }, { ...good, extra: 1 }, { v: 1, n: '2', c: 'OP' }, { ...good, n: 2.5 }])
    assert.equal(markedNodes(t, bad), null, JSON.stringify(bad));
});

test('the marked walk keeps sanitize() and blockText() exactly (no drift between display and check)', () => {
  const samples = [html(CASE.hostile), html(CASE.quoteExact), '<p>a (b <b>c</b> d) e</p></p><br>f{g}<div>h</p>(i', 'plain (x) <script>(y)</script> <style>{z}</style> &lt;(w)&gt; &#x28;v&#x29;', '<ul><li>(a)</li><li>{b</li></ul>', ''];
  for (const s of samples) {
    assert.deepEqual(sanitizeViaWalk(s), sanitize(s));
    assert.equal(blockTextOf(s), blockText(s));
  }
});

test('a phrase split by markup, or unclosed, is left exactly as delivered', () => {
  const t = `<p>MOCK (one <b>two</b> three) and (four five) and ${OPEN}six</p><p>seven${CLOSE}</p>`;
  assert.equal(phrasesAt(blockText(t)).length, 4, 'two closed, and two unclosed pieces of the ornate pair across the paragraph');
  assert.equal(computeMarks(ix, t, own(20), true).c.slice(2), 'NN');
  // Even marks that ask for it never restyle an unclosed phrase.
  for (const c of ['PPNN', 'PPPP']) {
    const out = markedNodes(t, { v: 1, n: 4, c })!;
    assert.equal(out.styled, 1, c);
    assert.equal(out.left, 1, 'the phrase with markup inside');
    const s = markedText(out.nodes);
    assert.equal(s, visibleText(sanitize(t)), 'all brackets here stay as delivered ((four five) was already in ( ))');
  }
  const out = markedNodes(t, { v: 1, n: 4, c: 'PPNN' })!;
  const s = markedText(out.nodes);
  assert.ok(s.includes('(one two three)'));
  assert.ok(s.includes(`${OPEN}six`) && s.includes(`seven${CLOSE}`));
});

test('D-156 A: the Worker sends the passage unchanged plus marks only, and keeps the marks in the same cache entry', async () => {
  const { w, mock, cache } = worker();
  const r = await ask(w, 2, CASE.quoteSameSurah);
  const raw = await r.text();
  const d = JSON.parse(raw);
  assert.equal(d.status, 'ok');
  assert.ok(Buffer.from(d.text, 'utf8').equals(Buffer.from(html(CASE.quoteSameSurah), 'utf8')), 'AC4');
  assert.deepEqual(d.marks, { v: 1, n: 1, c: 'A' });
  // Kit v32 FIND-AE: no review field for readers (D-151 A, AC26/AC27).
  assert.deepEqual(Object.keys(d).sort(), ['a', 'marks', 'range', 's', 'source', 'status', 'text']);
  // The key holds the check version and the approved file's SHA-256.
  const keys = [...cache.m.keys()].filter((k) => !k.endsWith('/list'));
  assert.equal(keys.length, 1);
  assert.ok(keys[0].includes(`/tafseer/${CACHE_VERSION}/prelive/${MOCK_TAFSIR_ID}/2%3A${CASE.quoteSameSurah}/m1-test-${'a'.repeat(64)}`), keys[0]);
  assert.equal(CACHE_VERSION, 'v5');
  const stored = JSON.parse(cache.m.get(keys[0])!);
  assert.deepEqual(stored.data.marks, d.marks, 'marks stored with the passage, same fetch time');
  // A second read comes from the cache, with the same marks and no new API call.
  const calls = mock.state.paths.length;
  const d2 = await (await ask(w, 2, CASE.quoteSameSurah)).json();
  assert.deepEqual(d2, d);
  assert.equal(mock.state.paths.length, calls);
  // Another approved file (or other matching code) never reads those marks.
  const other = worker({ letters: { ...lettersQuran, sha256: 'b'.repeat(64) }, cache });
  await ask(other.w, 2, CASE.quoteSameSurah);
  assert.equal(other.mock.state.paths.filter((p) => p.includes('/by_ayah/')).length, 1, 'fetched again under the new key');
});

test('D-157: no response holds the matching data; without it there are no marks (AC37)', async () => {
  const { w } = worker();
  const probes = probesFrom(src.list);
  for (const a of [1, 11, 15, 16, 17, 18, 19, 20, 40]) {
    const raw = await (await ask(w, 2, a)).text();
    const d = JSON.parse(raw);
    if (d.marks) assert.match(d.marks.c, /^[OAPN]*$/);
    // Nothing but the passage text itself can hold letters: remove it and scan what is left.
    const rest = JSON.stringify({ ...d, text: '' });
    assert.equal(hitsIn(rest, probes), 0);
    for (const l of lettersQuran.letters) if (l.split(' ').length >= 2) assert.ok(!rest.includes(l));
  }
  const none = worker({ letters: null });
  const d = await (await ask(none.w, 2, CASE.quoteExact)).json();
  assert.equal(d.status, 'ok');
  assert.equal('marks' in d, false);
});

test('AC31: /dev/quote-check/ gives the same display classes as /api/tafseer, passage by passage', async () => {
  const { w } = worker({ gate: true });
  // Kit v30: the check comes in small parts (page, skip); the parts together cover the surah.
  const q = { display: [] as { ref: string; n: number; c: string }[], displayCounts: { O: 0, A: 0, P: 0, N: 0 } as Record<string, number>, summary: { phrases: 0 } };
  let part: { page: number; skip: number } | null = { page: 1, skip: 0 };
  while (part) {
    const r = await w.fetch(new Request('http://127.0.0.1/api/dev/quote-check', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ s: 2, ...part }) }), ENV as never);
    const d = await r.json();
    assert.equal(d.status, 'ok');
    q.display.push(...d.display);
    for (const k of Object.keys(q.displayCounts)) q.displayCounts[k] += d.displayCounts[k];
    q.summary.phrases += d.summary.phrases;
    part = d.next;
  }
  assert.ok(q.display.length > 30);
  let compared = 0;
  for (const p of q.display as { ref: string; n: number; c: string }[]) {
    const [s, a] = p.ref.split(':').map(Number);
    const d = await (await ask(w, s, a, auth)).json();
    if (d.status !== 'ok') continue;
    assert.deepEqual({ n: d.marks.n, c: d.marks.c }, { n: p.n, c: p.c }, p.ref);
    compared++;
  }
  assert.ok(compared > 30);
  const sum = Object.values(q.displayCounts as Record<string, number>).reduce((x, y) => x + y, 0);
  assert.equal(sum, q.summary.phrases, 'every phrase has one display class');
});

test('D-156 A timing page: gated, numbers and references only', async () => {
  const { w } = worker({ gate: true });
  const get = (path: string, h: Record<string, string> = auth) => w.fetch(new Request('http://127.0.0.1' + path, { headers: h }), ENV as never);
  assert.equal((await get('/dev/tafseer-timing/?s=2', {})).status, 401);
  // Kit v30 (QA v29 FIND-W): the 401 challenge is not a signed-in request, so the first signed-in
  // load of a fresh isolate says "yes"; no time is shown; the letters index is not built by it.
  const first = await (await get('/dev/tafseer-timing/')).text();
  assert.match(first, /data-t-cold>yes</);
  assert.match(first, /data-t-before>0</);
  assert.match(first, /data-t-all>1</);
  assert.match(first, /data-t-built>no</);
  assert.ok(first.includes('data-t-evidence') && first.includes('Cloudflare dashboard'));
  assert.ok(!/ ms</.test(first) && !first.includes('data-t-verdict') && !first.includes('data-t-clock'), 'no timings claimed');
  const r = await get('/dev/tafseer-timing/?s=2');
  assert.equal(r.status, 200);
  const h = await r.text();
  for (const k of ['data-t-total', 'data-t-most', 'data-t-next', 'data-t-phrases']) assert.ok(h.includes(k), k);
  assert.match(h, /data-t-cold>no</);
  assert.match(h, /data-t-built>no</, 'counting phrases builds no index');
  assert.equal((h.match(/data-t-phrases>/g) ?? []).length <= 10, true, 'one small page only');
  assert.equal((await get('/dev/tafseer-timing/?s=2&page=0')).status, 400);
  // The label names the route that built the index.
  await ask(w, 2, 1, auth);
  assert.match(await (await get('/dev/tafseer-timing/')).text(), /data-t-built>yes, by \/api\/tafseer request 1</);
  const arabicBlock = (n: number) => (n >= 0x600 && n <= 0x6ff) || (n >= 0x750 && n <= 0x77f) || (n >= 0x8a0 && n <= 0x8ff) || (n >= 0xfb50 && n <= 0xfdff) || (n >= 0xfe70 && n <= 0xfeff);
  assert.ok(![...h].some((c) => arabicBlock(c.codePointAt(0)!)), 'no Arabic text at all');
  assert.ok(!h.includes('MOCK'), 'no Tafseer text');
  assert.equal((await get('/dev/tafseer-timing/?s=2', { ...auth, 'sec-fetch-site': 'cross-site' })).status, 403);
  // Not in a build without the gate.
  const off = worker({ gate: false });
  assert.notEqual((await off.w.fetch(new Request('http://127.0.0.1/dev/tafseer-timing/?s=2'), ENV as never)).status, 200);
});

test('kit v30 FIND-W: the letters index says which route built it', () => {
  const L = makeLetters(lettersQuran);
  assert.equal(L.built(), false);
  L.index('/api/tafseer request 3');
  L.index('/api/dev/quote-check');
  assert.equal(L.built(), true);
  assert.equal(L.timing.builtBy, '/api/tafseer request 3', 'the first builder is kept');
  assert.equal(L.key(), `m1-test-${'a'.repeat(64)}`);
});

test('D-157 scan: finds a letters-only ayah in plain, \\u-escaped and &#x; form, and nothing in other text', () => {
  const p = probesFrom(src.list);
  assert.ok(p.count > 0);
  const long = lettersQuran.letters.find((l) => l.split(' ').length >= PROBE_MIN_WORDS + 1)!;
  assert.ok(long, 'a synthetic ayah long enough');
  const esc = [...long].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const ent = [...long].map((c) => '&#x' + c.charCodeAt(0).toString(16) + ';').join('');
  assert.equal(hitsIn(`x ${long} y`, p), 1);
  assert.equal(hitsIn(`{"a":"${esc}"}`, p), 1);
  assert.equal(hitsIn(`<p>${ent}</p>`, p), 1);
  assert.equal(hitsIn(long.split(' ').slice(0, -1).join(' '), p), 0, 'part of an ayah is not a hit');
  assert.equal(hitsIn(JSON.stringify(lettersQuran), p) > 0, true, 'the Worker config itself is found (positive control)');
});

test('D-156 A check version: the matching files exist and the version is stable', () => {
  assert.ok(MATCHING_FILES.includes('src/core/tafseer-marks.ts'));
  const v = checkVersion();
  assert.match(v, /^m1-[0-9a-f]{16}$/);
  assert.equal(checkVersion(), v);
});

function flat(n: MNode[]): MNode[] {
  return n.flatMap((x) => (typeof x !== 'string' && 'children' in x ? [x, ...flat(x.children)] : [x]));
}

test('D-156 A packed index: the build-time packed form gives exactly the same ayah, surah and whole texts and the same results', () => {
  const counts = [0, ...SYN_COUNTS.slice(1)];
  const up = src.list.map((a) => lettersOnly(bareAyah(a.aya_text)));
  // A made-up second form with some empty ayat, as an emlaey column with gaps would be.
  const em = up.map((l, i) => (i % 7 === 3 ? '' : l.split(' ').reverse().join(' ')));
  const rows = src.list.map((a, i) => ({ s: a.sora, a: a.aya_no, letters: up[i], emlaey: em[i] }));
  const plain = lettersIndex(rows);
  const packed = packedIndex(packLetters(counts, { uthmani: up, emlaey: em }));
  for (const f of ['uthmani', 'emlaey'] as const) {
    const A = plain.forms[f]!, B = packed.forms[f]!;
    assert.equal(B.all, A.all, f);
    for (let i = 0; i < rows.length; i++) assert.equal(B.ayah(i), A.ayah(i), `${f} ${i}`);
    assert.equal(B.ayah(rows.length), undefined);
    for (let s = 0; s <= counts.length; s++) assert.equal(B.surah(s), A.surah(s), `${f} surah ${s}`);
  }
  for (const r of rows) assert.equal(packed.at.get(`${r.s}:${r.a}`), plain.at.get(`${r.s}:${r.a}`));
  for (const bad of ['0:1', '2:0', `2:${counts[2] + 1}`, `${counts.length}:1`, 'x']) assert.equal(packed.at.get(bad), undefined, bad);
  // Same results for every quote case and for every 2-word run of surah 2.
  for (const a of [11, 12, 15, 16, 17, 18, 19, 27, 28]) assert.deepEqual(computeMarks(packed, html(a), own(a), true), computeMarks(plain, html(a), own(a), true));
  for (const r of rows.filter((x) => x.s === 2)) {
    const w = r.letters.split(' ');
    const ph = w.slice(0, 2).join(' ');
    for (const o of [own(r.a), own(1), { s: 3, from: 1, to: 2 }]) assert.deepEqual(matchPhrase(packed, ph, o), matchPhrase(plain, ph, o));
  }
});

test('kit v30 reader CPU: the packed word list holds exactly the words of each form, and skipping impossible scans changes no result', () => {
  const counts = [0, ...SYN_COUNTS.slice(1)];
  const up = src.list.map((a) => lettersOnly(bareAyah(a.aya_text)));
  const em = up.map((l, i) => (i % 7 === 3 ? '' : l.split(' ').reverse().join(' ')));
  const p = packLetters(counts, { uthmani: up, emlaey: em });
  for (const [f, list] of [['uthmani', up], ['emlaey', em]] as const) {
    const pf = p.forms[f]!;
    const want = [...new Set(list.join(' ').split(' ').filter(Boolean))];
    assert.equal(pf.woff!.length, want.length, f);
    for (const w of want) assert.equal(wordListHas(pf.words!, pf.woff!, w), true, `${f} has ${w.length}`);
    for (const w of want.slice(0, 50)) {
      assert.equal(wordListHas(pf.words!, pf.woff!, w + w[0]), want.includes(w + w[0]));
      assert.equal(wordListHas(pf.words!, pf.woff!, w.slice(1)), want.includes(w.slice(1)));
    }
    assert.equal(wordListHas(pf.words!, pf.woff!, ''), false);
  }
  // Results with the word list equal results without it (the v29 packed form) for real word runs,
  // runs with a made-up word added, and runs across surahs, at every level.
  const withList = packedIndex(p);
  const without = packedIndex({ counts, forms: { uthmani: { ...p.forms.uthmani!, words: undefined, woff: undefined }, emlaey: { ...p.forms.emlaey!, words: undefined, woff: undefined } } });
  const zz = String.fromCodePoint(0x638, 0x638, 0x638);
  let n = 0;
  for (const r of src.list.slice(0, 400)) {
    const w = bareAyah(r.aya_text).split(' ');
    for (const ph of [w.slice(0, 2).join(' '), w.slice(1, 4).join(' '), `${w[0]} ${zz}`, w[w.length - 1], `${zz} ${w.slice(0, 2).join(' ')}`]) {
      for (const o of [own(r.aya_no), { s: r.sora, from: r.aya_no, to: r.aya_no }, { s: 5, from: 1, to: 3 }]) { assert.deepEqual(matchPhrase(withList, ph, o), matchPhrase(without, ph, o)); n++; }
    }
  }
  assert.ok(n > 1000, String(n));
});

test('kit v30 reader CPU: the startup warm-up runs the matching code on made-up letters and changes nothing', async () => {
  const { warmUp } = await import('../../src/worker/letters.ts');
  const before = computeMarks(ix, html(CASE.quoteExact), own(CASE.quoteExact), true);
  assert.equal(warmUp(), undefined);
  assert.deepEqual(computeMarks(ix, html(CASE.quoteExact), own(CASE.quoteExact), true), before);
  // Kit v31: with packed letters data it also runs on a throwaway packed index; the Worker's own
  // index is not built by it, results do not change, and bad data is ignored.
  const packed = { counts: lettersQuran.counts, packed: packLetters(lettersQuran.counts, { uthmani: lettersQuran.letters }).forms };
  const L = makeLetters(packed);
  assert.equal(warmUp(packed), undefined);
  assert.equal(L.built(), false);
  assert.deepEqual(computeMarks(L.index('test'), html(CASE.quoteExact), own(CASE.quoteExact), true), before);
  assert.equal(warmUp({ counts: [0], packed: {} }), undefined);
  assert.equal(warmUp({ counts: [0, 1], packed: { uthmani: { all: 'x', off: [0], len: [1] } } } as never), undefined);
  // A Worker with Tafseer warms up at startup and still starts and answers.
  const w = makeWorker(ab, { testMemoryLimits: true, dev: true, gate: false, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts: [0, ...SYN_COUNTS.slice(1)], lettersQuran }, {} as never);
  assert.ok(w && typeof w.fetch === 'function');
});

test('kit v31 reader CPU: one matcher per passage, and its display group equals the full result class for every phrase', () => {
  // Synthetic data only. Phrases: word runs of many ayat (own, same surah, other surahs), runs
  // with the first or last letter cut (D-088 edges), one-word pieces, made-up letters, against
  // single-ayah and multi-ayah own ranges, in the unpacked and the packed index.
  const pk = packedIndex(packLetters([0, ...SYN_COUNTS.slice(1)], { uthmani: src.list.map((a) => lettersOnly(bareAyah(a.aya_text))) }));
  const groupOf = (r: Result) => (r === 'matched_own_ayah' ? 'own' : r === 'matched_same_surah' || r === 'matched_elsewhere' ? 'other' : 'none');
  let n = 0;
  const seen = new Set<string>();
  for (let k = 0; k < src.list.length; k += 7) {
    const a = src.list[k];
    const w = bareAyah(a.aya_text).split(' ');
    const phrases = [w.slice(0, 2).join(' '), w.slice(1, 4).join(' '), w[0], w[w.length - 1], w.slice(0, 2).join(' ').slice(1), w.slice(0, 3).join(' ').slice(0, -1), w[0].slice(1), 'zz qq', ''];
    const other = a.aya_no === 1 ? 2 : 1;
    for (const own of [{ s: a.sora, from: a.aya_no, to: a.aya_no }, { s: a.sora, from: Math.max(1, a.aya_no - 2), to: a.aya_no }, { s: a.sora, from: other, to: other }, { s: a.sora === 1 ? 2 : 1, from: 1, to: 1 }]) {
      for (const I of [ix, pk]) {
        const mm = phraseMatcher(I, own);
        for (const p of phrases) {
          const full = matchPhrase(I, p, own);
          assert.deepEqual(mm.match(p), full, 'the per-passage matcher gives the same full result');
          assert.equal(mm.kind(p), groupOf(full.result), `group of ${full.result}`);
          seen.add(full.result);
          n++;
        }
      }
    }
  }
  assert.ok(n > 1000, String(n));
  for (const r of ['matched_own_ayah', 'matched_same_surah', 'matched_elsewhere', 'unmatched', 'too_short', 'fragment']) assert.ok(seen.has(r), `covers ${r}`);
});

test('kit v32 CPU: whole-text and same-surah search from the packed word sequence gives exactly the scan results', async () => {
  // Synthetic data only. Phrases: runs inside one ayah, runs across an ayah end (the end of one
  // ayah and the start of the next, in the same surah and across a surah end), single words, words
  // missing from the text, and edge pieces; against own ranges in the same and in other surahs.
  const { encodeWorkerData, decodeWorkerData } = await import('../../src/core/worker-data.ts');
  const counts = [0, ...SYN_COUNTS.slice(1)];
  const forms = packLetters(counts, { uthmani: src.list.map((a) => lettersOnly(bareAyah(a.aya_text))) }).forms;
  const withSeq = packedIndex({ counts, forms });
  const noSeq = packedIndex({ counts, forms: { uthmani: { ...forms.uthmani!, seq: undefined, pstart: undefined, plist: undefined, wpos: undefined } } });
  const fromBin = packedIndex({ counts, forms: decodeWorkerData(encodeWorkerData({ letters: forms }).slice().buffer).letters! });
  assert.ok(withSeq.forms.uthmani!.findIn && fromBin.forms.uthmani!.findIn && !noSeq.forms.uthmani!.findIn);
  const L = src.list.map((a) => bareAyah(a.aya_text).split(' '));
  let n = 0;
  const seen = new Set<string>();
  for (let k = 0; k < src.list.length; k += 2) {
    const w = L[k], next = L[k + 1] ?? [];
    const phrases = [w.slice(0, 2).join(' '), w.slice(-2).join(' '), [...w.slice(-1), ...next.slice(0, 1)].join(' '), [...w.slice(-2), ...next.slice(0, 2)].join(' '), w[0], `${w[0]} zz`, w.slice(1, 3).join(' ').slice(1)];
    const a = src.list[k];
    for (const own of [{ s: a.sora, from: a.aya_no, to: a.aya_no }, { s: a.sora, from: a.aya_no === 1 ? 2 : 1, to: a.aya_no === 1 ? 2 : 1 }, { s: a.sora === 1 ? 2 : 1, from: 1, to: 1 }, { s: 999, from: 1, to: 1 }]) {
      const m0 = phraseMatcher(noSeq, own), m1 = phraseMatcher(withSeq, own), m2 = phraseMatcher(fromBin, own);
      for (const p of phrases) {
        const r0 = m0.match(p);
        assert.deepEqual(m1.match(p), r0); assert.deepEqual(m2.match(p), r0);
        assert.equal(m1.kind(p), m0.kind(p)); assert.equal(m2.kind(p), m0.kind(p));
        seen.add(r0.result); n++;
      }
    }
    // findIn itself against the string scans, for the whole text and every surah.
    for (const p of phrases.slice(0, 4)) {
      const words = lettersOnly(p).split(' ').filter(Boolean);
      const exact = ' ' + words.join(' ') + ' ';
      const f = withSeq.forms.uthmani!;
      assert.equal(f.findIn!(words), f.all.includes(exact));
      for (const s of [a.sora, a.sora === 1 ? 2 : 1, 0, counts.length]) assert.equal(f.findIn!(words, s), (f.surah(s) ?? '').includes(exact));
    }
  }
  assert.ok(n > 2000, String(n));
  for (const r of ['matched_own_ayah', 'matched_same_surah', 'matched_elsewhere', 'unmatched']) assert.ok(seen.has(r), `covers ${r}`);
});

test('kit v32 CPU: the Worker data module round-trips, holds no config, and a Worker without its data does not start', async () => {
  const { encodeWorkerData, decodeWorkerData, hashHex } = await import('../../src/core/worker-data.ts');
  const { withWorkerData } = await import('../../src/worker/bundle-data.ts');
  const { stampWorkerData } = await import('../../src/core/worker-data-stamp.ts');
  const { createHash } = await import('node:crypto');
  // Kit v33 (D-169 A): a module as scripts/build.ts writes it, with its build ID and stamp.
  const stamped = (b: Uint8Array) => { const r = stampWorkerData(b, createHash('sha256').update(b).digest('hex')); return { buf: r.bin.slice().buffer, workerData: r.stamp }; };
  const counts = [0, ...SYN_COUNTS.slice(1)];
  const forms = packLetters(counts, { uthmani: lettersQuran.letters, emlaey: lettersQuran.letters.map((l) => l.split(' ').reverse().join(' ')) }).forms;
  const full = src.list.map((_a, i) => (i * 7919).toString(16).padStart(64, '0')), bare = src.list.map((_a, i) => (i * 104729).toString(16).padStart(64, 'f'));
  const bin = encodeWorkerData({ letters: forms, hashes: { full, bare } });
  const d = decodeWorkerData(bin.slice().buffer);
  for (const k of ['uthmani', 'emlaey'] as const) {
    // The text comes back as UTF-16 code units, read a piece at a time by the packed index.
    const units = (u: ArrayLike<number> | undefined) => String.fromCharCode(...Array.from(u ?? []));
    assert.equal(units(d.letters![k]!.allU16), forms[k]!.all);
    assert.equal(units(d.letters![k]!.wordsU16), forms[k]!.words);
    const a = packedIndex({ counts, forms: d.letters! }).forms[k]!, b = packedIndex({ counts, forms }).forms[k]!;
    assert.equal(a.all, b.all);
    for (let i = 0; i < src.list.length; i++) assert.equal(a.ayah(i), b.ayah(i));
    for (let x = 0; x <= counts.length; x++) assert.equal(a.surah(x), b.surah(x));
    for (const w of forms[k]!.words!.split(' ').slice(0, 300)) { assert.equal(a.has!(w), true); assert.equal(a.has!(w + 'z'), false); }
    for (const x of ['off', 'len', 'woff', 'seq', 'pstart', 'plist', 'wpos'] as const) assert.deepEqual(Array.from(d.letters![k]![x]!), Array.from(forms[k]![x]!), `${k}.${x}`);
  }
  for (let i = 0; i < full.length; i++) { assert.equal(hashHex(d.hashes!.full, i), full[i]); assert.equal(hashHex(d.hashes!.bare, i), bare[i]); }
  assert.equal(hashHex(d.hashes!.full, full.length), undefined);
  assert.throws(() => decodeWorkerData(new Uint8Array(16).buffer), /magic/);
  // A config that expects the data, given a module without it: the Worker does not start.
  const empty = stamped(encodeWorkerData({}));
  assert.throws(() => withWorkerData({ dev: true, record: { name: 'S', edition: 'e', status: 's' }, lettersQuran: { counts }, workerData: empty.workerData } as never, empty.buf), /letters expected/);
  assert.throws(() => withWorkerData({ dev: true, record: { name: 'S', edition: 'e', status: 's' }, verifyHashes: { counts }, workerData: empty.workerData } as never, empty.buf), /hashes expected/);
  // With the data, a built Worker answers with marks equal to the plain-list Worker's.
  const good = stamped(encodeWorkerData({ letters: packLetters(counts, { uthmani: lettersQuran.letters }).forms }));
  const cfg = withWorkerData({ testMemoryLimits: true, dev: true, gate: false, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts, tafseerLimit: 1000, lettersQuran: { counts, sha256: 'a'.repeat(64), checkVersion: 'm1-test' }, workerData: good.workerData } as never, good.buf);
  assert.equal('workerData' in cfg, false, 'the stamp is not passed on to the Worker');
  const mock = createMockQf({ quran: src });
  const w = makeWorker(ab, cfg, { fetch: mock.fetch, cache: () => null, pauseMs: 0 } as never);
  const { w: plain } = worker({ cache: new FakeCache() });
  for (const a of [CASE.quoteExact, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.braces]) {
    const body = JSON.stringify({ s: 2, a });
    const r1 = await (await w.fetch(new Request(BASE.replace('9993', '9994') + '/api/tafseer', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), ENV as never)).json() as { marks?: unknown };
    const r2 = await (await plain.fetch(new Request(BASE.replace('9993', '9994') + '/api/tafseer', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), ENV as never)).json() as { marks?: unknown };
    assert.ok(r1.marks, `marks for 2:${a}`);
    assert.deepEqual(r1.marks, r2.marks, `2:${a}`);
  }
});
