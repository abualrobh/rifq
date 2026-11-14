// D-125 B: the audio checks against fixtures built from the real pre-live Record shape (13 Nov),
// read from private data (RIFQ_AUDIO_SHAPE; see test/fixtures/recorded-audio.ts). Skipped when it is
// not given. D-132: the AC60 whole-second allowance (an overrun under 1000 ms when the duration is a
// whole number of seconds) is approved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedAudioUrl, ayahAt, checkSurahFile, fileShape } from '../../src/core/audio.ts';
import { fileFromShape, loadRecorded, playFromShape, RECORDED_PATH } from '../fixtures/recorded-audio.ts';

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

test('recorded shape: the cases Hamzeh\'s data shows', { skip }, () => {
  const get = (id: number, s: number) => rec!.reciters.find((r) => r.id === id)!.surahs.find((x) => x.s === s)!;
  // D-132: Alafasy's last ayah ends 490 ms and 120 ms after the whole-second duration: passes.
  assert.equal(get(7, 1).ok, true);
  assert.equal(get(7, 2).shape!.lastEndMinusDuration, 120);
  // Tunaiji surah 1 overruns by 1050 ms: over the allowance, fails as AC60 says.
  assert.deepEqual(get(161, 1).problems, ['last entry ends after the file (by 1050 ms; duration 46000 ms)']);
  // Husary: file sizes 371.65 and 2048 fail AC61 (D-122 A).
  assert.equal(get(6, 1).shape!.fileSize, 371.65);
  assert.equal(get(6, 2).shape!.fileSize, 2048);
  assert.equal(get(6, 1).ok || get(6, 2).ok, false);
  // Abdul Basit surah 2: entry 26 overlaps (D-119 A).
  assert.deepEqual(get(2, 2).problems, ['entry 26: starts before the previous one ends']);
  // Dossari: a double slash in the path, a negative end-minus-duration, and surah 2's first ayah
  // starting at 3151 ms. The address is used exactly as given (AC55, AC56), double slash included.
  const d = get(97, 2);
  assert.equal(d.shape!.urlPath, 'https://download.quranicaudio.com/quran/yasser_ad-dussary//{s}.mp3');
  assert.equal(d.shape!.lastEndMinusDuration, -462);
  const play = playFromShape(d.shape!, 2, 97);
  assert.equal(play.url, 'https://download.quranicaudio.com/quran/yasser_ad-dussary//2.mp3');
  assert.equal(approvedAudioUrl(play.url), play.url);
  assert.equal(approvedAudioUrl('/quran/yasser_ad-dussary//2.mp3'), 'https://download.quranicaudio.com/quran/yasser_ad-dussary//2.mp3');
  // The record shape keeps the double slash too (only the file name is templated).
  assert.equal(fileShape(fileFromShape(d.shape!, 2), 2).urlPath, d.shape!.urlPath);
  // A non-zero first start: nothing is marked before 3151 ms; ayah 1 from 3151 ms (AC13).
  const t = play.t as [number, number][];
  assert.deepEqual(t[0], [3151, 13175]);
  assert.equal(ayahAt(t, 0), 0);
  assert.equal(ayahAt(t, 3150), 0);
  assert.equal(ayahAt(t, 3151), 1);
  assert.equal(ayahAt(t, 7246537), 286);
  assert.equal(ayahAt(t, 7246538), 0);
});
