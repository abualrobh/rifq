// Worker behaviour on synthetic data: TP2-18 server backstop, TP2-24, TP2-32 server side, TP2-36,
// TP1-36 (no public route writes), and the no-logging rule (RQ-002 AC10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';

const { syn, ab } = synthetic('worker');
const cfg = { dev: true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' }, serverLimit: 30 };
const req = (body: string, type = 'application/json', method = 'POST', path = '/api/search', ip = '10.0.0.1') =>
  new Request('http://127.0.0.1' + path, { method, body: method === 'GET' ? undefined : body, headers: { 'content-type': type, 'cf-connecting-ip': ip } });

test('JSON search answers with no-store, security headers and no cookie', async () => {
  const w = makeWorker(ab, cfg);
  const r = await w.fetch(req(JSON.stringify({ q: syn.common })), {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.ok(r.headers.get('strict-transport-security'));
  assert.ok(!(r.headers.get('content-security-policy') ?? '').includes('unsafe-inline'));
  const d = await r.json();
  assert.ok(d.total > 50 && d.results.length === 50);
  assert.ok(![...r.headers.values()].some((v) => v.includes(syn.common)), 'query never echoed in headers');
});

test('TP1-36: other methods and routes are refused; nothing can write', async () => {
  const w = makeWorker(ab, cfg);
  for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) assert.equal((await w.fetch(req('{}', 'application/json', m), {})).status, 405);
  assert.equal((await w.fetch(req('{}', 'application/json', 'POST', '/api/text'), {})).status, 404);
  assert.equal((await w.fetch(req('{}', 'application/json', 'POST', '/api/'), {})).status, 404);
});

test('TP2-32 server side: over-long query and body are refused', async () => {
  const w = makeWorker(ab, cfg);
  const long = String.fromCodePoint(0x628).repeat(101);
  assert.equal((await w.fetch(req(JSON.stringify({ q: long }), 'application/json', 'POST', '/api/search', '10.0.0.2'), {})).status, 400);
  assert.equal((await w.fetch(req('x'.repeat(9000), 'application/json', 'POST', '/api/search', '10.0.0.3'), {})).status, 413);
});

test('TP2-18 backstop: the 31st search in a minute from one client gets 429 with Retry-After', async () => {
  const w = makeWorker(ab, cfg);
  for (let i = 0; i < 30; i++) assert.equal((await w.fetch(req(JSON.stringify({ q: syn.rare }), 'application/json', 'POST', '/api/search', '10.9.9.9'), {})).status, 200);
  const r = await w.fetch(req(JSON.stringify({ q: syn.rare }), 'application/json', 'POST', '/api/search', '10.9.9.9'), {});
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.deepEqual(await r.json(), { error: 'rate_limited' });
});

test('form POST (search sent before the island loads) returns a script-free page', async () => {
  const w = makeWorker(ab, cfg);
  const body = new URLSearchParams({ q: syn.common, lang: 'en' }).toString();
  const r = await w.fetch(req(body, 'application/x-www-form-urlencoded', 'POST', '/api/search', '10.0.0.4'), {});
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(!html.includes('<script'));
  assert.match(r.headers.get('content-security-policy')!, /default-src 'none'/);
  assert.ok(html.includes('data-res="'));
  assert.ok(html.includes('Unverified data, development only'));
});

test('TP2-36: payloads are escaped in the server page', async () => {
  const w = makeWorker(ab, cfg);
  const q = String.fromCodePoint(0x628, 0x628) + '"><img src=x onerror=1>';
  const r = await w.fetch(req(new URLSearchParams({ q, lang: 'ar' }).toString(), 'application/x-www-form-urlencoded', 'POST', '/api/search', '10.0.0.5'), {});
  const html = await r.text();
  assert.ok(!html.includes('<img'));
  const q2 = String.fromCodePoint(0x628, 0x628) + ' "\'&<>';
  const r2 = await w.fetch(req(new URLSearchParams({ q: q2, lang: 'ar' }).toString(), 'application/x-www-form-urlencoded', 'POST', '/api/search', '10.0.0.6'), {});
  const h2 = await r2.text();
  assert.ok(h2.includes('&quot;&#39;&amp;&lt;&gt;'));
});

test('RQ-002 AC10: Worker and search code contain no logging or storage calls', () => {
  const files = ['src/worker/app.ts', 'src/worker/page.ts', 'src/core/api.ts', 'src/core/search-core.ts', 'src/core/query.ts'];
  for (const f of files) {
    const s = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/console\.|caches\.|\.put\(|KV|D1|waitUntil/.test(s), f);
  }
  const islands = readdirSync('src/site/islands');
  const search = readFileSync('src/site/islands/Search.tsx', 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/localStorage|indexedDB|console\./.test(search), 'search island never stores the query');
  assert.ok(islands.length > 0);
});
