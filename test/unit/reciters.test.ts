// /dev/reciters/ (RQ-006 preparation, D-110 to D-118) against the mock Quran Foundation API.
// Made-up reciter names and timings; synthetic Quran data; no real API call; no audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { AUDIO_SCOPE, checkAudioFile, CHOSEN_RECITERS } from '../../src/worker/reciters.ts';
import { AUDIO_CASE, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';

const { ab, src } = synthetic('reciters');
const BASE = 'http://127.0.0.1:9998';
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', TAFSIR_ID: String(MOCK_TAFSIR_ID), QF_TEST_BASE: BASE, SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
const AUTH = { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') };
const counts = [0, ...SYN_COUNTS.slice(1)];

function setup(o: { gate?: boolean; dev?: boolean; noAudioScope?: boolean } = {}) {
  const mock = createMockQf({ quran: src, counts, noAudioScope: o.noAudioScope });
  const w = makeWorker(ab, { testMemoryLimits: true, dev: o.dev ?? true, gate: o.gate ?? true, tafseer: true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' }, counts, fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [] }, tafseerLimit: 1000 },
    { fetch: (u, i) => { assert.ok(u.startsWith(BASE)); return mock.fetch(u, i); }, timeoutMs: 2000 });
  return { w, mock };
}
const open = (w: ReturnType<typeof makeWorker>, h: Record<string, string> = AUTH, env: Record<string, unknown> = ENV) => w.fetch(new Request('http://127.0.0.1/dev/reciters/', { headers: { 'cf-connecting-ip': '10.1.1.1', ...h } }), env as never);

test('reciters page: behind the gate, development builds only, GET only, no cross-site', async () => {
  const { w } = setup();
  assert.equal((await open(w, {})).status, 401);
  assert.equal((await setup({ gate: false }).w.fetch(new Request('http://127.0.0.1/dev/reciters/'), ENV as never)).status, 404);
  assert.equal((await open(setup({ dev: false }).w)).status, 404);
  assert.equal((await w.fetch(new Request('http://127.0.0.1/dev/reciters/', { method: 'POST', headers: AUTH }), ENV as never)).status, 405);
  assert.equal((await open(w, { ...AUTH, 'sec-fetch-site': 'cross-site' })).status, 403);
});

test('reciters page: lists, chosen IDs, audio host only, timing completeness and plain errors', async () => {
  const { w, mock } = setup();
  const r = await open(w);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.ok((r.headers.get('content-security-policy') ?? '').includes("default-src 'none'"));
  const h = await r.text();
  // Lists, with names escaped.
  assert.ok(h.includes('<td>7</td><td>507</td><td>MOCK Afasy</td><td>Murattal</td><td>Hafs</td><td>no</td>'));
  assert.ok(h.includes('MOCK Reciter 1 &lt;b&gt;x&lt;/b&gt;') && !h.includes('<b>x</b>'));
  assert.ok(h.includes('<td>2</td><td>MOCK Recitation Two</td><td>Mujawwad</td><td>MOCK Two</td>'));
  // The seven D-111 IDs in order; 161 is not in the mock list.
  assert.deepEqual([...h.matchAll(/data-chosen="(\d+)"/g)].map((m) => Number(m[1])), [...CHOSEN_RECITERS]);
  assert.match(h, /data-chosen="161">.*?data-missing>Not in this account's list/);
  const row = (id: number, s: number) => (h.match(new RegExp(`<tr data-audio="${id}:${s}"[^]*?</tr>`)) ?? [''])[0];
  const n1 = counts[1], n2 = counts[2];
  assert.ok(row(AUDIO_CASE.full, 2).includes(`data-timing="complete">Complete: ${n2} of ${n2}`));
  assert.ok(row(AUDIO_CASE.full, 1).includes('<td data-host>download.quranicaudio.com</td>'));
  assert.ok(row(AUDIO_CASE.full, 1).includes('mp3') && row(AUDIO_CASE.full, 1).includes(`${n1 * 80000} bytes`) && row(AUDIO_CASE.full, 1).includes(`${n1 * 5000} ms`));
  assert.ok(row(AUDIO_CASE.full, 1).includes(`Word segments on ${n1} of ${n1}`));
  assert.ok(row(AUDIO_CASE.incomplete, 2).includes(`data-timing="incomplete">Incomplete: ${n2 - 1} of ${n2}`));
  assert.ok(row(AUDIO_CASE.incomplete, 1).includes('data-timing="complete"'));
  assert.ok(row(AUDIO_CASE.noTimestamps, 1).includes('data-timing="none">No timestamps'));
  assert.ok(row(AUDIO_CASE.forbidden, 1).includes('Failed (HTTP 403): forbidden (scope or access missing), type &quot;forbidden&quot;') || row(AUDIO_CASE.forbidden, 1).includes('Failed (HTTP 403): forbidden (scope or access missing)'));
  assert.ok(row(AUDIO_CASE.notInPrelive, 2).includes('Failed (HTTP 404): not found (for example not available in pre-live)'));
  assert.ok(row(AUDIO_CASE.notInPrelive, 1).includes('data-ok="yes"'));
  assert.ok(row(AUDIO_CASE.signed, 1).includes('data-signed'));
  assert.ok(row(AUDIO_CASE.negative, 1).includes('<em>not given</em>') && row(AUDIO_CASE.negative, 1).includes('1 negative durations'));
  // Never the signed URL, a path, a secret or a token; no script; segments not shown.
  for (const bad of ['MOCK_SIGNATURE', '.mp3', 'token=', MOCK_CLIENT_SECRET, 'mock-token-', '<script', 'timestamp_from']) assert.ok(!h.includes(bad), bad);
  // Calls: two lists and 14 surah files, each with segments=true, all with the audio scope only.
  const audio = mock.state.paths.filter((p) => p.includes('chapter_recitations'));
  assert.equal(audio.length, 14);
  assert.ok(audio.every((p) => p.endsWith('?segments=true')));
  assert.ok(mock.state.tokenBodies.some((b) => b.includes(`scope=${encodeURIComponent(AUDIO_SCOPE)}`) || b.includes(`scope=${AUDIO_SCOPE}`)));
});

test('reciters page: a missing scope and a down API are shown plainly', async () => {
  const r = await (await open(setup({ noAudioScope: true }).w)).text();
  assert.ok(r.includes('token refused for scope content.audio.read'));
  assert.ok(!r.includes('data-ok="yes"'));
  const { w, mock } = setup();
  mock.state.mode = 'down';
  const d = await (await open(w)).text();
  assert.ok(d.includes('Failed (HTTP 503)'));
  const n = await (await open(setup().w, AUTH, { ...ENV, QF_CLIENT_SECRET: '' })).text();
  assert.ok(n.includes('Not configured. Missing Worker settings: QF_CLIENT_SECRET'));
});

test('checkAudioFile: completeness rules', () => {
  const ts = (n: number, s = 1) => Array.from({ length: n }, (_, i) => ({ verse_key: `${s}:${i + 1}`, timestamp_from: i * 10, timestamp_to: i * 10 + 9, duration: 9 }));
  const f = (t: unknown) => ({ audio_file: { audio_url: 'https://h.invalid/a.mp3?x=1', format: 'mp3', file_size: 1, duration: 5, timestamps: t } });
  assert.equal(checkAudioFile(f(ts(3)), 1, 3)!.timing.complete, true);
  assert.equal(checkAudioFile(f(ts(3)), 1, 3)!.host, 'h.invalid');
  assert.equal(checkAudioFile(f(ts(3)), 1, 3)!.hasQuery, true);
  assert.equal(checkAudioFile(f(ts(2)), 1, 3)!.timing.complete, false);
  assert.equal(checkAudioFile(f(ts(3, 2)), 1, 3)!.timing.complete, false, 'wrong surah keys');
  const back = ts(3); back[2].timestamp_from = 1;
  assert.equal(checkAudioFile(f(back), 1, 3)!.timing.complete, false, 'overlapping times');
  assert.equal(checkAudioFile({ audio_file: {} }, 1, 3)!.timing.present, false);
  assert.equal(checkAudioFile({}, 1, 3), null);
});
