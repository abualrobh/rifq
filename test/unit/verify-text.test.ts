// D-081 text verification against the mock (documented /verses/by_chapter shape), synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { bareAyah } from '../../src/core/tafseer-quotes.ts';
import { createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';

const { ab, src } = synthetic('verify');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const hashes = { counts: [0, ...SYN_COUNTS.slice(1)], full: src.slices.map((b) => sha(b)), bare: src.list.map((a) => sha(Buffer.from(bareAyah(a.aya_text), 'utf8'))) };
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', QF_TEST_BASE: 'http://127.0.0.1:9997', SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64'), 'content-type': 'application/json' };

function setup(gate = true, dev = true) {
  const mock = createMockQf({ quran: src });
  const w = makeWorker(ab, { dev, gate, record: { name: 'S', edition: 'e', status: 's' }, verifyHashes: hashes, tafseerLimit: 1000 }, { fetch: mock.fetch, pauseMs: 0 } as never);
  return { w, mock };
}
const run = (w: ReturnType<typeof makeWorker>, s: number, h: Record<string, string> = auth) => w.fetch(new Request('http://127.0.0.1/api/dev/verify-text', { method: 'POST', headers: h, body: JSON.stringify({ s }) }), ENV as never);

test('D-081: every category is reported by reference and hash, with no text, using a content.quran.read token', async () => {
  const { w, mock } = setup();
  const r = await run(w, 1);
  assert.equal(r.status, 200);
  const raw = await r.text();
  const d = JSON.parse(raw);
  const by = Object.fromEntries(d.rows.map((x: { ref: string; result: string }) => [x.ref, x.result]));
  assert.deepEqual(by, { '1:1': 'same_with_number', '1:2': 'same_without_number', '1:3': 'same_text_number_form', '1:4': 'differs', '1:5': 'missing', '1:6': 'same_without_number', '1:7': 'same_without_number' });
  for (const a of src.list.filter((x) => x.sora === 1)) for (const word of bareAyah(a.aya_text).split(' ')) assert.ok(!raw.includes(word), 'no Quran text in the answer');
  assert.deepEqual(mock.state.tokenBodies, ['grant_type=client_credentials&scope=content.quran.read']);
  assert.ok(mock.state.paths.every((p) => p.startsWith('/content/api/v4/verses/by_chapter/1?') && p.includes('fields=text_qpc_hafs') && p.includes('per_page=50')));
  const row = d.rows.find((x: { ref: string }) => x.ref === '1:1');
  assert.equal(row.full, hashes.full[0]);
});

test('D-081: pages are followed, and every ayah of a longer surah is compared', async () => {
  const { w, mock } = setup();
  const d = await (await run(w, 2)).json();
  assert.equal(d.rows.length, 40);
  assert.equal(d.pages, 1);
  assert.ok(d.rows.every((x: { result: string }) => x.result === 'same_without_number'));
  assert.equal(mock.state.contentRequests, 1);
  assert.equal((await (await run(w, 3)).json()).status, 'unavailable', 'surah outside pre-live data');
});

test('D-081: development builds behind the gate only; bad input refused', async () => {
  assert.equal((await run(setup(false).w, 1, { 'content-type': 'application/json' })).status, 404);
  assert.equal((await run(setup(true, false).w, 1)).status, 404);
  const { w } = setup();
  assert.equal((await run(w, 1, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await run(w, 0)).status, 400);
  assert.equal((await run(w, 8)).status, 400);
  assert.equal((await w.fetch(new Request('http://127.0.0.1/api/dev/verify-text', { headers: auth }), ENV as never)).status, 405);
});

test('font check page gets the documented font address in font-src, and no other page does', async () => {
  const mock = createMockQf();
  const csp = "default-src 'none'; font-src 'self'; style-src 'self'";
  const w = makeWorker(ab, { dev: true, gate: true, record: { name: 'S', edition: 'e', status: 's' }, assetHeaders: { 'Content-Security-Policy': csp } }, { fetch: mock.fetch });
  const env = { ...ENV, ASSETS: { fetch: async () => new Response('page') } };
  const f = await w.fetch(new Request('http://127.0.0.1/dev/font-check/', { headers: auth }), env as never);
  assert.equal(f.headers.get('content-security-policy'), "default-src 'none'; font-src 'self' https://verses.quran.foundation; style-src 'self'");
  const o = await w.fetch(new Request('http://127.0.0.1/2/', { headers: auth }), env as never);
  assert.equal(o.headers.get('content-security-policy'), csp);
});
