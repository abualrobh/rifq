// Worker behaviour on synthetic data: TP2-18 server backstop, TP2-24, TP2-32 server side, TP2-36,
// TP1-36 (no public route writes), and the no-logging rule (RQ-002 AC10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';

const { syn, ab } = synthetic('worker');
const cfg = { testMemoryLimits: true, dev: true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' }, serverLimit: 30 };
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

// D-071 low findings.
import { netKey, readCapped } from '../../src/worker/app.ts';

test('L-1: the body is read as a stream and cut off at the cap, whatever content-length says', async () => {
  let pulled = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  const body = new ReadableStream<Uint8Array>({ pull(ctl) { pulled++; if (pulled > 64) ctl.close(); else ctl.enqueue(chunk); } });
  const r = new Request('http://127.0.0.1/api/search', { method: 'POST', body, duplex: 'half' } as RequestInit);
  assert.equal(await readCapped(r, 8192), null);
  assert.ok(pulled <= 3, `stopped after ${pulled} chunks of 64`);
  const lie = new Request('http://127.0.0.1/api/search', { method: 'POST', body: 'x'.repeat(9000), headers: { 'content-length': '10' } });
  assert.equal(await readCapped(lie, 8192), null);
  const bad = new Request('http://127.0.0.1/api/search', { method: 'POST', body: '{}', headers: { 'content-length': 'abc' } });
  assert.equal(await readCapped(bad, 8192), 'bad_length');
  const w = makeWorker(ab, cfg);
  const res = await w.fetch(new Request('http://127.0.0.1/api/search', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '1e3' } }), {});
  assert.equal(res.status, 400);
});

test('L-3: the limit key is the full IPv4 address, or the /64 prefix of an IPv6 address', () => {
  const k = (ip?: string) => netKey(new Request('http://127.0.0.1/', { headers: ip ? { 'cf-connecting-ip': ip } : {} }));
  assert.equal(k('203.0.113.7'), '203.0.113.7');
  assert.equal(k('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(k('2001:db8:1:2::9'), '2001:db8:1:2::/64');
  assert.equal(k('2001:0DB8:0001:0002:0:0:0:1'), '2001:db8:1:2::/64');
  assert.equal(k('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(k('::ffff:198.51.100.4'), '198.51.100.4');
  assert.equal(k(), 'local');
});

test('L-3: two addresses in one IPv6 /64 share the search limit', async () => {
  const w = makeWorker(ab, cfg);
  for (let i = 0; i < 30; i++) assert.equal((await w.fetch(req(JSON.stringify({ q: syn.rare }), 'application/json', 'POST', '/api/search', `2001:db8:5:6::${i + 1}`), {})).status, 200);
  assert.equal((await w.fetch(req(JSON.stringify({ q: syn.rare }), 'application/json', 'POST', '/api/search', '2001:db8:5:6::ffff'), {})).status, 429);
  assert.equal((await w.fetch(req(JSON.stringify({ q: syn.rare }), 'application/json', 'POST', '/api/search', '2001:db8:5:7::1'), {})).status, 200);
});

test('L-4: JSON needs application/json, and cross-site requests are refused on both paths', async () => {
  const w = makeWorker(ab, cfg);
  const body = JSON.stringify({ q: syn.common });
  assert.equal((await w.fetch(req(body, 'text/plain', 'POST', '/api/search', '10.7.0.1'), {})).status, 415);
  assert.equal((await w.fetch(req(body, '', 'POST', '/api/search', '10.7.0.1'), {})).status, 415);
  assert.equal((await w.fetch(req(body, 'application/json; charset=utf-8', 'POST', '/api/search', '10.7.0.1'), {})).status, 200);
  const x = (h: Record<string, string>, type = 'application/json', b = body) => new Request('http://127.0.0.1/api/search', { method: 'POST', body: b, headers: { 'content-type': type, 'cf-connecting-ip': '10.7.0.2', ...h } });
  assert.equal((await w.fetch(x({ 'sec-fetch-site': 'cross-site' }), {})).status, 403);
  assert.equal((await w.fetch(x({ origin: 'https://evil.example' }), {})).status, 403);
  const form = new URLSearchParams({ q: syn.common, lang: 'ar' }).toString();
  assert.equal((await w.fetch(x({ origin: 'https://evil.example' }, 'application/x-www-form-urlencoded', form), {})).status, 403);
  assert.equal((await w.fetch(x({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1' }), {})).status, 200);
  assert.equal((await w.fetch(x({ 'sec-fetch-site': 'none' }), {})).status, 200);
  // The site's own form post under Referrer-Policy no-referrer carries "Origin: null".
  assert.equal((await w.fetch(x({ 'sec-fetch-site': 'same-origin', origin: 'null' }, 'application/x-www-form-urlencoded', form), {})).status, 200);
  assert.equal((await w.fetch(x({ 'sec-fetch-site': 'cross-site', origin: 'null' }, 'application/x-www-form-urlencoded', form), {})).status, 403);
});

test('H-1: results carry the English surah name, and the English server page shows it', async () => {
  const w = makeWorker(ab, cfg);
  const d = await (await w.fetch(req(JSON.stringify({ q: syn.common }), 'application/json', 'POST', '/api/search', '10.8.0.1'), {})).json();
  assert.ok(d.results.every((r: any) => r.en === `Synthetic ${r.s}`));
  const html = await (await w.fetch(req(new URLSearchParams({ q: syn.common, lang: 'en' }).toString(), 'application/x-www-form-urlencoded', 'POST', '/api/search', '10.8.0.2'), {})).text();
  const first = d.results[0];
  assert.ok(html.includes(`<bdi lang="en">Synthetic ${first.s}</bdi>, surah ${first.s}, ayah ${first.a}</a>`));
  const ar = await (await w.fetch(req(new URLSearchParams({ q: syn.common, lang: 'ar' }).toString(), 'application/x-www-form-urlencoded', 'POST', '/api/search', '10.8.0.3'), {})).text();
  assert.ok(ar.includes(`<bdi lang="ar">${first.name}</bdi>`));
  assert.ok(!ar.includes('<bdi lang="en">'), 'no English names on the Arabic page');
});
