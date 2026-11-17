// Kit v35: fixes to English Tafseer (RQ-007) found on the test site with kit v34, and decisions
// D-174 A, D-175 A and D-176 A (D-176 A is tested in tafseer-release.test.ts).
//   B1  the sign U+FDFA and other Arabic presentation forms inside ( ), { } and ornate parentheses:
//       the words a reader sees are the delivered characters apart from the bracket marks, in
//       English and Arabic passages (AC35, AC4, RQ-005 AC35);
//   B2  Arabic quotations in English passages: their quotation marks and punctuation go into the
//       Arabic run; a paragraph that is one Arabic line is right to left as a whole (AC20, R-5);
//   B3  a matched phrase mixing English and Arabic letters is not marked Arabic as a whole (FIND-AS);
//       the coverage page counts mixed phrases;
//   B4  /dev/quote-check/ (English): "Reader display N" counts unclosed phrases only;
//   B5  English marks with less CPU: the same letters as computeMarks for every passage.
// Synthetic Quran data and made-up text only. This file holds no Arabic characters: Arabic letters
// are cut by program from the synthetic source or written as escapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';
import { CASE, createMockQf, EN_CASE, enPassageText, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_EN_ID, MOCK_TAFSIR_ID, passageText } from '../mock/qf-mock.ts';
import { bareAyah, hasArabicLetters, indexFromSource, lettersOnly, phrasesAt } from '../../src/core/tafseer-quotes.ts';
import { computeMarks, markedNodes, markedText } from '../../src/core/tafseer-marks.ts';
import { blockText, sanitize, visibleText } from '../../src/core/tafseer-html.ts';
import { arabicRuns, hasOtherLetter, isArabicLine } from '../../src/core/bidi.ts';
import { enMarks, phrasesFast } from '../../src/worker/marks-en.ts';
import { makeWorker } from '../../src/worker/app.ts';
import type { CacheLike } from '../../src/worker/tafseer.ts';
import { notConfiguredMessage } from '../../src/site/lib/tafseer-messages.ts';
import { displayN } from '../../src/site/lib/quote-check-counts.ts';
import { STRINGS } from '../../src/core/strings.ts';

const { ab, src } = synthetic('kit-v35');
const ix = indexFromSource(src.list);
const lettersQuran = { counts: [0, ...SYN_COUNTS.slice(1)], letters: src.list.map((a) => lettersOnly(bareAyah(a.aya_text))), sha256: 'a'.repeat(64), checkVersion: 'm1-test' };
const ayah = (s: number, a: number) => bareAyah(src.list.find((x) => x.sora === s && x.aya_no === a)!.aya_text).split(' ');
const OPEN = '\ufd3f', CLOSE = '\ufd3e', SAW = '\ufdfa', LQ = '\u00ab', RQ = '\u00bb', QM = '\u061f', COMMA = '\u060c';

let seed = 35;
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
// Every presentation form of the two blocks that is a character (U+FB50-U+FDFF, U+FE70-U+FEFF),
// except the two ornate parentheses, which are brackets here.
const FORMS: string[] = [];
for (let c = 0xfb50; c <= 0xfeff; c++) if ((c <= 0xfdff || c >= 0xfe70) && c !== 0xfd3e && c !== 0xfd3f && /\p{Assigned}/u.test(String.fromCodePoint(c))) FORMS.push(String.fromCodePoint(c));

// ---------------------------------------------------------------- B5: same marks, less work
const PIECES = ['(', ')', '{', '}', OPEN, CLOSE, '\n', ' ', 'mock', 'Words', '2:255', SAW, '\u0627', '[', ']', LQ, RQ, '<p>', '</p>', '<br>', '<b>', '</b>', '&amp;'];
function fuzzText(): string {
  let t = '';
  const n = 1 + rnd(40);
  for (let i = 0; i < n; i++) {
    const k = rnd(10);
    if (k < 6) t += PIECES[rnd(PIECES.length)];
    else if (k < 8) { const w = ayah(1 + rnd(2), 1 + rnd(5)); t += w.slice(0, 1 + rnd(w.length)).join(' '); }
    else t += FORMS[rnd(FORMS.length)];
  }
  return t;
}

test('B5: phrasesFast finds exactly the phrases of phrasesAt (same text, start, end and unclosed), fuzzed and on every mock passage', () => {
  const same = (t: string) => {
    const a = phrasesAt(t).map((p) => ({ text: p.text, start: p.start, end: p.end, unclosed: !!p.unclosed }));
    assert.deepEqual(phrasesFast(t), a, JSON.stringify(t));
  };
  for (let i = 0; i < 20000; i++) same(blockText(fuzzText()));
  for (const s of [1, 2]) for (let a = 1; a <= SYN_COUNTS[s]; a++) for (const id of [MOCK_TAFSIR_ID, MOCK_EN_ID]) { const t = passageText(id, s, a, src); if (t) same(blockText(t)); }
  for (const t of ['', '(', ')', '((', '(a)(b)', '{a\n}', `${OPEN}x${CLOSE}`, `${CLOSE}x${OPEN}`, '(a\nb)', 'x(', '(\n(']) same(t);
});

test('B5: enMarks gives the same letters as computeMarks(..., false) and asks for the index only when a phrase has Arabic letters', () => {
  for (let i = 0; i < 5000; i++) {
    const html = fuzzText();
    const own = { s: 1 + rnd(2), from: 1, to: 1 + rnd(3) };
    let asked = 0;
    const got = enMarks(() => { asked++; return ix; }, html, own);
    assert.deepEqual(got, computeMarks(ix, html, own, false), JSON.stringify(html));
    if (!/[^N]/.test(got.c)) assert.equal(asked, 0, 'no Arabic-letter phrase: no index');
    assert.ok(asked <= 1);
  }
  for (let a = 1; a <= SYN_COUNTS[2]; a++) {
    const t = enPassageText(2, a, src);
    if (t) assert.deepEqual(enMarks(() => ix, t, { s: 2, from: a, to: a }), computeMarks(ix, t, { s: 2, from: a, to: a }, false), `2:${a}`);
  }
});

// ---------------------------------------------------------------- B1: presentation forms are shown
// The reader's words (markedText of markedNodes, or visibleText of sanitize when there are no
// marks) with the bracket marks taken out, against the delivered text with its brackets taken out.
const noBrackets = (t: string) => t.replace(/[(){}\ufd3e\ufd3f]/g, '');
function shownEqualsDelivered(html: string, marks: unknown) {
  const m = markedNodes(html, marks);
  assert.ok(m, 'the marks fit');
  assert.equal(noBrackets(markedText(m!.nodes)), noBrackets(visibleText(sanitize(html))));
  // Every character of each text run survives the Arabic-run split unchanged.
  const walk = (n: typeof m.nodes): void => { for (const x of n) { if (typeof x === 'string') assert.equal(arabicRuns(x).map((p) => p.text).join(''), x); else if ('tfq' in x) assert.equal(arabicRuns(x.text).map((p) => p.text).join(''), x.text); else walk(x.children); } };
  walk(m!.nodes);
}

test('B1 (AC35, AC4): U+FDFA and every Arabic presentation form inside ( ), { } and ornate parentheses are shown as delivered, English and Arabic passages', () => {
  const own = ayah(2, 3).slice(0, 2).join(' ');
  for (const f of FORMS) {
    const en = `<p>Mock (${f}) and (O Mock ${f}) and {${f}} and ${OPEN}${f}${CLOSE} and {${own} ${f}} and (mock ${f} mock) end ${f} !</p>`;
    shownEqualsDelivered(en, enMarks(() => ix, en, { s: 2, from: 3, to: 3 }));
    const ar = `<p>${own} (${f}) ${own} {${own} ${f}} ${OPEN}${f}${CLOSE} (${f} ${own}) ${f}.</p>`;
    shownEqualsDelivered(ar, computeMarks(ix, ar, { s: 2, from: 3, to: 3 }, true));
  }
  // The sign is never dropped from a styled phrase's words.
  const en = `<p>He said (${SAW}) and (O Mock ${SAW}).</p>`;
  const m = markedNodes(en, enMarks(() => ix, en, { s: 1, from: 1, to: 1 }))!;
  const words = m.nodes.flatMap((n) => (typeof n === 'object' && 'tag' in n ? n.children : [n])).filter((n) => typeof n === 'object' && 'tfq' in n) as { text: string }[];
  assert.deepEqual(words.map((w) => w.text), [SAW, `O Mock ${SAW}`]);
});

// ---------------------------------------------------------------- B2: Arabic runs and lines
test('B2 (AC20, R-5): quotation marks and punctuation of an Arabic quotation are in its run; English around it keeps its order; nothing changes', () => {
  const A = ayah(2, 2)[0], B = ayah(2, 2)[1], C = ayah(2, 3)[0];
  const runs = (t: string) => arabicRuns(t).filter((p) => p.ar).map((p) => p.text);
  assert.deepEqual(runs(`He said, ${LQ}${A} ${B}${QM}${RQ} and`), [`${LQ}${A} ${B}${QM}${RQ}`]);
  assert.deepEqual(runs(`${LQ}${A} ${B} ${C}${RQ}`), [`${LQ}${A} ${B} ${C}${RQ}`], 'a whole line');
  assert.deepEqual(runs(`x ${LQ}${A} 3 ${B}${RQ} (7) end.`), [`${LQ}${A} 3 ${B}${RQ}`], 'a number inside; (7) and the full stop stay outside');
  assert.deepEqual(runs(`mock "${A}" and (${B}) and ${C}${QM} ${A}${COMMA} done`), [`"${A}"`, `(${B})`, `${C}${QM} ${A}${COMMA}`]);
  assert.deepEqual(runs(`The word ${A} means x, and the words ${B}, ${C} mean y`), [A, B, C], 'English commas keep inline words apart, in English order');
  assert.deepEqual(runs(`${LQ}mixed ${A}${RQ}`), [A], 'a quotation with English inside is not taken as Arabic');
  assert.deepEqual(runs(`"English" ${A} "x"`), [A], 'an English quotation mark is never paired with another');
  assert.deepEqual(runs(`${OPEN}English${CLOSE} ${A}`), [A], 'an English phrase in ornate parentheses stays outside');
  assert.deepEqual(runs(`Allah ${SAW} !`), [SAW]);
  assert.deepEqual(runs(`${LQ}${A} ${B}`), [`${LQ}${A} ${B}`], 'a quotation that goes on after markup keeps its opening mark');
  assert.deepEqual(runs(`${A} ${B}${RQ}.`), [`${A} ${B}${RQ}`], 'and its closing mark');
  assert.equal(isArabicLine(`${LQ}${A} ${B}${QM}${RQ}`), true);
  assert.equal(isArabicLine(`${LQ}${A}${RQ} said`), false);
  assert.equal(isArabicLine('(2:255)'), false);
  assert.equal(hasOtherLetter(`${A} ${SAW} ${B}`), false);
  assert.equal(hasOtherLetter(`O ${SAW}`), true);
});

test('B2: arabicRuns gives the text back exactly and never leaves an Arabic-script character outside a run (200,000 fuzzed strings)', () => {
  const ch = ['a', 'Z', ' ', '\u00a0', '\u200c', '\u2060', '\n', '.', ',', '!', '?', '"', "'", '(', ')', '{', '}', '[', ']', LQ, RQ, '\u201c', '\u201d', '\u2039', '\u203a', OPEN, CLOSE, '1', '2', QM, COMMA, '\u0627', '\u0644', '\u0645', '\u064e', '\u0660', SAW, '\ufdf2', '\ufefb', '\u00e9', '\u03b1', '\ud83d\ude00', '\ud800'];
  const AR = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufd3d\ufd40-\ufdff\ufe70-\ufefe]/;
  for (let i = 0; i < 200000; i++) {
    let t = '';
    const n = rnd(14);
    for (let k = 0; k < n; k++) t += ch[rnd(ch.length)];
    const parts = arabicRuns(t);
    assert.equal(parts.map((p) => p.text).join(''), t);
    for (const p of parts) {
      if (!p.ar) assert.ok(!AR.test(p.text), JSON.stringify(t));
      else { assert.ok(AR.test(p.text)); assert.ok(!/^[\s\u00a0]|[\s\u00a0]$/.test(p.text), 'no space at the ends of a run'); assert.ok(!hasOtherLetter(p.text), 'no English letter in a run'); }
    }
  }
});

// ---------------------------------------------------------------- B4
test('B4: English quote check: "Reader display N" counts unclosed phrases only', () => {
  // v34 test site (surahs 1 and 2): N 4,701 = 4,696 closed phrases with no Arabic letters + 5 unclosed.
  assert.equal(displayN({ dN: 4701, otherPhrases: 4701, otherUnclosed: 5 }), 5);
  assert.equal(displayN({ dN: 7, otherPhrases: 4, otherUnclosed: 1 }), 4, 'Arabic-letter unclosed phrases count too');
  assert.equal(displayN({}), 0);
});

// ---------------------------------------------------------------- D-175 A
test('D-175 A (AC8, AC12): a release build with no English work set shows tafseerUnavailable; development builds name D-136', () => {
  assert.deepEqual(notConfiguredMessage('en', false), { key: 'tafseerUnavailable', msg: 'unavailable' });
  assert.deepEqual(notConfiguredMessage('en', true), { key: 'tafseerEnNotConfigured', msg: 'not_configured' });
  assert.deepEqual(notConfiguredMessage('ar', false), { key: 'tafseerNotConfigured', msg: 'not_configured' });
  assert.ok(!/D-\d/.test(STRINGS.en.tafseerUnavailable), 'no decision number reaches a release reader');
});

// ---------------------------------------------------------------- Worker: D-174 A, coverage counts
class FakeCache implements CacheLike {
  m = new Map<string, string>();
  async match(k: string) { const e = this.m.get(k); return e === undefined ? undefined : new Response(e); }
  async put(k: string, r: Response) { this.m.set(k, await r.text()); }
}
const BASE = 'http://127.0.0.1:9991';
const GATE = { SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), TAFSIR_EN_ID: String(MOCK_EN_ID), QF_TEST_BASE: BASE, ...GATE };
const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
type Tweak = { listDown?: boolean; listNoLang?: boolean; listLang?: string; passageNoLang?: boolean };
function setup(t: Tweak = {}, dev = true, gate = false) {
  const mock = createMockQf({ quran: src });
  const fetch = async (u: string, init: RequestInit = {}) => {
    const url = new URL(u);
    if (url.pathname.endsWith('/resources/tafsirs')) {
      if (t.listDown) return new Response('{"message":"down"}', { status: 503, headers: { 'content-type': 'application/json' } });
      const j = await (await mock.fetch(u, init)).json() as { tafsirs: Record<string, unknown>[] };
      for (const x of j.tafsirs) if (x.id === MOCK_TAFSIR_ID) { if (t.listNoLang) delete x.language_name; if (t.listLang) x.language_name = t.listLang; }
      return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const r = await mock.fetch(u, init);
    if (!t.passageNoLang || !/\/by_ayah\//.test(url.pathname) || r.status !== 200) return r;
    const raw = await r.text();
    return new Response(raw.replace(/,?"language_name":"[a-z]+"/g, ''), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cache = new FakeCache();
  const w = makeWorker(ab, {
    testMemoryLimits: true, dev, gate, tafseer: true, record: { name: 'S', edition: 'e', status: 's' },
    counts: [0, ...SYN_COUNTS.slice(1)], tafseerLimit: 1000, lettersQuran, fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [] },
  }, { fetch, now: () => Date.parse('2026-11-17T00:00:00Z'), cache: () => cache, pauseMs: 0, timeoutMs: 2000 } as never);
  return { w, mock };
}
const post = (w: ReturnType<typeof makeWorker>, path: string, body: unknown) =>
  w.fetch(new Request('http://127.0.0.1' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.7.7.8', ...auth } }), ENV as never);
const askAr = async (w: ReturnType<typeof makeWorker>, a: number) => { const r = await post(w, '/api/tafseer', { s: 2, a }); return { status: r.status, body: await r.text() }; };

test('D-174 A (AC9, FIND-AT): the Arabic setting serves only a work the API calls "arabic"; a labelled Arabic work gets the same answers', async () => {
  const base = setup();
  const ref = [];
  for (const a of [20, CASE.none, CASE.grouped[0], CASE.quoteExact]) ref.push(await askAr(base.w, a));
  assert.deepEqual(ref.map((r) => r.status), [200, 404, 200, 200]);
  assert.deepEqual(JSON.parse(ref[1].body), { status: 'none', s: 2, a: CASE.none });
  // Labelled "arabic" in the list only, or in the passage only: the same bytes.
  for (const t of [{ passageNoLang: true }, { listNoLang: true }] as Tweak[]) {
    const { w } = setup(t);
    for (const [i, a] of [20, CASE.none, CASE.grouped[0], CASE.quoteExact].entries()) {
      // No passage and no language in the list: the language cannot be read (below).
      if (t.listNoLang && a === CASE.none) continue;
      assert.deepEqual(await askAr(w, a), ref[i], `${JSON.stringify(t)} 2:${a}`);
    }
  }
  // The list is down but the passage says "arabic": served as before (with no author, as before).
  const down = setup({ listDown: true });
  for (const [i, a] of [20, CASE.grouped[0], CASE.quoteExact].entries()) {
    const r = await askAr(down.w, a);
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ...JSON.parse(ref[i === 0 ? 0 : i + 1].body), source: { ...JSON.parse(ref[i === 0 ? 0 : i + 1].body).source, author: null } });
  }
  // Language cannot be read (not in the passage, no language in the list): refused, naming the
  // expected language and D-135 (development), nothing named (release); also for "no passage".
  for (const a of [20, CASE.none]) {
    const r = await askAr(setup({ passageNoLang: true, listNoLang: true }).w, a);
    assert.equal(r.status, 503);
    assert.deepEqual(JSON.parse(r.body), { status: 'not_configured', missing: ['arabic_tafsir (D-135)'] });
    assert.deepEqual(JSON.parse((await askAr(setup({ passageNoLang: true, listNoLang: true }, false).w, a)).body), { status: 'not_configured', missing: [] });
  }
  // Another language: refused the same way (was "D-077" before kit v35).
  assert.deepEqual(JSON.parse((await askAr(setup({ passageNoLang: true, listLang: 'english' }).w, 20)).body), { status: 'not_configured', missing: ['arabic_tafsir (D-135)'] });
  // The list cannot be read now and the passage does not say: "unavailable" (nothing shown).
  for (const a of [20, CASE.none]) assert.deepEqual(JSON.parse((await askAr(setup({ passageNoLang: true, listDown: true }).w, a)).body), { status: 'unavailable' });
  assert.deepEqual(JSON.parse((await askAr(setup({ listDown: true }).w, CASE.none)).body), { status: 'unavailable' });
});

test('B3, B1: the coverage page counts mixed phrases, empty bracketed phrases and the sign U+FDFA (numbers only)', async () => {
  const { w } = setup({}, true, true);
  let mixed = 0, all = 0;
  for (let page = 1; page <= 30; page++) {
    const r = await post(w, '/api/dev/tafseer-coverage', { s: 2, page, skip: 0 });
    assert.equal(r.status, 200);
    const raw = await r.text();
    const d = JSON.parse(raw);
    for (const p of d.passages) {
      for (const k of ['mixedPhrases', 'emptyPhrases', 'signInPhrases', 'sign']) assert.ok(Number.isInteger(p[k]), k);
      mixed += p.mixedPhrases; all += p.arabicPhrases;
      if (p.from <= EN_CASE.mixed && EN_CASE.mixed <= p.to) assert.equal(p.mixedPhrases, 1, 'the mock mixed phrase (2:31)');
    }
    assert.ok(!/MOCK/.test(raw), 'no text');
    if (!d.next) break;
  }
  // Expected from the mock passages themselves (each passage counted once).
  let want = 0;
  const seen = new Set<string>();
  for (let a = 1; a <= SYN_COUNTS[2]; a++) {
    const t = enPassageText(2, a, src);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    for (const p of phrasesAt(blockText(t))) if (hasArabicLetters(p.text) && hasOtherLetter(p.text)) want++;
  }
  assert.equal(mixed, want);
  assert.equal(want, 3, 'the mixed phrase of 2:31 and the two sign phrases with English words of 2:34');
  assert.ok(all > mixed);
});
