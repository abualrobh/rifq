// D-125 B: the audio checks against fixtures built from the real pre-live Record shape (13 Nov),
// read from private data (RIFQ_AUDIO_SHAPE; see test/fixtures/recorded-audio.ts). Skipped when it is
// not given. D-132: the AC60 whole-second allowance (an overrun under 1000 ms when the duration is a
// whole number of seconds) is approved.
// D-133 A: no value from the recorded data is written in this public file. The tests on recorded
// data take every expected value (addresses, timings, overruns, sizes, problems) from the private
// fixture at run time. The same kinds of case are also checked on made-up values (last test), which
// run without the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedAudioUrl, AUDIO_ORIGIN, ayahAt, checkSurahFile, DURATION_ROUNDING_MS, fileShape } from '../../src/core/audio.ts';
import { fileFromShape, loadRecorded, playFromShape, RECORDED_PATH, type RecordedShape, type RecordedSurah } from '../fixtures/recorded-audio.ts';

const rec = loadRecorded();
const skip = rec ? false : `no recorded shape (set RIFQ_AUDIO_SHAPE; given: ${RECORDED_PATH ? 'missing file' : 'none'})`;

test('recorded shape: every reciter and surah gives the same check result, problems, negatives and shape as on the test site', { skip }, () => {
  let n = 0;
  for (const r of rec!.reciters) for (const x of r.surahs) {
    if (!x.shape) continue;
    const f = fileFromShape(x.shape, x.s, x.problems, x.negatives);
    const c = checkSurahFile({ audio_file: f }, x.s, x.shape.entries ?? 0);
    const id = `${r.id}:${x.s}`;
    assert.equal(c.ok, x.ok, id);
    assert.deepEqual(c.problems, x.problems, id);
    assert.equal(c.negatives, x.negatives, id);
    assert.deepEqual(c.shape, x.shape, id);
    n++;
  }
  assert.equal(n, 14);
});

type Case = { id: number; x: RecordedSurah; sh: RecordedShape };
function cases(): Case[] {
  const out: Case[] = [];
  for (const r of rec!.reciters) for (const x of r.surahs) if (x.shape) out.push({ id: r.id, x, sh: x.shape });
  return out;
}
// A double slash in the address path after the host (not the one in "https://").
const doubleSlash = (p: string | null) => !!p && /^https:\/\/[^/]+\/.*\/\//.test(p);
const overrun = (sh: RecordedShape) => (sh.last && typeof sh.duration === 'number' ? sh.last[1] - sh.duration : null);

// The kinds of case the recorded data holds, each found in the fixture and checked with the
// fixture's own values.
function checkKinds(all: Case[], label: string) {
  // AC60, D-132: an overrun under the allowance on a whole-second duration passes; one of 1000 ms or
  // more fails with the overrun and the duration in the message.
  const under = all.filter((c) => { const o = overrun(c.sh); return o !== null && o > 0 && o < DURATION_ROUNDING_MS && (c.sh.duration as number) % DURATION_ROUNDING_MS === 0 && c.x.ok; });
  assert.ok(under.length >= 1, `${label}: a passing overrun under the allowance`);
  const over = all.filter((c) => { const o = overrun(c.sh); return o !== null && o >= DURATION_ROUNDING_MS; });
  assert.ok(over.length >= 1, `${label}: an overrun of 1000 ms or more`);
  for (const c of over) {
    assert.equal(c.x.ok, false, `${label} ${c.id}:${c.x.s}`);
    assert.ok(c.x.problems.includes(`last entry ends after the file (by ${overrun(c.sh)} ms; duration ${c.sh.duration} ms)`), `${label} ${c.id}:${c.x.s}`);
  }
  // AC61 (D-122 A): a file size that is not a whole number of bytes fails; a whole size far too
  // small for its duration fails on the bitrate.
  const frac = all.filter((c) => typeof c.sh.fileSize === 'number' && !Number.isInteger(c.sh.fileSize));
  assert.ok(frac.length >= 1, `${label}: a fractional file size`);
  for (const c of frac) assert.ok(c.x.problems.includes('file_size is not a whole number of bytes'), `${label} ${c.id}:${c.x.s}`);
  const low = all.filter((c) => c.x.problems.some((p) => /^average bitrate \d+ kbit\/s is outside/.test(p)));
  assert.ok(low.length >= 1, `${label}: a bitrate outside the range`);
  // D-119 A: an overlap between two entries fails, at the entry the record names.
  assert.ok(all.some((c) => c.x.problems.some((p) => /^entry \d+: starts before the previous one ends$/.test(p))), `${label}: an overlap`);
  // AC55, AC56: an address with a double slash in its path is used exactly as given; the record
  // shape keeps the double slash too (only the file name is templated).
  const ds = all.filter((c) => doubleSlash(c.sh.urlPath) && c.x.ok);
  assert.ok(ds.length >= 1, `${label}: a passing address with a double slash`);
  for (const c of ds) {
    const want = c.sh.urlPath!.replace('{s}', String(c.x.s));
    const play = playFromShape(c.sh, c.x.s, c.id);
    assert.equal(play.url, want);
    assert.equal(approvedAudioUrl(play.url), want);
    assert.equal(approvedAudioUrl(want.slice(AUDIO_ORIGIN.length)), want, 'the relative form resolves to the same address');
    assert.equal(fileShape(fileFromShape(c.sh, c.x.s), c.x.s).urlPath, c.sh.urlPath);
  }
  // AC13: a first ayah that starts after 0 ms. Nothing is marked before its start, ayah 1 from it,
  // the last ayah until its end, nothing after.
  const late = all.filter((c) => c.sh.first && c.sh.first[0] > 0 && c.x.ok);
  assert.ok(late.length >= 1, `${label}: a passing file whose first ayah starts after 0 ms`);
  for (const c of late) {
    const t = playFromShape(c.sh, c.x.s, c.id).t as [number, number][];
    const [f0, f1] = c.sh.first!, [, l1] = c.sh.last!;
    assert.deepEqual(t[0], [f0, f1]);
    assert.equal(ayahAt(t, 0), 0);
    assert.equal(ayahAt(t, f0 - 1), 0);
    assert.equal(ayahAt(t, f0), 1);
    assert.equal(ayahAt(t, l1 - 1), t.length);
    assert.equal(ayahAt(t, l1), 0);
  }
}

test('recorded shape: the kinds of case Hamzeh\'s data shows, with the values read from the fixture', { skip }, () => {
  checkKinds(cases(), 'recorded');
  // A passing file whose last ayah ends before the duration (negative end minus duration).
  assert.ok(cases().some((c) => c.x.ok && (c.sh.lastEndMinusDuration ?? 0) < 0));
});

// Made-up values of the same kinds (D-133 A): no value here comes from Quran Foundation.
test('made-up shapes: double-slash address, late first ayah, overruns under and over the allowance, odd sizes, an overlap', () => {
  const base = (o: Partial<RecordedShape>): RecordedShape => ({
    keys: ['audio_url', 'chapter_id', 'duration', 'file_size', 'format', 'id', 'timestamps'], format: 'mp3', fileSize: 811520, duration: 41000,
    types: { file_size: 'number', duration: 'number', audio_url: 'string', timestamps: 'array' },
    urlPath: 'https://download.quranicaudio.com/mock-made-up/reciter_x/{s}.mp3', urlHasQuery: false, entries: 7,
    entryKeys: ['duration', 'segments', 'timestamp_from', 'timestamp_to', 'verse_key'], first: [0, 5210], last: [29870, 41000], lastEndMinusDuration: 0, ...o,
  });
  const fin = (sh: RecordedShape) => ({ ...sh, lastEndMinusDuration: overrun(sh) });
  const made: { id: number; s: number; sh: RecordedShape; problems?: string[]; negatives?: number }[] = [
    { id: 1, s: 1, sh: fin(base({ last: [29870, 41380] })) },
    { id: 2, s: 1, sh: fin(base({ last: [29870, 42230] })) },
    { id: 3, s: 1, sh: fin(base({ fileSize: 512.25, duration: 39000, last: [28000, 38800] })) },
    { id: 3, s: 2, sh: fin(base({ fileSize: 4096, duration: 9381000, entries: 286, first: [0, 6620], last: [9330400, 9380700] })) },
    { id: 4, s: 2, sh: fin(base({ fileSize: 200400000, duration: 8020000, entries: 286, first: [0, 6100], last: [7960000, 8020300] })), problems: ['entry 17: starts before the previous one ends'] },
    { id: 5, s: 2, sh: fin(base({ fileSize: 116214080, duration: 7162000, entries: 286, urlPath: 'https://download.quranicaudio.com/quran/mock_made_up_reciter//{s}.mp3', first: [2740, 11980], last: [7100500, 7161300] })) },
  ];
  const all: Case[] = made.map((m) => {
    const f = fileFromShape(m.sh, m.s, m.problems ?? [], m.negatives ?? 0);
    const c = checkSurahFile({ audio_file: f }, m.s, m.sh.entries ?? 0);
    assert.deepEqual(c.shape, m.sh, `${m.id}:${m.s} shape round trip`);
    return { id: m.id, x: { s: m.s, ok: c.ok, problems: c.problems, negatives: c.negatives, shape: m.sh }, sh: m.sh };
  });
  checkKinds(all, 'made-up');
  assert.equal(all[0].x.ok, true, 'overrun 380 ms on a whole-second duration passes');
  assert.deepEqual(all[1].x.problems, ['last entry ends after the file (by 1230 ms; duration 41000 ms)']);
  assert.deepEqual(all[4].x.problems, ['entry 17: starts before the previous one ends']);
  assert.equal(all[5].x.ok, true);
  assert.equal(all[5].sh.lastEndMinusDuration, -700);
  assert.equal(playFromShape(all[5].sh, 2, 5).url, 'https://download.quranicaudio.com/quran/mock_made_up_reciter//2.mp3');
});
