// D-095 (security review 2026-11-11, S-1): every rate limit binding fails closed, and any thrown
// error becomes a fixed 503 with RIFQ's headers. D-096 (S-2): the GET dev pages refuse cross-site
// requests. Against the mock Quran Foundation API with synthetic data and made-up credentials;
// every upstream call is counted. No real API call is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { bareAyah, lettersOnly } from '../../src/core/tafseer-quotes.ts';
import { createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';
import type { RateLimit } from '../../src/worker/gate.ts';

const { ab, src } = synthetic('fail-closed');
const ORIGIN = 'http://127.0.0.1';
const AUTH = 'Basic ' + Buffer.from('u:p').toString('base64');
const BASE_ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), QF_TEST_BASE: 'http://127.0.0.1:9995', SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const counts = [0, ...SYN_COUNTS.slice(1)];
const sha = () => '0'.repeat(64);

const allow: RateLimit = { async limit() { return { success: true }; } };
const deny: RateLimit = { async limit() { return { success: false }; } };
const throws: RateLimit = { async limit() { throw new Error('binding down'); } };
const noFn = {} as RateLimit;

// A deployed-like Worker: no testMemoryLimits, so there is no per-isolate fallback.
function setup(gate = true) {
  const mock = createMockQf({ quran: src });
  let calls = 0;
  const fetchFn = (u: string, i: RequestInit) => { calls++; return mock.fetch(u, i); };
  const w = makeWorker(ab, {
    dev: true, gate, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts,
    fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [] },
    verifyHashes: { counts, full: src.slices.map(sha), bare: src.list.map(sha) },
    lettersQuran: { counts, letters: src.list.map((a) => lettersOnly(bareAyah(a.aya_text))) },
  }, { fetch: fetchFn, cache: () => null, pauseMs: 0 } as never);
  return { w, calls: () => calls };
}

type Route = { name: string; req: (h?: Record<string, string>) => Request };
const post = (path: string, body: string) => (h: Record<string, string> = {}) =>
  new Request(ORIGIN + path, { method: 'POST', body, headers: { authorization: AUTH, 'content-type': 'application/json', 'cf-connecting-ip': '10.5.5.5', ...h } });
const get = (path: string) => (h: Record<string, string> = {}) =>
  new Request(ORIGIN + path, { headers: { authorization: AUTH, 'cf-connecting-ip': '10.5.5.5', ...h } });
const TAFSEER_ROUTES: Route[] = [
  { name: '/api/tafseer', req: post('/api/tafseer', '{"s":1,"a":1}') },
  { name: '/api/dev/verify-text', req: post('/api/dev/verify-text', '{"s":1}') },
  { name: '/api/dev/quote-check', req: post('/api/dev/quote-check', '{"s":1}') },
  { name: '/dev/tafseer-catalogue/', req: get('/dev/tafseer-catalogue/') },
  { name: '/dev/reciters/', req: get('/dev/reciters/') },
  { name: '/dev/tafseer-shape/', req: get(`/dev/tafseer-shape/?kind=chapter&s=1&page=1&id=${MOCK_TAFSIR_ID}`) },
];
const DEV_GET = TAFSEER_ROUTES.slice(3);

function assertHeaders(r: Response, what: string) {
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', `${what}: noindex (D-066)`);
  assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000', `${what}: HSTS (D-067)`);
  assert.ok((r.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), `${what}: CSP`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${what}: nosniff`);
  assert.equal(r.headers.get('x-frame-options'), 'DENY', `${what}: frame`);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer', `${what}: referrer`);
  assert.equal(r.headers.get('cache-control'), 'private, no-store', `${what}: cache`);
}

test('D-095: TAFSEER_LIMIT missing, throwing or without limit(): 503 with headers and no upstream call', async () => {
  for (const [label, binding] of [['missing', undefined], ['throws', throws], ['no limit()', noFn]] as const) {
    for (const route of TAFSEER_ROUTES) {
      const { w, calls } = setup();
      const env = { ...BASE_ENV, SEARCH_LIMIT: allow, ...(binding ? { TAFSEER_LIMIT: binding } : {}) };
      const r = await w.fetch(route.req(), env as never);
      const what = `${route.name} with TAFSEER_LIMIT ${label}`;
      assert.equal(r.status, 503, what);
      assertHeaders(r, what);
      assert.equal(r.headers.get('retry-after'), '60', what);
      const body = await r.text();
      assert.ok(!body.includes(MOCK_CLIENT_SECRET), what);
      assert.equal(calls(), 0, `${what}: no upstream call`);
    }
  }
});

test('D-095: TAFSEER_LIMIT denying gives 429 with no upstream call; allowing reaches the API', async () => {
  for (const route of TAFSEER_ROUTES) {
    const { w, calls } = setup();
    const r = await w.fetch(route.req(), { ...BASE_ENV, TAFSEER_LIMIT: deny } as never);
    assert.equal(r.status, 429, route.name);
    assertHeaders(r, route.name);
    assert.equal(calls(), 0, route.name);
    const ok = await w.fetch(route.req(), { ...BASE_ENV, TAFSEER_LIMIT: allow } as never);
    assert.equal(ok.status, 200, route.name);
    assert.ok(calls() > 0, `${route.name}: the API is called when the limit allows it`);
  }
});

test('D-095: /api/tafseer answers the island\'s JSON shape when the limit cannot be checked', async () => {
  const { w } = setup();
  const r = await w.fetch(TAFSEER_ROUTES[0].req(), BASE_ENV as never);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await r.json(), { status: 'unavailable' });
});

test('D-095: SEARCH_LIMIT missing, throwing or without limit(): 503 on both paths, gate on and off', async () => {
  const q = src.list[0].aya_text.split(' ')[0];
  for (const gate of [true, false]) {
    for (const [label, binding] of [['missing', undefined], ['throws', throws], ['no limit()', noFn]] as const) {
      const { w } = setup(gate);
      const env = { ...BASE_ENV, TAFSEER_LIMIT: allow, ...(binding ? { SEARCH_LIMIT: binding } : {}) };
      const what = `search, gate ${gate ? 'on' : 'off'}, SEARCH_LIMIT ${label}`;
      const j = await w.fetch(post('/api/search', JSON.stringify({ q }))(), env as never);
      assert.equal(j.status, 503, what + ' (JSON)');
      assert.deepEqual(await j.json(), { error: 'unavailable' });
      assert.equal(j.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(j.headers.get('strict-transport-security'), 'max-age=31536000');
      assert.ok(j.headers.get('content-security-policy'));
      const f = await w.fetch(new Request(ORIGIN + '/api/search', { method: 'POST', body: new URLSearchParams({ q, lang: 'en' }).toString(), headers: { authorization: AUTH, 'content-type': 'application/x-www-form-urlencoded' } }), env as never);
      assert.equal(f.status, 503, what + ' (form)');
      assert.equal(f.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(f.headers.get('strict-transport-security'), 'max-age=31536000');
      const page = await f.text();
      assert.ok(page.includes('Search is not available right now.'), what);
      assert.ok(!page.includes('<script'), what);
    }
    const { w } = setup(gate);
    assert.equal((await w.fetch(post('/api/search', JSON.stringify({ q }))(), { ...BASE_ENV, SEARCH_LIMIT: allow } as never)).status, 200);
    assert.equal((await w.fetch(post('/api/search', JSON.stringify({ q }))(), { ...BASE_ENV, SEARCH_LIMIT: deny } as never)).status, 429);
  }
});

test('D-095: any thrown error becomes a fixed 503 with headers, never the platform error page', async () => {
  for (const gate of [true, false]) {
    const { w } = setup(gate);
    const env = { ...BASE_ENV, SEARCH_LIMIT: allow, TAFSEER_LIMIT: allow, ASSETS: { async fetch(): Promise<Response> { throw new Error('assets down'); } } };
    const r = await w.fetch(get('/1/')(), env as never);
    assert.equal(r.status, 503);
    assertHeaders(r, `asset error, gate ${gate ? 'on' : 'off'}`);
    assert.equal(await r.text(), 'Not available right now. Try again later.\n');
  }
  // The gate itself throwing (a broken secret binding) is caught the same way.
  const { w } = setup(true);
  const env = { ...BASE_ENV, get SITE_PASSWORD(): string { throw new Error('secret down'); } };
  const r = await w.fetch(get('/1/')(), env as never);
  assert.equal(r.status, 503);
  assertHeaders(r, 'gate error');
});

test('D-095: scripts/build.ts never turns on the per-isolate test counters', () => {
  const b = readFileSync('scripts/build.ts', 'utf8');
  assert.ok(!b.includes('testMemoryLimits'));
});

test('D-096: GET dev pages refuse cross-site requests with 403 and no upstream call', async () => {
  const env = { ...BASE_ENV, TAFSEER_LIMIT: allow };
  const bad: Record<string, string>[] = [
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' },
  ];
  for (const route of DEV_GET) {
    for (const h of bad) {
      const { w, calls } = setup();
      const r = await w.fetch(route.req(h), env as never);
      const what = `${route.name} ${JSON.stringify(h)}`;
      assert.equal(r.status, 403, what);
      assert.deepEqual(await r.json(), { error: 'cross_site' });
      assertHeaders(r, what);
      assert.equal(calls(), 0, `${what}: no upstream call`);
    }
  }
});

test('D-096: same-origin navigation, a typed address and requests without fetch metadata still work', async () => {
  const env = { ...BASE_ENV, TAFSEER_LIMIT: allow };
  const good: Record<string, string>[] = [
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' },
    { 'sec-fetch-site': 'same-origin', origin: ORIGIN },
    { 'sec-fetch-site': 'same-origin', origin: 'null' },
    { 'sec-fetch-site': 'none' },
    {},
  ];
  for (const route of DEV_GET) {
    for (const h of good) {
      const { w, calls } = setup();
      const r = await w.fetch(route.req(h), env as never);
      const what = `${route.name} ${JSON.stringify(h)}`;
      assert.equal(r.status, 200, what);
      assert.ok((await r.text()).includes('DEVELOPMENT PAGE'), what);
      assert.ok(calls() > 0, what);
    }
  }
  // Without credentials the gate still answers first.
  const { w, calls } = setup();
  const r = await w.fetch(new Request(ORIGIN + '/dev/tafseer-shape/', { headers: { 'sec-fetch-site': 'cross-site' } }), env as never);
  assert.equal(r.status, 401);
  assert.equal(calls(), 0);
});
