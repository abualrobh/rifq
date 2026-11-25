// Kit v41, unit level.
//   D-254: the recitation credit names the reciter and Quran Foundation (Quran Foundation Developer
//   Terms 2026-11-20: "Credit Quran Foundation and the reciter"); audioCredit stays for the moment
//   before the reciter's name is known.
//   D-253 C: the licence line names the Quran Foundation Developer Terms without a date.
//   D-259, QA v40 FIND-CL: every Quran Foundation cache entry (Tafseer passage and marks, Tafseer list,
//   reciter list, surah file check with the timings and file address) counts its 7 days (or 10
//   minutes) from the moment the API's answer arrived, not from the write that follows parsing and
//   marks, and a read never extends it.
// The Arabic wording is compared with the B-09 proposal by a private check outside the repository
// (no Arabic characters in test files). Synthetic data and the mock Quran Foundation API only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STRINGS, t } from '../../src/core/strings.ts';
import { creditNode } from '../../src/site/client/credit.ts';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { MAX_AGE_MS, secondsLeft, type CacheLike } from '../../src/worker/tafseer.ts';
import { FAIL_AGE_MS } from '../../src/worker/audio.ts';
import { createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_RECITER_NAMES, MOCK_TAFSIR_ID } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';

// ---- D-254, D-253: strings and the credit ----

test('D-254: audioCreditBy names the reciter ({name}) and Quran Foundation in both tables; English as proposed', () => {
  assert.equal(STRINGS.en.audioCreditBy, 'Recitation by {name}, provided by Quran Foundation.');
  for (const l of ['ar', 'en'] as const) {
    const s = STRINGS[l].audioCreditBy;
    assert.equal(s.split('{name}').length, 2, `${l}: exactly one {name}`);
    assert.ok(s.includes('Quran Foundation'), `${l}: names Quran Foundation`);
    assert.ok(!/\{(?!name\})/.test(s), `${l}: no other placeholder`);
  }
  // The approved credit without a name is unchanged (shown until the reciter list has loaded).
  assert.equal(STRINGS.en.audioCredit, 'Recitation provided by Quran Foundation.');
});

test('D-253 C: the licence line names the Quran Foundation Developer Terms without a date; no visible string cites 2026-10-11', () => {
  assert.equal(STRINGS.en.audioLicence, 'Quran Foundation Developer Terms');
  for (const l of ['ar', 'en'] as const) {
    assert.ok(STRINGS[l].audioLicence.includes('Quran Foundation'), l);
    assert.ok(!/\d{4}-\d{2}-\d{2}|20\d\d/.test(STRINGS[l].audioLicence), `${l}: no date`);
    for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(!String(v).includes('2026-10-11'), `${l}.${k}`);
  }
});

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

test('D-254: the credit names the reciter as Quran Foundation gives it, isolated; Quran Foundation isolated in Arabic', () => {
  const en = renderToStaticMarkup(createElement(Fragment, null, creditNode('en', MOCK_RECITER_NAMES[7])));
  assert.equal(en, `Recitation by <bdi lang="en" data-credit-reciter="">${MOCK_RECITER_NAMES[7]}</bdi>, provided by Quran Foundation.`);
  const arName = String.fromCodePoint(0x645, 0x642, 0x631, 0x626) + ' 7'; // made-up Arabic name, as the mock's
  const ar = renderToStaticMarkup(createElement(Fragment, null, creditNode('ar', arName)));
  assert.equal(text(ar), STRINGS.ar.audioCreditBy.replace('{name}', arName), 'the words are the string, unchanged');
  assert.ok(ar.includes(`<bdi lang="ar" data-credit-reciter="">${arName}</bdi>`));
  assert.ok(ar.includes('<bdi dir="ltr" data-ltr-run="">Quran Foundation</bdi>'), 'Latin run isolated in the Arabic credit');
  // A Latin name in the Arabic interface (when Quran Foundation gives no Arabic name) is English.
  assert.ok(renderToStaticMarkup(createElement(Fragment, null, creditNode('ar', 'MOCK Afasy'))).includes('<bdi lang="en" data-credit-reciter="">MOCK Afasy</bdi>'));
  // The name is text, never markup.
  assert.ok(renderToStaticMarkup(createElement(Fragment, null, creditNode('en', MOCK_RECITER_NAMES[1]))).includes('MOCK Reciter 1 &lt;b&gt;x&lt;/b&gt;'));
  // Before the name is known: the earlier credit, Quran Foundation only.
  for (const l of ['ar', 'en'] as const) {
    for (const n of [null, undefined, '']) assert.equal(text(renderToStaticMarkup(createElement(Fragment, null, creditNode(l, n)))), t(l, 'audioCredit'));
  }
});

// ---- D-259: cache lifetime counted from the fetch ----

test('D-259: secondsLeft counts from the fetch and rounds down', () => {
  assert.equal(secondsLeft(1000, MAX_AGE_MS, 1000), 604800);
  assert.equal(secondsLeft(1000, MAX_AGE_MS, 1001), 604799);
  assert.equal(secondsLeft(1000, MAX_AGE_MS, 5500), 604795);
  assert.equal(secondsLeft(0, FAIL_AGE_MS, 0), 600);
  assert.equal(secondsLeft(0, FAIL_AGE_MS, FAIL_AGE_MS), 0);
  assert.ok(secondsLeft(0, FAIL_AGE_MS, FAIL_AGE_MS + 1) < 0);
});

class CountingCache implements CacheLike {
  m = new Map<string, { body: string; headers: Headers }>();
  puts = 0;
  async match(k: string) { const e = this.m.get(k); return e ? new Response(e.body, { headers: e.headers }) : undefined; }
  async put(k: string, r: Response) { this.puts++; this.m.set(k, { body: await r.text(), headers: r.headers }); }
}

// The clock moves only when the test says so, and by `lag` while an API answer's body is read and
// processed (after it has arrived). `arrived` records the clock when each answer arrived, per path.
function clocked(lag: number) {
  let lagNow = lag;
  let clock = Date.parse('2026-11-26T00:00:00Z');
  const now = () => clock;
  const arrived = new Map<string, number>();
  const wrap = (f: (u: string, i: RequestInit) => Promise<Response>) => async (u: string, i: RequestInit) => {
    const r = await f(u, i);
    const p = new URL(u);
    arrived.set(p.pathname + p.search, clock);
    const json = r.json.bind(r);
    Object.defineProperty(r, 'json', { value: async () => { clock += lagNow; return json(); } });
    return r;
  };
  return { now, arrived, wrap, tick: (ms: number) => { clock += ms; }, get: () => clock, setLag: (ms: number) => { lagNow = ms; } };
}

type Entry = { fetchedAt: number; maxAge?: number };
const entry = (c: CountingCache, re: RegExp) => {
  const k = [...c.m.keys()].find((x) => re.test(x));
  assert.ok(k, `cache key ${re}`);
  const e = c.m.get(k!)!;
  return { key: k!, body: JSON.parse(e.body) as Entry, maxAge: Number(/max-age=(\d+)/.exec(e.headers.get('cache-control') ?? '')?.[1]) };
};
const arrivedAt = (a: Map<string, number>, re: RegExp) => {
  const k = [...a.keys()].find((x) => re.test(x));
  assert.ok(k, `arrived ${re}`);
  return a.get(k!)!;
};

const tf = synthetic('tafseer');
const TBASE = 'http://127.0.0.1:9996';
const TENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), QF_TEST_BASE: TBASE };

function tafseerSetup(lag: number) {
  const c = clocked(lag);
  const mock = createMockQf({ quran: tf.src, now: c.now, slowMs: 200 });
  const cache = new CountingCache();
  const w = makeWorker(tf.ab, { testMemoryLimits: true, dev: true, gate: false, tafseer: true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' },
    counts: [0, ...SYN_COUNTS.slice(1)], fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [] }, tafseerLimit: 1000,
  }, { fetch: c.wrap(mock.fetch), now: c.now, cache: () => cache, timeoutMs: 2000 });
  const ask = (s: number, a: number) => w.fetch(new Request('http://127.0.0.1/api/tafseer', { method: 'POST', body: JSON.stringify({ s, a }), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.4.4.4' } }), TENV as never);
  return { ...c, mock, cache, ask };
}

test('D-259 Tafseer: passage (with its marks) and list keep the time the answer arrived, not the write time', async () => {
  const lag = 4500; // parsing and marks after the answer arrived (made-up, much longer than real)
  const x = tafseerSetup(lag);
  assert.equal((await x.ask(2, 25)).status, 200);
  for (const [k, p] of [[/\/2%3A25\//, /\/tafsirs\/\d+\/by_ayah\/2:25/], [/\/list$/, /\/resources\/tafsirs/]] as const) {
    const e = entry(x.cache, k);
    const at = arrivedAt(x.arrived, p);
    assert.equal(e.body.fetchedAt, at, `${k}: fetchedAt is the arrival time`);
    assert.ok(x.get() - at >= lag, 'the write came later than the arrival');
    // Cache API max-age: what is left of 7 days from the arrival at the write, rounded down.
    // The write came at least `lag` after the arrival, so at most 604,800 - 4.5 s, rounded down.
    assert.ok(e.maxAge <= Math.floor((MAX_AGE_MS - lag) / 1000), `${k}: max-age ${e.maxAge}`);
    assert.ok(at + e.maxAge * 1000 <= at + MAX_AGE_MS, 'the Cache API never keeps it past the fetch plus 7 days');
  }
});

test('D-259 Tafseer: used until 7 days after the arrival, refetched at 7 days; a read never rewrites or extends the entry', async () => {
  const x = tafseerSetup(3000);
  await x.ask(2, 26);
  const at = arrivedAt(x.arrived, /by_ayah\/2:26/);
  const before = entry(x.cache, /\/2%3A26\//);
  const puts = x.cache.puts;
  const n0 = x.mock.state.contentRequests;
  x.tick(at + 6 * 24 * 3600_000 - x.get()); // day 6 after the arrival
  await x.ask(2, 26);
  assert.equal(x.mock.state.contentRequests, n0, 'served from the copy');
  assert.equal(x.cache.puts, puts, 'a read writes nothing');
  assert.deepEqual(entry(x.cache, /\/2%3A26\//), before, 'entry unchanged by the read');
  x.tick(at + MAX_AGE_MS - 1 - x.get());
  await x.ask(2, 26);
  assert.equal(x.mock.state.contentRequests, n0, 'still the copy 1 ms before 7 days after the arrival');
  x.tick(1); // exactly 7 days after the arrival (the old code counted from the write, 3 s later)
  await x.ask(2, 26);
  assert.ok(x.mock.state.contentRequests > n0, 'refetched at 7 days after the arrival');
});

test('D-259 Tafseer: a "no Tafseer" answer (404) is also counted from its arrival', async () => {
  const x = tafseerSetup(2000);
  await x.ask(2, 7); // CASE.none in the mock
  const e = entry(x.cache, /\/2%3A7\//);
  assert.equal(e.body.fetchedAt, arrivedAt(x.arrived, /by_ayah\/2:7/));
});

const au = synthetic('audio');
const ABASE = 'http://127.0.0.1:9995';
const AENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', QF_TEST_BASE: ABASE };
const counts = [0, ...SYN_COUNTS.slice(1)];

function audioSetup(lag: number, o: { emptyCatalogue?: () => boolean; override?: (id: number, s: number, f: Record<string, unknown>) => Record<string, unknown> } = {}) {
  const c = clocked(lag);
  const mock = createMockQf({ quran: au.src, counts, now: c.now, emptyCatalogue: o.emptyCatalogue, audioOverride: o.override });
  const cache = new CountingCache();
  const w = makeWorker(au.ab, { testMemoryLimits: true, dev: true, audio: true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' }, counts, audioLimit: 1000, audioRecord: null },
    { fetch: c.wrap(mock.fetch), now: c.now, cache: () => cache, timeoutMs: 2000 });
  const call = (path: string, body: unknown) => w.fetch(new Request('http://127.0.0.1' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.5.5.5' } }), AENV as never);
  return { ...c, mock, cache, call };
}

test('D-259 audio: reciter list and surah file check (timings and file address) keep the arrival time; 7 days from it', async () => {
  const lag = 2500;
  const x = audioSetup(lag);
  assert.equal((await x.call('/api/audio', { r: 7, s: 1 })).status, 200);
  const cat = entry(x.cache, /\/catalogue\/en$/);
  assert.equal(cat.body.fetchedAt, arrivedAt(x.arrived, /chapter_reciters\?language=en/));
  const file = entry(x.cache, /\/prelive\/7\/1$/);
  const at = arrivedAt(x.arrived, /chapter_recitations\/7\/1\?/);
  assert.equal(file.body.fetchedAt, at);
  for (const e of [cat, file]) assert.ok(e.maxAge < 604800 && e.body.fetchedAt + e.maxAge * 1000 <= e.body.fetchedAt + MAX_AGE_MS);
  // Entries that arrived earlier (the catalogue, other surah checks) expire earlier and are asked
  // again; this one is followed by its own path. From here processing takes no time, so the clock
  // is exactly where the test puts it when this entry is read.
  x.setLag(0);
  const asks = () => x.mock.state.paths.filter((p) => /\/chapter_recitations\/7\/1\?/.test(p)).length;
  const n = asks();
  x.tick(at + MAX_AGE_MS - 1 - x.get());
  assert.equal((await x.call('/api/audio', { r: 7, s: 1 })).status, 200);
  assert.equal(asks(), n, 'the file check is still the copy 1 ms before 7 days after its arrival');
  assert.deepEqual(entry(x.cache, /\/prelive\/7\/1$/), file, 'a read does not rewrite the file check');
  x.tick(1);
  await x.call('/api/audio', { r: 7, s: 1 });
  assert.equal(asks(), n + 1, 'refetched at 7 days after the arrival');
});

test('D-259 audio: the 10-minute negative cache (empty reciter list, failed check) also counts from the arrival', async () => {
  const lag = 1500;
  let empty = true;
  const x = audioSetup(lag, { emptyCatalogue: () => empty });
  await x.call('/api/audio/reciters', { lang: 'en' });
  const cat = entry(x.cache, /\/catalogue\/en$/);
  const at = arrivedAt(x.arrived, /chapter_reciters\?language=en/);
  assert.equal(cat.body.fetchedAt, at);
  assert.equal(cat.body.maxAge, FAIL_AGE_MS);
  assert.equal(cat.maxAge, Math.floor((FAIL_AGE_MS - lag) / 1000), 'max-age is what is left of 10 minutes at the write');
  empty = false;
  x.tick(at + FAIL_AGE_MS - 1 - x.get());
  assert.deepEqual((await (await x.call('/api/audio/reciters', { lang: 'en' })).json()).reciters, [], 'copy used 1 ms before 10 minutes after the arrival');
  x.tick(1);
  assert.deepEqual((await (await x.call('/api/audio/reciters', { lang: 'en' })).json()).reciters.map((r: { id: number }) => r.id), [7, 97]);

  // A failed surah check: 10 minutes from its arrival.
  let bad = true;
  const y = audioSetup(lag, { override: (id, s, f) => (bad && id === 7 && s === 1 ? { ...f, duration: 1000 } : f) });
  await y.call('/api/audio/reciters', { lang: 'en' });
  const chk = entry(y.cache, /\/prelive\/7\/1$/);
  assert.equal(chk.body.fetchedAt, arrivedAt(y.arrived, /chapter_recitations\/7\/1\?/));
  assert.equal(chk.body.maxAge, FAIL_AGE_MS);
  assert.ok(chk.maxAge <= Math.floor(FAIL_AGE_MS / 1000) - 1);
  bad = false;
});

test('D-259 audio: an answer whose processing outlasted its whole lifetime is not kept at all', async () => {
  // Made-up extreme: 11 minutes between the arrival of an empty list and its write.
  const x = audioSetup(11 * 60_000, { emptyCatalogue: () => true });
  await x.call('/api/audio/reciters', { lang: 'en' });
  assert.ok(![...x.cache.m.keys()].some((k) => /\/catalogue\/en$/.test(k)), 'an entry already past 10 minutes is never written');
});
