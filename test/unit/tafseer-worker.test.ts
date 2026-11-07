// RQ-005 in the Worker, against the mock Quran Foundation API (test/mock/qf-mock.ts) and a fake
// Cache API with a controlled clock. Synthetic Quran data only. No real API call is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { MAX_AGE_MS, type CacheLike } from '../../src/worker/tafseer.ts';
import { qfConfig, QF_URLS, REFRESH_MARGIN_MS } from '../../src/worker/qf.ts';
import { sha256Hex } from '../../src/core/tafseer-fingerprints.ts';
import { CASE, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID, passageText } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';

const { ab, src } = synthetic('tafseer');
const BASE = 'http://127.0.0.1:9999';
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), QF_TEST_BASE: BASE };

class FakeCache implements CacheLike {
  m = new Map<string, { body: string; headers: Headers }>();
  async match(k: string) { const e = this.m.get(k); return e ? new Response(e.body, { headers: e.headers }) : undefined; }
  async put(k: string, r: Response) { this.m.set(k, { body: await r.text(), headers: r.headers }); }
}

async function setup(extra: { fingerprints?: { ref: string; tafsirId: number; sha256: string; reviewed: string }[]; gate?: boolean; timeoutMs?: number; dev?: boolean } = {}) {
  let clock = Date.parse('2026-11-08T00:00:00Z');
  const now = () => clock;
  const mock = createMockQf({ quran: src, now, slowMs: 200 });
  const cache = new FakeCache();
  const fetchFn = (u: string, i: RequestInit) => { assert.ok(u.startsWith(BASE), 'only the configured API base is called'); return mock.fetch(u, i); };
  const w = makeWorker(ab, {
    dev: extra.dev ?? true, gate: extra.gate ?? false, tafseer: true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' },
    counts: [0, ...SYN_COUNTS.slice(1)], fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: extra.fingerprints ?? [] }, tafseerLimit: 1000,
  }, { fetch: fetchFn, now, cache: () => cache, timeoutMs: extra.timeoutMs ?? 2000 });
  return { w, mock, cache, tick: (ms: number) => { clock += ms; } };
}

const ask = (w: ReturnType<typeof makeWorker>, s: number, a: number, env: Record<string, string> = ENV, h: Record<string, string> = {}) =>
  w.fetch(new Request('http://127.0.0.1/api/tafseer', { method: 'POST', body: JSON.stringify({ s, a }), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.1.2.3', ...h } }), env as never);

test('AC2, AC4, AC7, AC8: the passage is returned byte for byte, with source details and no secret', async () => {
  const { w } = await setup();
  const r = await ask(w, 2, 20, ENV, { cookie: 'reader=1', 'user-agent': 'Reader UA', 'x-forwarded-for': '10.9.9.9' });
  assert.equal(r.status, 200);
  const raw = await r.text();
  const d = JSON.parse(raw);
  assert.equal(d.status, 'ok');
  assert.ok(Buffer.from(d.text, 'utf8').equals(Buffer.from(passageText(MOCK_TAFSIR_ID, 2, 20)!, 'utf8')), 'AC4: byte-equal');
  assert.deepEqual(d.range, { s: 2, from: 20, to: 20 });
  assert.equal(d.source.provider, 'Quran Foundation');
  assert.equal(d.source.title, 'Mock Arabic Tafsir A');
  assert.equal(d.source.author, 'Mock Author A');
  assert.equal(d.source.edition, null, 'AC7: not supplied by the API, so not stated');
  assert.equal(d.source.publisher, null);
  assert.equal(d.source.language, 'arabic');
  // AC13: no credential or token in the body or headers.
  const all = raw + JSON.stringify([...r.headers]);
  for (const secret of [MOCK_CLIENT_SECRET, MOCK_CLIENT_ID, 'mock-token-']) assert.ok(!all.includes(secret), secret);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.ok(r.headers.get('strict-transport-security'));
  assert.equal(r.headers.get('set-cookie'), null);
});

test('AC16, AC22: one token for many calls, scope content.tafsirs.read only, no reader header forwarded', async () => {
  const { w, mock } = await setup();
  for (const a of [21, 22, 23]) assert.equal((await ask(w, 2, a, ENV, { cookie: 'c=1', 'user-agent': 'UA', referer: 'http://x' })).status, 200);
  assert.equal(mock.state.tokenRequests, 1);
  assert.deepEqual(mock.state.tokenBodies, ['grant_type=client_credentials&scope=content.tafsirs.read']);
  for (const names of mock.state.contentHeaderNames) assert.deepEqual(names, ['accept', 'x-auth-token', 'x-client-id']);
  assert.ok(mock.state.paths.every((p) => !/10\.1\.2\.3|ip=|user/i.test(p)));
});

test('token: refreshed shortly before expiry, and a 401 clears it and retries once', async () => {
  const { w, mock, tick } = await setup();
  await ask(w, 1, 1);
  tick(3600_000 - REFRESH_MARGIN_MS - 1000);
  await ask(w, 1, 2);
  assert.equal(mock.state.tokenRequests, 1, 'still valid');
  tick(2000);
  await ask(w, 1, 3);
  assert.equal(mock.state.tokenRequests, 2, 'refreshed before expiry');
  mock.tokens.clear(); // the API stops accepting the token
  const r = await ask(w, 1, 4);
  assert.equal(r.status, 200);
  assert.equal(mock.state.tokenRequests, 3, 'one new token after the 401');
});

test('AC11: a copy is used for under 7 days from the fetch, and never at 7 days or later', async () => {
  const { w, mock, cache, tick } = await setup();
  await ask(w, 2, 25);
  const n0 = mock.state.contentRequests;
  const keys = [...cache.m.keys()];
  assert.ok(keys.every((k) => /\/__rifq-cache\/tafseer\/v1\/prelive\/(901\/2%3A25|list)$/.test(k)), 'AC22: keyed by environment, work and ayah only');
  for (const e of cache.m.values()) assert.equal(e.headers.get('cache-control'), 'max-age=604800');
  tick(MAX_AGE_MS - 1);
  await ask(w, 2, 25);
  assert.equal(mock.state.contentRequests, n0, 'served from the copy');
  tick(1);
  await ask(w, 2, 25);
  assert.ok(mock.state.contentRequests > n0, 'refetched at exactly 7 days');
});

test('AC10, AC11: with the API down, a copy under 7 days is served; an older one is not', async () => {
  const { w, mock, tick } = await setup();
  await ask(w, 2, 26);
  mock.state.mode = 'down';
  assert.equal((await ask(w, 2, 26)).status, 200);
  tick(MAX_AGE_MS);
  const r = await ask(w, 2, 26);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { status: 'unavailable' });
});

test('AC9, AC10: no passage, pre-live gaps, server errors, rate limits and timeouts', async () => {
  const { w } = await setup({ timeoutMs: 50 });
  assert.deepEqual(await (await ask(w, 2, CASE.none)).json(), { status: 'none', s: 2, a: CASE.none });
  assert.equal((await ask(w, 3, 1)).status, 404, 'surah outside pre-live data: no Tafseer');
  for (const a of [CASE.error500, CASE.rate429, CASE.slow]) {
    const r = await ask(w, 2, a);
    assert.equal(r.status, 503, String(a));
    assert.deepEqual(await r.json(), { status: 'unavailable' });
  }
});

test('AC3: a passage covering several ayat reports its range', async () => {
  const { w } = await setup();
  for (const a of CASE.grouped) {
    const d = await (await ask(w, 2, a)).json();
    assert.deepEqual(d.range, { s: 2, from: CASE.grouped[0], to: CASE.grouped[2] });
  }
});

test('D-079: a matching fingerprint is reported, a changed passage is replaced by a notice', async () => {
  const good = await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.reviewed)!);
  const old = await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.changed, undefined, 1)!);
  const { w } = await setup({ fingerprints: [
    { ref: `2:${CASE.reviewed}`, tafsirId: MOCK_TAFSIR_ID, sha256: good, reviewed: '2026-11-01' },
    { ref: `2:${CASE.changed}`, tafsirId: MOCK_TAFSIR_ID, sha256: old, reviewed: '2026-11-02' },
    { ref: '2:30', tafsirId: 999, sha256: old, reviewed: '2026-11-02' },
  ] });
  const m = await (await ask(w, 2, CASE.reviewed)).json();
  assert.deepEqual(m.review, { state: 'match', reviewed: '2026-11-01' });
  const c = await ask(w, 2, CASE.changed);
  const cd = await c.json();
  assert.equal(cd.status, 'changed');
  assert.equal(cd.reviewed, '2026-11-02');
  assert.equal(cd.text, undefined, 'no passage text in a changed answer');
  const o = await (await ask(w, 2, 30)).json();
  assert.deepEqual(o.review, { state: 'none' }, 'a fingerprint for another work does not apply');
  // Cached copies are checked too.
  const again = await (await ask(w, 2, CASE.changed)).json();
  assert.equal(again.status, 'changed');
});

test('D-076, D-077: no work set, missing secrets, or a non-Arabic work: nothing is shown', async () => {
  const { w, mock } = await setup();
  const { TAFSIR_ID: _t, ...noId } = ENV;
  const r = await ask(w, 1, 1, noId);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { status: 'not_configured', missing: ['TAFSIR_ID'] });
  const { QF_CLIENT_SECRET: _s, ...noSecret } = ENV;
  assert.deepEqual((await (await ask(w, 1, 1, noSecret)).json()).missing, ['QF_CLIENT_SECRET']);
  assert.deepEqual((await (await ask(w, 1, 1, { ...ENV, QF_ENV: 'staging' })).json()).missing, ['QF_ENV']);
  const en = await (await ask(w, 1, 1, { ...ENV, TAFSIR_ID: '903' })).json();
  assert.equal(en.status, 'not_configured');
  assert.equal(mock.state.tokenRequests >= 1, true);
  const rel = await setup({ dev: false });
  assert.deepEqual(await (await ask(rel.w, 1, 1, noId)).json(), { status: 'not_configured', missing: [] }, 'release builds name no setting');
});

test('route rules: POST JSON only, same site only, valid references only, rate limited', async () => {
  const { w } = await setup();
  const base = (init: RequestInit) => w.fetch(new Request('http://127.0.0.1/api/tafseer', init), ENV as never);
  assert.equal((await base({ method: 'GET' })).status, 405);
  assert.equal((await base({ method: 'POST', body: '{"s":1,"a":1}', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await base({ method: 'POST', body: '{"s":1,"a":1}', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } })).status, 403);
  for (const b of ['x', '{"s":0,"a":1}', '{"s":1,"a":8}', '{"s":8,"a":1}', '{"s":"1","a":1}', '{"s":1.5,"a":1}']) {
    assert.equal((await base({ method: 'POST', body: b, headers: { 'content-type': 'application/json' } })).status, 400, b);
  }
  assert.equal((await base({ method: 'POST', body: 'x'.repeat(300), headers: { 'content-type': 'application/json' } })).status, 413);
  const limited = makeWorker(ab, { dev: true, tafseer: true, record: { name: 'S', edition: 'e', status: 's' }, counts: [0, ...SYN_COUNTS.slice(1)], tafseerLimit: 2 }, { fetch: createMockQf().fetch, cache: () => null });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await limited.fetch(new Request('http://127.0.0.1/api/tafseer', { method: 'POST', body: '{"s":1,"a":1}', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.3.3.3' } }), {} as never)).status);
  assert.deepEqual(codes, [503, 503, 429]);
  const off = makeWorker(ab, { dev: true, record: { name: 'S', edition: 'e', status: 's' } });
  assert.equal((await off.fetch(new Request('http://127.0.0.1/api/tafseer', { method: 'POST', body: '{"s":1,"a":1}', headers: { 'content-type': 'application/json' } }), {})).status, 404, 'no route without the build flag');
});

test('catalogue: development builds behind the gate only; Arabic works listed; names escaped', async () => {
  const gateEnv = { ...ENV, SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
  const auth = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
  const { w } = await setup({ gate: true });
  const no = await w.fetch(new Request('http://127.0.0.1/dev/tafseer-catalogue/'), gateEnv as never);
  assert.equal(no.status, 401, 'password gate applies');
  const r = await w.fetch(new Request('http://127.0.0.1/dev/tafseer-catalogue/', { headers: auth }), gateEnv as never);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const h = await r.text();
  assert.ok(h.includes('DEVELOPMENT PAGE'));
  assert.ok(h.includes('<td>901</td><td>Mock Arabic Tafsir A</td><td>Mock Author A</td><td>arabic</td>'));
  assert.ok(h.includes('Arabic (D-077): 3'));
  // D-076: Arabic entries that look like Ibn Kathir are marked; the English one is only counted.
  assert.equal((h.match(/data-ibn-kathir>/g) ?? []).length, 1);
  assert.ok(h.includes('<tr class="match" data-ibn-kathir><td>904</td>'));
  assert.ok(h.includes('data-ibn-kathir-count>1<') && h.includes('not usable under D-077: 1 (IDs 905)'));
  assert.ok(h.includes('TAFSIR_ID is not set') || h.includes('TAFSIR_ID setting'));
  assert.ok(!h.includes('<script'), 'API names are escaped');
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(!h.includes(MOCK_CLIENT_SECRET) && !h.includes('mock-token-'));
  const { w: open } = await setup({ gate: false });
  const r2 = await open.fetch(new Request('http://127.0.0.1/dev/tafseer-catalogue/'), ENV as never);
  assert.equal(r2.status, 404, 'no catalogue without the gate');
  const { w: rel } = await setup({ gate: true, dev: false });
  assert.equal((await rel.fetch(new Request('http://127.0.0.1/dev/tafseer-catalogue/', { headers: auth }), gateEnv as never)).status, 404, 'no catalogue in release builds');
});

test('settings: production and pre-live addresses, and the local mock only in development for 127.0.0.1', () => {
  const p = qfConfig({ QF_CLIENT_ID: 'a', QF_CLIENT_SECRET: 'b', QF_ENV: 'production' }, false) as { tokenUrl: string; apiBase: string };
  assert.equal(p.tokenUrl, 'https://oauth2.quran.foundation/oauth2/token');
  assert.equal(p.apiBase, 'https://apis.quran.foundation');
  assert.deepEqual(QF_URLS.prelive, { token: 'https://prelive-oauth2.quran.foundation/oauth2/token', api: 'https://apis-prelive.quran.foundation' });
  const e = { QF_CLIENT_ID: 'a', QF_CLIENT_SECRET: 'b', QF_ENV: 'prelive', QF_TEST_BASE: 'http://127.0.0.1:8815' };
  assert.equal((qfConfig(e, true) as { apiBase: string }).apiBase, 'http://127.0.0.1:8815');
  assert.equal((qfConfig(e, false) as { apiBase: string }).apiBase, 'https://apis-prelive.quran.foundation');
  assert.equal((qfConfig({ ...e, QF_TEST_BASE: 'http://evil.example:80' }, true) as { apiBase: string }).apiBase, 'https://apis-prelive.quran.foundation');
});

test('AC13, AC22: Tafseer Worker code has no logging, and only tafseer.ts uses the Cache API', () => {
  for (const f of ['src/worker/qf.ts', 'src/worker/tafseer.ts', 'src/core/tafseer-html.ts', 'src/core/tafseer-fingerprints.ts', 'src/site/islands/TafseerView.tsx']) {
    const s = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/console\.|waitUntil|KV|D1|localStorage|sessionStorage|indexedDB/.test(s), f);
    if (f !== 'src/worker/tafseer.ts') assert.ok(!/caches|\.put\(/.test(s), f);
    assert.ok(!/innerHTML|dangerouslySetInnerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(s), f + ': never parses markup into the page');
  }
});
