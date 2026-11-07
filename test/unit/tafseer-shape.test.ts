// by_ayah in both plausible shapes (parseByAyah), the Worker on a shape-B work, and the private
// shape diagnostic page. Made-up data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { parseByAyah, QfError } from '../../src/worker/qf.ts';
import { shapeOf } from '../../src/worker/shape.ts';
import { CASE, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_SHAPE_B_ID, MOCK_TAFSIR_ID, passageText } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';

// Odd but valid characters: canonically equivalent orders, a no-break space, a zero-width
// non-joiner and spaces at both ends. They must come back unchanged.
const ODD = '  ' + String.fromCodePoint(0x628, 0x651, 0x650) + '\u00a0' + String.fromCodePoint(0x628, 0x650, 0x651) + '\u200c<b>x</b> ';

test('shape A: text inside verses["S:A"]; neighbours join only with identical text', () => {
  const p = parseByAyah({ tafsir: { verses: { '2:5': { text: ODD, resource_name: 'R', language_name: 'arabic' } } } }, 2, 5)!;
  assert.equal(p.text, ODD);
  assert.deepEqual(p.range, { s: 2, from: 5, to: 5 });
  assert.equal(p.resourceName, 'R');
  const g = parseByAyah({ tafsir: { verses: { '2:3': { text: 'T' }, '2:4': { text: 'T' }, '2:5': { text: 'T' }, '2:6': { text: 'U' } } } }, 2, 4)!;
  assert.deepEqual(g.range, { s: 2, from: 3, to: 5 });
});

test('shape B: text at tafsir.text; the range is the unbroken run of verses keys around the ayah', () => {
  const b = { tafsir: { verses: { '2:3': { id: 1 }, '2:4': { id: 2 }, '2:5': { id: 3 }, '2:7': { id: 4 } }, resource_id: 9, resource_name: 'Top', language_id: 1, slug: 's', translated_name: { name: 'n', language_name: 'english' }, text: ODD, language_name: 'arabic' } };
  const p = parseByAyah(b, 2, 4)!;
  assert.ok(Buffer.from(p.text, 'utf8').equals(Buffer.from(ODD, 'utf8')), 'bytes unchanged');
  assert.deepEqual(p.range, { s: 2, from: 3, to: 5 }, '2:7 is not joined across the gap at 2:6');
  assert.equal(p.resourceName, 'Top');
  assert.equal(p.languageName, 'arabic');
  // verses without the requested key: the ayah alone.
  assert.deepEqual(parseByAyah({ tafsir: { verses: { '2:9': { id: 1 } }, text: 'T' } }, 2, 4)!.range, { s: 2, from: 4, to: 4 });
  // no verses map at all.
  assert.deepEqual(parseByAyah({ tafsir: { text: 'T' } }, 1, 1)!.range, { s: 1, from: 1, to: 1 });
});

test('both present: the per-key text wins; "none" only when no non-empty text exists', () => {
  assert.equal(parseByAyah({ tafsir: { verses: { '1:1': { text: 'KEY' } }, text: 'TOP' } }, 1, 1)!.text, 'KEY');
  assert.equal(parseByAyah({ tafsir: { verses: { '1:1': { text: '' } }, text: 'TOP' } }, 1, 1)!.text, 'TOP');
  assert.equal(parseByAyah({ tafsir: { verses: { '1:1': { id: 1 } }, text: '' } }, 1, 1), null);
  assert.equal(parseByAyah({ tafsir: { verses: {}, text: null } }, 1, 1), null);
  assert.equal(parseByAyah({ tafsir: { verses: {} } }, 1, 1), null);
  for (const bad of [{}, { tafsir: [] }, { tafsir: 'x' }, { tafsir: { verses: [] } }, { tafsir: { verses: 'x' } }]) {
    assert.throws(() => parseByAyah(bad, 1, 1), QfError);
  }
});

const { ab, src } = synthetic('shape');
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_SHAPE_B_ID), QF_TEST_BASE: 'http://127.0.0.1:9996', SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
const worker = (gate = true) => makeWorker(ab, { dev: true, gate, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts: [0, ...SYN_COUNTS.slice(1)], tafseerLimit: 1000 }, { fetch: createMockQf({ quran: src }).fetch, cache: () => null });
const ask = (w: ReturnType<typeof makeWorker>, s: number, a: number) => w.fetch(new Request('http://127.0.0.1/api/tafseer', { method: 'POST', body: JSON.stringify({ s, a }), headers: { 'content-type': 'application/json', ...auth } }), ENV as never);

test('Worker on a shape-B work: byte-equal passages, ranges, and "none" for empty text', async () => {
  const w = worker();
  for (const [s, a] of [[1, 1], [2, 3], [2, 20]]) {
    const d = await (await ask(w, s, a)).json();
    assert.equal(d.status, 'ok', `${s}:${a}`);
    assert.ok(Buffer.from(d.text, 'utf8').equals(Buffer.from(passageText(MOCK_SHAPE_B_ID, s, a)!, 'utf8')));
    assert.equal(d.source.title, 'Mock Arabic Tafsir D (shape B)');
    assert.equal(d.source.language, 'arabic');
  }
  assert.deepEqual((await (await ask(w, 2, 4)).json()).range, { s: 2, from: CASE.grouped[0], to: CASE.grouped[2] });
  assert.equal((await (await ask(w, 2, CASE.none)).json()).status, 'none');
});

test('shapeOf lists paths, types and lengths, never content', () => {
  const secret = 'SECRET-CONTENT-' + String.fromCodePoint(0x628, 0x628);
  const { lines } = shapeOf({ tafsir: { verses: { '2:3': { id: 77 }, 'free text key!': 1 }, text: secret, ok: true }, list: [{ a: 'x' }, { a: 'yyy', b: null }] });
  const out = JSON.stringify(lines);
  assert.ok(!out.includes('SECRET') && !out.includes('77') && !out.includes('free text') && !out.includes('true'));
  const by = Object.fromEntries(lines.map((l) => [`${l.path} ${l.type}`, l]));
  assert.equal(by['$.tafsir.text string'].maxLen, [...secret].length);
  assert.ok(by['$.tafsir.verses.2:3.id number']);
  assert.ok(by['$.tafsir.verses.<key not shown> number']);
  assert.equal(by['$.list array'].length, 2);
  assert.deepEqual([by['$.list[].a string'].minLen, by['$.list[].a string'].maxLen, by['$.list[].a string'].count], [1, 3, 2]);
  assert.ok(by['$.list[].b null']);
});

test('shape page: behind the gate in development builds; shows paths and parser result, no text', async () => {
  const w = worker();
  const get = (q: string, h: Record<string, string> = auth) => w.fetch(new Request('http://127.0.0.1/dev/tafseer-shape/' + q, { headers: h }), ENV as never);
  assert.equal((await get('?kind=ayah&ref=2:3', {})).status, 401);
  const r = await get('?kind=ayah&ref=2:3');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const h = await r.text();
  assert.ok(h.includes('DEVELOPMENT PAGE'));
  assert.ok(h.includes('<code>$.tafsir.text</code></td><td>string</td>'));
  assert.ok(h.includes('<code>$.tafsir.verses.2:3.id</code>'));
  assert.ok(h.includes('passage found in tafsir.text'));
  assert.ok(h.includes(`range 2:${CASE.grouped[0]} to 2:${CASE.grouped[2]}`));
  assert.ok(!h.includes('MOCK GROUPED') && !h.includes('Mock Arabic Tafsir D'), 'no content');
  const c = await (await get(`?kind=chapter&s=1&page=1&id=${MOCK_TAFSIR_ID}`)).text();
  assert.ok(c.includes('<code>$.tafsirs[].text</code>') && c.includes('<code>$.pagination.next_page</code>'));
  assert.ok(!c.includes('MOCK PASSAGE'));
  assert.equal((await get('?kind=ayah&ref=2:99')).status, 400);
  assert.ok((await (await get('')).text()).includes('Show shape'));
  assert.equal((await worker(false).fetch(new Request('http://127.0.0.1/dev/tafseer-shape/?kind=ayah&ref=1:1'), ENV as never)).status, 404);
});
