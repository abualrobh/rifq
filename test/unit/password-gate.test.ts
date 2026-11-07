// Password gate for the private test site: HTTP Basic auth on every request when the build flag
// is on. Covers no secret set, wrong password, right password, assets and the search API.
// Credentials here are made up for the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker, type Env } from '../../src/worker/app.ts';
import { parseBasic, sameSecret } from '../../src/worker/gate.ts';
import { gateFlag, localWranglerConfig } from '../../scripts/build.ts';
import { assetHeaderMap } from '../../scripts/headers.ts';

const { syn, ab } = synthetic('pwgate');
const CSP = "default-src 'none'; script-src 'self' 'sha256-test'";
const record = { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' };
const gated = { dev: true, record, gate: true, assetHeaders: assetHeaderMap(CSP) };
const USER = 'tester';
const PASS = 'made-up pässword:with colon';
const REALM = 'Basic realm="RIFQ private test", charset="UTF-8"';

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const basic = (u: string, p: string) => 'Basic ' + b64(`${u}:${p}`);

function assets() {
  const seen: string[] = [];
  return {
    seen,
    ASSETS: {
      async fetch(r: Request) {
        seen.push(new URL(r.url).pathname);
        return new Response('<!doctype html><title>page</title>', { status: 200, headers: { 'content-type': 'text/html', etag: '"x"' } });
      },
    },
  };
}

const page = (auth?: string, path = '/') => new Request('http://127.0.0.1' + path, { headers: auth ? { authorization: auth } : {} });
const search = (auth?: string, ip = '10.1.0.1') => new Request('http://127.0.0.1/api/search', {
  method: 'POST', body: JSON.stringify({ q: syn.common }),
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(auth ? { authorization: auth } : {}) },
});

async function assertDenied(r: Response) {
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), REALM);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  for (const h of ['x-content-type-options', 'referrer-policy', 'strict-transport-security', 'x-frame-options', 'content-security-policy', 'x-robots-tag']) assert.ok(r.headers.get(h), h);
  assert.match(r.headers.get('x-robots-tag')!, /noindex/);
  assert.equal(r.headers.get('set-cookie'), null);
  const body = await r.text();
  assert.ok(body.length > 0 && body.length < 100, 'short body');
  assert.ok(!body.includes(PASS) && !body.includes(USER));
  assert.ok(![...r.headers.values()].some((v) => v.includes(PASS)), 'password never echoed');
}

test('no secret set: every request is refused, even with credentials', async () => {
  const w = makeWorker(ab, gated);
  const envs: Env[] = [{}, { SITE_USER: '', SITE_PASSWORD: '' }, { SITE_USER: USER }, { SITE_PASSWORD: PASS }, { SITE_USER: USER, SITE_PASSWORD: '' }, { SITE_USER: '', SITE_PASSWORD: PASS }];
  for (const e of envs) {
    const a = assets();
    const env = { ...e, ...a };
    for (const auth of [undefined, basic(USER, PASS), basic('', ''), basic(USER, ''), basic('', PASS)]) {
      await assertDenied(await w.fetch(page(auth), env));
      await assertDenied(await w.fetch(page(auth, '/_astro/app.js'), env));
      await assertDenied(await w.fetch(search(auth), env));
    }
    assert.deepEqual(a.seen, [], 'no asset is fetched before auth');
  }
});

test('wrong password, wrong user and malformed headers are refused', async () => {
  const w = makeWorker(ab, gated);
  const a = assets();
  const env = { SITE_USER: USER, SITE_PASSWORD: PASS, ...a };
  const bad = [
    undefined, basic(USER, 'wrong'), basic(USER, PASS + ' '), basic(USER, PASS.slice(0, -1)), basic('other', PASS), basic(USER.toUpperCase(), PASS),
    'Basic', 'Basic !!!', 'Bearer ' + b64(`${USER}:${PASS}`), 'Basic ' + b64(USER + PASS), `Basic ${USER}:${PASS}`, basic(USER, PASS) + ' extra',
  ];
  for (const auth of bad) {
    await assertDenied(await w.fetch(page(auth), env));
    await assertDenied(await w.fetch(search(auth), env));
  }
  assert.deepEqual(a.seen, []);
});

test('right password: pages and assets are served with private no-store and the security headers', async () => {
  const w = makeWorker(ab, gated);
  const a = assets();
  const env = { SITE_USER: USER, SITE_PASSWORD: PASS, ...a };
  for (const path of ['/', '/en/', '/2/', '/_astro/app.js', '/rifq-basic.css', '/manifest.webmanifest', '/icon.svg']) {
    const r = await w.fetch(page(basic(USER, PASS), path), env);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.headers.get('content-security-policy'), CSP);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(r.headers.get('www-authenticate'), null);
    assert.equal(r.headers.get('etag'), '"x"', 'asset headers are kept');
  }
  assert.equal(a.seen.length, 7);
  // The scheme name is case-insensitive.
  const r = await w.fetch(page('basic ' + b64(`${USER}:${PASS}`)), env);
  assert.equal(r.status, 200);
});

test('right password: the search API answers with private no-store', async () => {
  const w = makeWorker(ab, gated);
  const env = { SITE_USER: USER, SITE_PASSWORD: PASS, ...assets() };
  const r = await w.fetch(search(basic(USER, PASS)), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.match(r.headers.get('content-security-policy')!, /default-src 'none'/);
  const d = await r.json();
  assert.ok(d.total > 50 && d.results.length === 50);
  const f = await w.fetch(new Request('http://127.0.0.1/api/search', {
    method: 'POST', body: new URLSearchParams({ q: syn.common, lang: 'en' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '10.1.0.2', authorization: basic(USER, PASS) },
  }), env);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('cache-control'), 'private, no-store');
  const g = await w.fetch(new Request('http://127.0.0.1/api/search', { headers: { authorization: basic(USER, PASS) } }), env);
  assert.equal(g.status, 405);
});

test('gate off: behaviour is unchanged and assets pass straight through', async () => {
  const w = makeWorker(ab, { dev: true, record });
  const a = assets();
  const r = await w.fetch(page(), { ...a });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), null);
  const s = await w.fetch(search(undefined, '10.1.0.3'), {});
  assert.equal(s.status, 200);
  assert.equal(s.headers.get('cache-control'), 'no-store');
});

test('helpers: Basic parsing and constant-time comparison', async () => {
  assert.deepEqual(parseBasic(basic(USER, PASS)), { user: USER, pass: PASS });
  assert.deepEqual(parseBasic(basic('', '')), { user: '', pass: '' });
  assert.equal(parseBasic(null), null);
  assert.equal(parseBasic('Basic ' + b64('nocolon')), null);
  assert.equal(await sameSecret('abc', 'abc'), true);
  assert.equal(await sameSecret('abc', 'abd'), false);
  assert.equal(await sameSecret('abc', 'abcd'), false);
  assert.equal(await sameSecret('', ''), true);
  const src = readFileSync('src/worker/gate.ts', 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/console\.|caches\.|\.put\(|waitUntil/.test(src), 'gate never logs or stores');
  assert.ok(!/===\s*(user|pass)\b|(user|pass)\s*===/.test(src), 'no direct string comparison of secrets');
});

test('build flag: on for development, off for release unless asked; on means the Worker runs first', () => {
  assert.equal(gateFlag('development'), true);
  assert.equal(gateFlag('release'), false);
  assert.equal(gateFlag('release', 'on'), true);
  assert.equal(gateFlag('development', 'off'), false);
  assert.throws(() => gateFlag('development', 'yes'));
  assert.equal(localWranglerConfig('x', 120, true).assets.run_worker_first, true);
  assert.deepEqual(localWranglerConfig('x', 120, false).assets.run_worker_first, ['/api/*']);
});

test('the search island sends same-origin credentials, so the cached Basic auth reaches the gate', () => {
  const s = readFileSync('src/site/islands/Search.tsx', 'utf8').replace(/\/\/.*$/gm, '');
  assert.match(s, /credentials:\s*'same-origin'/);
  assert.ok(!/credentials:\s*'omit'/.test(s));
  assert.match(s, /status === 401/);
});
