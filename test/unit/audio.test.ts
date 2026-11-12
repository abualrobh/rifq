// RQ-006 v1.1 (unit level): the offered-reciter rules (AC52, AC59, AC60, AC61, D-119 A, D-122 A,
// D-123), the address check (AC56), and the Worker routes against the mock Quran Foundation API
// (AC3, AC23, AC34 to AC38, D-095). Made-up names, timings and sizes; no real API call; no audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { makeWorker } from '../../src/worker/app.ts';
import { approvedAudioUrl, ayahAt, catalogueProblems, checkSurahFile, checkTimestamps, coveredSurahs, D111_IDS, fileProblems, foldLatin, stallWatch } from '../../src/core/audio.ts';
import { AUDIO_SCOPE } from '../../src/worker/audio.ts';
import { AR_WORD, createMockQf, MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, mockAudioUrl } from '../mock/qf-mock.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';
import { privacyItems, PRIVACY_ITEMS, PRIVACY_LISTENING_ON, STRINGS } from '../../src/core/strings.ts';

const ts = (s: number, n: number, step = 5000) => Array.from({ length: n }, (_, i) => ({ verse_key: `${s}:${i + 1}`, timestamp_from: i * step, timestamp_to: i * step + step - 100, duration: step - 100 }));

test('AC59: listed, expected name, Murattal and Hafs; no other ID stands in', () => {
  assert.deepEqual(D111_IDS, [7, 2, 6, 9, 4, 97, 161]);
  const e = (name: string, style = 'Murattal', qirat = 'Hafs') => ({ id: 7, name, style, qirat, translated: null, translatedLang: null });
  // QF's own spelling seen in pre-live, folded.
  assert.equal(foldLatin('Mishari Rashid al-`Afasy'), 'mishariRashidalafasy'.toLowerCase());
  assert.deepEqual(catalogueProblems(7, e('Mishari Rashid al-`Afasy')), []);
  assert.deepEqual(catalogueProblems(6, e('Mahmoud Khaleel Al-Husary')), []);
  assert.deepEqual(catalogueProblems(7, undefined), ["not in this account's chapter-reciter list"]);
  assert.deepEqual(catalogueProblems(7, e('Someone Else')), ['name does not match D-111']);
  assert.deepEqual(catalogueProblems(6, e('Mahmoud Khalil Al-Husary', 'Muallim')), ['style is not Murattal']);
  assert.deepEqual(catalogueProblems(7, e('Mishari Rashid al-`Afasy', 'Murattal', 'Warsh')), ['qirat is not Hafs']);
  assert.deepEqual(catalogueProblems(173, e('Mishari Rashid al-`Afasy Streaming')), ['not a D-111 reciter']);
  assert.deepEqual(catalogueProblems(12, e('Mahmoud Khalil Al-Husary')), ['not a D-111 reciter']);
});

test('AC12, AC60: one entry per ayah, in order, from < to, no overlap, within the file; negatives only counted', () => {
  assert.equal(checkTimestamps(ts(1, 7), 1, 7, 35000).ok, true);
  const neg = ts(1, 7).map((x) => ({ ...x, duration: -5 }));
  const r = checkTimestamps(neg, 1, 7, 35000);
  assert.equal(r.ok, true, 'negative per-entry durations alone do not fail (AC60)');
  assert.equal(r.negatives, 7);
  assert.equal(checkTimestamps(ts(1, 6), 1, 7, 35000).ok, false);
  assert.equal(checkTimestamps(ts(2, 7), 1, 7, 35000).ok, false, 'wrong surah keys');
  const overlap = ts(2, 30); overlap[25].timestamp_from = overlap[24].timestamp_to - 1; // like ID 2, surah 2, entry 26
  assert.match(checkTimestamps(overlap, 2, 30, 10 ** 9).problems.join(), /entry 26: starts before the previous one ends/);
  const backwards = ts(1, 7); backwards[3].timestamp_to = backwards[3].timestamp_from;
  assert.equal(checkTimestamps(backwards, 1, 7, 35000).ok, false);
  const frac = ts(1, 7); (frac[0] as { timestamp_to: number }).timestamp_to = 10.5;
  assert.equal(checkTimestamps(frac, 1, 7, 35000).ok, false);
  assert.equal(checkTimestamps(ts(1, 7), 1, 7, 30000).ok, false, 'last end after the file');
  assert.equal(checkTimestamps(undefined, 1, 7, 35000).ok, false);
  const gap = ts(1, 3, 5000); gap[2].timestamp_from += 500; gap[2].timestamp_to += 500;
  assert.equal(checkTimestamps(gap, 1, 3, 20000).ok, true, 'a gap is allowed');
});

test('AC61, P-7: mp3, whole bytes, duration above zero, 32 to 320 kbit/s (pre-live Husary sizes fail)', () => {
  assert.deepEqual(fileProblems('mp3', 839808, 46000), []);
  assert.deepEqual(fileProblems('mp3', 120888301, 7264000), []);
  assert.match(fileProblems('mp3', 371.65, 48000).join(), /whole number of bytes/);
  assert.match(fileProblems('mp3', 2048, 11972000).join(), /bitrate 0 kbit\/s/);
  assert.match(fileProblems('ogg', 839808, 46000).join(), /not mp3/);
  assert.match(fileProblems('mp3', 839808, null).join(), /duration/);
  assert.match(fileProblems('mp3', 839808, 0).join(), /duration/);
  assert.match(fileProblems('mp3', 10 ** 8, 46000).join(), /outside 32 to 320/);
});

test('AC56: https on exactly the approved host; relative addresses resolve to it; nothing else', () => {
  assert.equal(approvedAudioUrl('https://download.quranicaudio.com/q/1.mp3'), 'https://download.quranicaudio.com/q/1.mp3');
  assert.equal(approvedAudioUrl('https://download.quranicaudio.com/q/1.mp3?x=1'), 'https://download.quranicaudio.com/q/1.mp3?x=1');
  assert.equal(approvedAudioUrl('/q/1.mp3'), 'https://download.quranicaudio.com/q/1.mp3');
  assert.equal(approvedAudioUrl('q/1.mp3'), 'https://download.quranicaudio.com/q/1.mp3');
  for (const bad of ['http://download.quranicaudio.com/1.mp3', 'https://evil.download.quranicaudio.com/1.mp3', 'https://download.quranicaudio.com.evil.invalid/1.mp3', 'https://quranicaudio.com/1.mp3', 'https://u:p@download.quranicaudio.com/1.mp3', 'https://download.quranicaudio.com:8443/1.mp3', '//evil.invalid/1.mp3', 'javascript:alert(1)', 'data:audio/mp3;base64,AA', '', null, 5]) {
    assert.equal(approvedAudioUrl(bad), null, String(bad));
  }
  const ok = checkSurahFile({ audio_file: { format: 'mp3', file_size: 560000, duration: 35000, audio_url: '/a.mp3', timestamps: ts(1, 7) } }, 1, 7);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.play!.t[0], [0, 4900]);
  assert.equal(Object.keys(ok.play!).sort().join(), 'duration,t,url', 'AC34: only what the player needs');
  assert.equal(checkSurahFile({ audio_file: { format: 'mp3', file_size: 560000, duration: 35000, audio_url: 'https://elsewhere.invalid/a.mp3', timestamps: ts(1, 7) } }, 1, 7).ok, false);
  assert.deepEqual(coveredSurahs('prelive'), [1, 2]);
  assert.equal(coveredSurahs('production').length, 114);
});

test('player: the ayah for a playback position follows the timings only', () => {
  const tm: [number, number][] = [[1000, 4000], [4000, 9000], [9500, 12000]];
  assert.equal(ayahAt(tm, 0), 0, 'before ayah 1 (an opening) nothing is marked');
  assert.equal(ayahAt(tm, 1000), 1);
  assert.equal(ayahAt(tm, 3999), 1);
  assert.equal(ayahAt(tm, 4000), 2);
  assert.equal(ayahAt(tm, 9200), 2, 'a gap keeps the previous ayah until the next starts');
  assert.equal(ayahAt(tm, 11999), 3);
  assert.equal(ayahAt(tm, 12500), 0);
});

// ---- Worker routes against the mock ----
const { ab, src } = synthetic('audio');
const BASE = 'http://127.0.0.1:9997';
const ENV = { QF_CLIENT_ID: MOCK_CLIENT_ID, QF_CLIENT_SECRET: MOCK_CLIENT_SECRET, QF_ENV: 'prelive', QF_TEST_BASE: BASE };
const counts = [0, ...SYN_COUNTS.slice(1)];

class FakeCache {
  m = new Map<string, { body: string; headers: Headers }>();
  async match(k: string) { const e = this.m.get(k); return e ? new Response(e.body, { headers: e.headers }) : undefined; }
  async put(k: string, r: Response) { this.m.set(k, { body: await r.text(), headers: r.headers }); }
}

function setup(o: { arCatalogueFails?: boolean; audioHang?: (id: number, s: number) => boolean; audioDown?: (id: number, s: number) => boolean; emptyCatalogue?: () => boolean; override?: (id: number, s: number, f: Record<string, unknown>) => Record<string, unknown>; audioRecord?: unknown; audio?: boolean } = {}) {
  let clock = Date.parse('2026-11-12T00:00:00Z');
  const now = () => clock;
  const mock = createMockQf({ quran: src, counts, now, audioOverride: o.override, arCatalogueFails: o.arCatalogueFails, audioHang: o.audioHang, audioDown: o.audioDown, emptyCatalogue: o.emptyCatalogue });
  const cache = new FakeCache();
  const seen: string[] = [];
  const w = makeWorker(ab, { testMemoryLimits: true, dev: true, audio: o.audio ?? true, record: { name: 'Synthetic', edition: 'seed', status: 'UNVERIFIED' }, counts, audioLimit: 1000, audioRecord: (o.audioRecord ?? null) as never },
    { fetch: (u, i) => { seen.push(u); assert.ok(u.startsWith(BASE), 'only the configured API base'); return mock.fetch(u, i); }, now, cache: () => cache, timeoutMs: 2000 });
  return { w, mock, cache, seen, tick: (ms: number) => { clock += ms; } };
}
const call = (w: ReturnType<typeof makeWorker>, path: string, body: unknown, env: Record<string, unknown> = ENV, h: Record<string, string> = {}) =>
  w.fetch(new Request('http://127.0.0.1' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.3.3.3', cookie: 'reader=1', 'user-agent': 'Reader UA', ...h } }), env as never);

test('reciters route: offered set comes from the data (listed, named, Murattal, Hafs, surahs 1 and 2 pass)', async () => {
  const { w, mock } = setup();
  const r = await call(w, '/api/audio/reciters', { lang: 'en' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const d = await r.json();
  // 7 passes; 2 incomplete in surah 2; 6 no timestamps; 9 forbidden; 4 not in pre-live surah 2;
  // 97 passes (its address has a query string, kept as given); 161 is not listed.
  assert.deepEqual(d.reciters.map((x: { id: number }) => x.id), [7, 97]);
  assert.equal(d.default, 7);
  assert.deepEqual(d.reciters[0], { id: 7, name: 'MOCK Afasy', style: 'Murattal', qirat: 'Hafs' });
  // Only audio calls, only with the audio scope; never surah 3 or later in pre-live.
  assert.ok(mock.state.tokenBodies.every((b) => new URLSearchParams(b).get('scope') === AUDIO_SCOPE));
  assert.ok(mock.state.paths.every((p) => /\/chapter_recitations\/(7|2|6|9|4|97)\/[12]\?segments=true$|\/resources\/chapter_reciters\?language=en$/.test(p)), mock.state.paths.join());
  // AC38: no reader header reaches QF.
  assert.ok(mock.state.contentHeaderNames.every((h) => !h.includes('cookie') && !h.includes('user-agent') && !h.includes('cf-connecting-ip')));
});

test('kit v22 fix: the Arabic interface offers the same reciters; the check reads the English catalogue only', async () => {
  // The mock's language=ar catalogue gives style, qirat and names in Arabic, as QF may. Before the
  // fix the Arabic interface ran the AC59 check on it and offered no reciter.
  const { w, mock } = setup();
  const ar = await (await call(w, '/api/audio/reciters', { lang: 'ar' })).json();
  assert.deepEqual(ar.reciters.map((x: { id: number }) => x.id), [7, 97]);
  assert.equal(ar.default, 7);
  assert.equal(ar.reciters[0].name, AR_WORD(7), 'AC14: the name QF gives for the language');
  assert.equal(ar.reciters[0].style, 'Murattal', 'style and riwayah from the English check');
  const en = await (await call(w, '/api/audio/reciters', { lang: 'en' })).json();
  assert.deepEqual(en.reciters.map((x: { id: number; name: string }) => [x.id, x.name]), [[7, 'MOCK Afasy'], [97, 'MOCK Dossari']]);
  assert.ok(mock.state.paths.includes('/content/api/v4/resources/chapter_reciters?language=en'));
  // The file route works the same in both interfaces.
  assert.equal((await call(w, '/api/audio', { r: 7, s: 2 })).status, 200);
  // If the Arabic catalogue cannot be read, the English names are used; nothing else changes.
  const down = setup({ arCatalogueFails: true });
  const d = await (await call(down.w, '/api/audio/reciters', { lang: 'ar' })).json();
  assert.deepEqual(d.reciters.map((x: { id: number; name: string }) => [x.id, x.name]), [[7, 'MOCK Afasy'], [97, 'MOCK Dossari']]);
});

test('AC61 and D-122 A: a reciter whose file metadata is implausible is not offered', async () => {
  const { w } = setup({ override: (id: number, s: number, f: Record<string, unknown>) => (id === 7 && s === 1 ? { ...f, file_size: 371.65 } : f) });
  const d = await (await call(w, '/api/audio/reciters', { lang: 'en' })).json();
  assert.deepEqual(d.reciters.map((x: { id: number }) => x.id), [97]);
  assert.equal(d.default, 97, 'the default falls to the first offered reciter when 7 is not offered');
});

test('file route: address and timings only, for offered reciters and covered surahs', async () => {
  const { w, mock } = setup();
  const r = await call(w, '/api/audio', { r: 7, s: 1 });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(Object.keys(d).sort(), ['duration', 'r', 's', 'status', 't', 'url']);
  assert.equal(d.url, mockAudioUrl(7, 1));
  assert.equal(d.t.length, counts[1]);
  assert.deepEqual(d.t[0], [0, 4900]);
  const raw = JSON.stringify(d);
  for (const bad of [MOCK_CLIENT_SECRET, MOCK_CLIENT_ID, 'mock-token-', 'verse_key', 'segments', 'file_size']) assert.ok(!raw.includes(bad), bad);
  assert.equal((await (await call(w, '/api/audio', { r: 97, s: 2 })).json()).url, mockAudioUrl(97, 2) + '?token=MOCK_SIGNATURE&expires=1');
  // Not offered, never substituted.
  for (const r2 of [2, 6, 12, 173]) assert.deepEqual(await (await call(w, '/api/audio', { r: r2, s: 1 })).json(), { status: 'not_offered' });
  // Surahs the environment does not cover: no call to QF at all.
  const before = mock.state.audioRequests;
  assert.deepEqual(await (await call(w, '/api/audio', { r: 7, s: 3 })).json(), { status: 'not_covered' });
  assert.equal(mock.state.audioRequests, before);
  for (const b of [{ r: 7, s: 0 }, { r: 7, s: counts.length }, { r: '7', s: 1 }, { s: 1 }]) assert.equal((await call(w, '/api/audio', b)).status, 400);
});

test('AC37: metadata is kept at most 7 days; AC23: an outage is "unavailable", never another reciter', async () => {
  const { w, mock, tick } = setup();
  await call(w, '/api/audio', { r: 7, s: 1 });
  const n = mock.state.audioRequests;
  await call(w, '/api/audio', { r: 7, s: 1 });
  assert.equal(mock.state.audioRequests, n, 'served from the copy');
  tick(7 * 24 * 3600 * 1000);
  await call(w, '/api/audio', { r: 7, s: 1 });
  assert.ok(mock.state.audioRequests > n, 'a 7-day-old copy is not used');
  const fresh = setup();
  fresh.mock.state.mode = 'down';
  const r = await call(fresh.w, '/api/audio', { r: 7, s: 1 });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { status: 'unavailable' });
  const n2 = await call(setup().w, '/api/audio', { r: 7, s: 1 }, { ...ENV, QF_CLIENT_SECRET: '' });
  assert.deepEqual(await n2.json(), { status: 'not_configured' });
});

test('production: without a recorded check no reciter is offered; with one, only passed and listed reciters', async () => {
  const prod = { ...ENV, QF_ENV: 'production' };
  // The local mock stands in for production here (QF_TEST_BASE, development builds only).
  const none = await (await call(setup().w, '/api/audio/reciters', { lang: 'en' }, prod)).json();
  assert.deepEqual(none.reciters, []);
  assert.equal(none.default, null);
  const rec = { format: 'rifq-audio-check/1', env: 'production', checked: '2026-11-12', passed: [7, 161, 12] };
  const some = await (await call(setup({ audioRecord: rec }).w, '/api/audio/reciters', { lang: 'en' }, prod)).json();
  assert.deepEqual(some.reciters.map((x: { id: number }) => x.id), [7], '161 is not listed; 12 is never a D-111 stand-in');
});

test('route rules: POST JSON only, cross-site refused, AUDIO_LIMIT fails closed, no route with the flag off', async () => {
  const { w } = setup();
  assert.equal((await w.fetch(new Request('http://127.0.0.1/api/audio', { method: 'GET' }), ENV as never)).status, 405);
  assert.equal((await w.fetch(new Request('http://127.0.0.1/api/audio', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }), ENV as never)).status, 415);
  assert.equal((await call(w, '/api/audio', { r: 7, s: 1 }, ENV, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call(w, '/api/audio', 'x'.repeat(400))).status, 413);
  const strict = makeWorker(ab, { dev: true, audio: true, record: { name: 'S', edition: 'e', status: 's' }, counts });
  for (const binding of [undefined, { limit: async () => { throw new Error('x'); } }, {}]) {
    const r = await call(strict, '/api/audio', { r: 7, s: 1 }, { ...ENV, ...(binding ? { AUDIO_LIMIT: binding } : {}) });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000');
  }
  const limited = await call(strict, '/api/audio', { r: 7, s: 1 }, { ...ENV, AUDIO_LIMIT: { limit: async () => ({ success: false }) } });
  assert.equal(limited.status, 429);
  assert.equal((await call(setup({ audio: false }).w, '/api/audio', { r: 7, s: 1 })).status, 404);
});

test('AC39: the Worker adds media-src for the audio host on reader pages only', async () => {
  const assets = { fetch: async () => new Response('<p>x</p>', { headers: { 'content-type': 'text/html' } }) };
  const csp = "default-src 'none'; script-src 'self'; font-src 'self'; connect-src 'self'";
  const w = makeWorker(ab, { dev: true, audio: true, gate: true, record: { name: 'S', edition: 'e', status: 's' }, counts, assetHeaders: { 'Content-Security-Policy': csp } });
  const env = { SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) }, ASSETS: assets };
  const get = (p: string) => w.fetch(new Request('http://127.0.0.1' + p, { headers: { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') } }), env as never);
  for (const p of ['/2/', '/en/114/', '/1']) assert.equal((await get(p)).headers.get('content-security-policy'), `${csp}; media-src https://download.quranicaudio.com`, p);
  for (const p of ['/', '/en/', '/surahs/', '/privacy/', '/tafseer/2/', '/en/tafseer/2/', '/dev/reciters-x/', '/1234/']) assert.equal((await get(p)).headers.get('content-security-policy'), csp, p);
});

test('AC40: the privacy "Listening" item is written but off; the live privacy text is unchanged', () => {
  assert.equal(PRIVACY_LISTENING_ON, false);
  assert.deepEqual(privacyItems(), [...PRIVACY_ITEMS]);
  const on = privacyItems(true);
  assert.equal(on.length, PRIVACY_ITEMS.length + 1);
  assert.deepEqual(on[on.findIndex(([l]) => l === 'pvTafseerL') + 1], ['pvListenL', 'pvListen']);
  for (const l of ['ar', 'en'] as const) assert.ok(STRINGS[l].pvListen.includes('download.quranicaudio.com'));
});

test('AC52 recorded check: per reciter, every covered surah; production needs all 114', async () => {
  const { runAudioCheck } = await import('../../scripts/audio-check.ts');
  const pre = await runAudioCheck(ENV, counts, { fetch: createMockQf({ quran: src, counts }).fetch, timeoutMs: 2000 }, true, '2026-11-12');
  assert.deepEqual(pre.record, { format: 'rifq-audio-check/1', env: 'prelive', checked: '2026-11-12', passed: [7, 97] });
  const two = pre.report.reciters.find((r) => r.id === 2)!;
  assert.deepEqual(two.failed.map((f) => f.s), [2]);
  assert.deepEqual(pre.report.reciters.find((r) => r.id === 161)!.catalogue, ["not in this account's chapter-reciter list"]);
  assert.ok(!JSON.stringify(pre).includes('quranicaudio'), 'no address in the record or report (AC35)');
  // The mock has surahs 1 and 2 only, so in production every reciter fails on surah 3 onwards.
  const prod = await runAudioCheck({ ...ENV, QF_ENV: 'production' }, counts, { fetch: createMockQf({ quran: src, counts }).fetch, timeoutMs: 2000 }, true, '2026-11-12');
  assert.deepEqual(prod.record.passed, []);
  assert.ok(prod.report.reciters.find((r) => r.id === 7)!.failed.some((f) => f.s === 3));
});

test('/dev/reciters/ player check (temporary): same checks as the player, per reciter and surah, and the AUDIO_LIMIT state', async () => {
  const mk = (override?: (id: number, s: number, f: Record<string, unknown>) => Record<string, unknown>) => {
    const mock = createMockQf({ quran: src, counts, audioOverride: override });
    return makeWorker(ab, { testMemoryLimits: true, dev: true, gate: true, tafseer: true, audio: true, record: { name: 'S', edition: 'e', status: 's' }, counts, fingerprints: { format: 'rifq-tafseer-fingerprints/1', entries: [] }, tafseerLimit: 1000, audioLimit: 1000 },
      { fetch: (u, i) => mock.fetch(u, i), timeoutMs: 2000 });
  };
  const env = { ...ENV, SITE_USER: 'u', SITE_PASSWORD: 'p', AUTH_LIMIT: { limit: async () => ({ success: true }) } };
  const open = (w: ReturnType<typeof makeWorker>, e: Record<string, unknown>) => w.fetch(new Request('http://127.0.0.1/dev/reciters/', { headers: { authorization: 'Basic ' + Buffer.from('u:p').toString('base64') } }), e as never).then((r) => r.text());
  const h = await open(mk(), env);
  assert.match(h, /Player check \(RQ-006, temporary\)/);
  assert.match(h, /data-offered>7, 97</);
  assert.match(h, /data-audio-limit>missing \(the audio routes answer 503\)/);
  assert.match(h, /data-diag="7:1" data-ok="yes"/);
  assert.match(h, /data-diag="2:2" data-ok="no">.*?entry 1: verse key|data-diag="2:2" data-ok="no">.*?entries for/);
  // Unlisted IDs are still checked file by file, so the page shows both reasons.
  assert.match(h, /data-diag="161:1" data-ok="[a-z]+"><td>161<\/td><td>not in this account&#39;s chapter-reciter list/);
  const ok = await open(mk(), { ...env, AUDIO_LIMIT: { limit: async () => ({ success: true }) } });
  assert.match(ok, /data-audio-limit>present; one check now: ok/);
  // A last ayah that ends after the file's duration (by 104 ms) fails AC60 and says by how much.
  const over = await open(mk((id, s, f) => (id === 7 && s === 1 ? { ...f, duration: 34796 } : f)), env);
  assert.match(over, /data-diag="7:1" data-ok="no">.*?last entry ends after the file \(by 104 ms; duration 34796 ms\)/);
  assert.match(over, /data-offered>97</);
  // The address path with the surah as {s}, never a concrete address, query string, secret or token.
  assert.match(over, /data-url-path>https:\/\/download\.quranicaudio\.com\/mock-rifq-test\/7\/\{s\}\.mp3</);
  assert.match(over, /data-diag="97:1"[^]*?data-url-path>[^<]*\(has a query string, not shown\)/);
  assert.match(over, /data-diag="7:1"[^]*?last end minus duration 104 ms/);
  for (const bad of ['/7/1.mp3', 'MOCK_SIGNATURE', 'token=', MOCK_CLIENT_SECRET, 'mock-token-']) assert.ok(!over.includes(bad), bad);
  assert.match(over, /data-record-shape>[^<]*&#34;lastEndMinusDuration&#34;: 104/);
});

test('kit v23: a whole-second duration may be passed by the last ayah by under 1000 ms (deviation for approval)', () => {
  const last = (to: number) => { const x = ts(1, 7); x[6].timestamp_to = to; return x; };
  assert.equal(checkTimestamps(last(46400), 1, 7, 46000).ok, true, 'rounded to whole seconds: 400 ms over is rounding');
  assert.equal(checkTimestamps(last(46999), 1, 7, 46000).ok, true);
  assert.match(checkTimestamps(last(47000), 1, 7, 46000).problems.join(), /by 1000 ms/);
  assert.match(checkTimestamps(last(46400), 1, 7, 46001).problems.join(), /by 399 ms/, 'a duration in ms is taken as exact');
});

test('kit v23: failed surah checks are kept 10 minutes only, then asked again', async () => {
  let bad = true;
  const { w, mock, tick } = setup({ override: (id: number, s: number, f: Record<string, unknown>) => (bad && id === 7 && s === 1 ? { ...f, duration: 1000 } : f) });
  const first = await (await call(w, '/api/audio/reciters', { lang: 'en' })).json();
  assert.deepEqual(first.reciters.map((x: { id: number }) => x.id), [97]);
  bad = false;
  assert.deepEqual((await (await call(w, '/api/audio/reciters', { lang: 'en' })).json()).reciters.map((x: { id: number }) => x.id), [97], 'within 10 minutes the failure copy is used');
  tick(10 * 60_000);
  const n = mock.state.audioRequests;
  const again = await (await call(w, '/api/audio/reciters', { lang: 'en' })).json();
  assert.deepEqual(again.reciters.map((x: { id: number }) => x.id), [7, 97]);
  assert.ok(mock.state.audioRequests > n);
});

test('kit v24: the Worker asks for the surah file with segments=true, keeps only [from, to] per ayah', async () => {
  const { w, mock } = setup();
  const d = await (await call(w, '/api/audio', { r: 7, s: 1 })).json();
  assert.equal(d.status, 'ok', 'the mock gives timestamps only with segments=true, as the real API does');
  const files = mock.state.paths.filter((p) => p.includes('/chapter_recitations/'));
  assert.ok(files.length > 0);
  assert.ok(files.every((p) => p.endsWith('?segments=true')), files.join());
  assert.ok(d.t.every((x: unknown) => Array.isArray(x) && x.length === 2), 'no word segments reach the browser');
  const run = await import('../../scripts/audio-check.ts');
  const m2 = createMockQf({ quran: src, counts });
  const rec = await run.runAudioCheck(ENV, counts, { fetch: m2.fetch, timeoutMs: 2000 }, true, '2026-11-12');
  assert.deepEqual(rec.record.passed, [7, 97]);
  assert.ok(m2.state.paths.filter((p) => p.includes('/chapter_recitations/')).every((p) => p.endsWith('?segments=true')));
});

test('QA FIND-2: one slow or failing surah call removes only that reciter; an outage of all is "unavailable"', async () => {
  // Husary-like 6 is already refused; make 97's surah 2 hang (2 s client time-out in tests).
  const hang = setup({ audioHang: (id, s) => id === 97 && s === 2 });
  const r = await call(hang.w, '/api/audio/reciters', { lang: 'en' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).reciters.map((x: { id: number }) => x.id), [7]);
  // A 5xx on one reciter's file: same.
  const down = setup({ audioDown: (id) => id === 97 });
  assert.deepEqual((await (await call(down.w, '/api/audio/reciters', { lang: 'en' })).json()).reciters.map((x: { id: number }) => x.id), [7]);
  // /api/audio checks only the asked reciter: 7 plays while 97's files are down.
  const n = down.mock.state.audioRequests;
  assert.equal((await call(down.w, '/api/audio', { r: 7, s: 1 })).status, 200);
  assert.ok(down.mock.state.audioRequests - n <= 2, 'no other reciter is checked again');
  // Every offered candidate in outage: 503 unavailable, not an empty list.
  const all = setup({ audioDown: () => true });
  const a = await call(all.w, '/api/audio/reciters', { lang: 'en' });
  assert.equal(a.status, 503);
  assert.deepEqual(await a.json(), { status: 'unavailable' });
});

test('QA FIND-7: an empty catalogue is kept 10 minutes, not 7 days', async () => {
  let empty = true;
  const { w, tick } = setup({ emptyCatalogue: () => empty });
  assert.deepEqual((await (await call(w, '/api/audio/reciters', { lang: 'en' })).json()).reciters, []);
  empty = false;
  assert.deepEqual((await (await call(w, '/api/audio/reciters', { lang: 'en' })).json()).reciters, [], 'within 10 minutes the copy is used');
  tick(10 * 60_000);
  assert.deepEqual((await (await call(w, '/api/audio/reciters', { lang: 'en' })).json()).reciters.map((x: { id: number }) => x.id), [7, 97]);
});

// Kit v24 report: Al-Baqarah stopped at ayah 5 with [timeout-stalled]. 'stalled' fires on healthy
// playback of large files; the give-up must depend on the position not moving, nothing else.
function fakeClock() {
  let now = 0, next = 1;
  const jobs = new Map<number, { at: number; f: () => void }>();
  return {
    timers: { set: (f: () => void, ms: number) => { const id = next++; jobs.set(id, { at: now + ms, f }); return id; }, clear: (id: unknown) => { jobs.delete(id as number); } },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; jobs.delete(due[0]); due[1].f();
      }
      now = end;
    },
  };
}
function watchCase() {
  const c = fakeClock();
  const p = { pos: 0, live: true, gaveUp: 0 };
  const w = stallWatch({ ms: 15000, pos: () => p.pos, live: () => p.live, giveUp: () => { p.gaveUp++; }, timers: c.timers });
  return { c, p, w };
}

test('AC24 stall: repeated stalled/waiting events during healthy playback never give up while the position moves', () => {
  const { c, p, w } = watchCase();
  w.watch(); // playing
  for (let i = 0; i < 400; i++) { // 100 s of playback, timeupdate every 250 ms, 'stalled' every 3 s
    c.advance(250); p.pos += 0.25; w.progress();
    if (i % 12 === 0) w.watch();
  }
  assert.equal(p.gaveUp, 0);
  assert.equal(w.running, true);
});

test('AC24 stall: no movement for 15 s while playing gives up once; repeated stalled events do not extend it', () => {
  const { c, p, w } = watchCase();
  w.watch(); c.advance(1000); p.pos = 30; w.progress();
  for (let i = 0; i < 14; i++) { c.advance(1000); w.watch(); w.progress(); } // stuck at 30 s, 'stalled' each second
  assert.equal(p.gaveUp, 0);
  c.advance(1000);
  assert.equal(p.gaveUp, 1, 'given up 15 s after the last movement');
  c.advance(60000);
  assert.equal(p.gaveUp, 1);
});

test('AC24 stall: paused or stopped never gives up; movement seen only when the clock runs out restarts it (background)', () => {
  const { c, p, w } = watchCase();
  w.watch(); p.live = false; c.advance(20000); // paused: the clock ran out but nothing happens
  assert.equal(p.gaveUp, 0);
  p.live = true; w.watch(); w.stop(); c.advance(20000);
  assert.equal(p.gaveUp, 0, 'stopped');
  // Background: timeupdate was held back, but the position moved; the clock restarts.
  w.watch(); p.pos = 50; c.advance(15000);
  assert.equal(p.gaveUp, 0);
  assert.equal(w.running, true);
  c.advance(15000);
  assert.equal(p.gaveUp, 1, 'then 15 s without movement gives up');
  // watch() while not live does not start the clock.
  const k = watchCase(); k.p.live = false; k.w.watch();
  assert.equal(k.w.running, false);
});

test('/dev/reciters/ record shape: only the file name is templated; a folder named like the surah stays (reciter 2, surah 2)', () => {
  const shape = (u: string, s: number) => checkSurahFile({ audio_file: { format: 'mp3', file_size: 1, duration: 1000, audio_url: u } }, s, 1).shape!.urlPath;
  assert.equal(shape(mockAudioUrl(2, 2), 2), 'https://download.quranicaudio.com/mock-rifq-test/2/{s}.mp3');
  assert.equal(shape('https://download.quranicaudio.com/qdc/x/murattal/002.mp3', 2), 'https://download.quranicaudio.com/qdc/x/murattal/{s}.mp3');
  assert.equal(shape('https://download.quranicaudio.com/2/12.mp3?sig=1', 12), 'https://download.quranicaudio.com/2/{s}.mp3');
  assert.equal(shape('https://download.quranicaudio.com/a/112.mp3', 2), 'https://download.quranicaudio.com/a/112.mp3');
});
