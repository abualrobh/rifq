// D-125 B: test fixtures built from Hamzeh's real pre-live "Record shape" block of /dev/reciters/
// (13 Nov). The block holds types, keys, counts, durations, file sizes, the first and last
// [timestamp_from, timestamp_to] and the address path with {s} for the surah, per reciter and surah.
// It is Quran Foundation audio metadata, so it is not in this public repository (AC35, D-039): it is
// read from the private data folder named by RIFQ_AUDIO_SHAPE. Tests that need it are skipped with a
// note when it is not given.
//
// fileFromShape() makes one QF-shaped surah-file answer from a recorded shape: the same keys, types,
// format, file_size, duration and address (the path as recorded, with the surah number put back),
// the same number of entries with the recorded first and last timing, and the recorded entry keys.
// Only the timings between the first and the last entry are made up (evenly spaced, in order); an
// overlap is placed at the entry the recorded check names (read from the fixture), and negative
// per-entry durations as many as recorded. Word segments are empty (no words are known or needed).
import { existsSync, readFileSync } from 'node:fs';

export type RecordedShape = {
  keys: string[]; format: unknown; fileSize: unknown; duration: unknown; types: Record<string, string>;
  urlPath: string | null; urlHasQuery: boolean; entries: number | null; entryKeys: string[];
  first: [number, number] | null; last: [number, number] | null; lastEndMinusDuration: number | null;
};
export type RecordedSurah = { s: number; ok: boolean; problems: string[]; negatives: number; shape: RecordedShape | null };
export type RecordedReciter = { id: number; catalogue: string[] | string; surahs: RecordedSurah[] };
export type Recorded = { env: string; reciters: RecordedReciter[] };

export const RECORDED_PATH = process.env.RIFQ_AUDIO_SHAPE ?? '';
export function loadRecorded(path = RECORDED_PATH): Recorded | null {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Recorded;
}

export function fileFromShape(sh: RecordedShape, s: number, problems: string[] = [], negatives = 0): Record<string, unknown> {
  const n = sh.entries ?? 0;
  const [f0, f1] = sh.first ?? [0, 0];
  const [l0, l1] = sh.last ?? [0, 0];
  const t: [number, number][] = [];
  if (n >= 1) t.push([f0, f1]);
  const inner = n - 2;
  for (let k = 0; k < inner; k++) t.push([f1 + Math.round((k * (l0 - f1)) / inner), f1 + Math.round(((k + 1) * (l0 - f1)) / inner)]);
  if (n >= 2) t.push([l0, l1]);
  for (const p of problems) {
    const m = /^entry (\d+): starts before the previous one ends$/.exec(p);
    if (m) { const i = Number(m[1]) - 1; t[i] = [t[i - 1][1] - 100, t[i][1]]; }
  }
  const timestamps = t.map(([from, to], i) => {
    const e: Record<string, unknown> = { verse_key: `${s}:${i + 1}`, timestamp_from: from, timestamp_to: to, duration: i < negatives ? from - to : to - from, segments: [] };
    return Object.fromEntries(sh.entryKeys.map((k) => [k, e[k]]));
  });
  const all: Record<string, unknown> = {
    id: 900000 + s, chapter_id: s, file_size: sh.fileSize, format: sh.format, duration: sh.duration,
    audio_url: sh.urlPath ? sh.urlPath.replace('{s}', String(s)) : null, timestamps,
  };
  return Object.fromEntries(sh.keys.map((k) => [k, all[k]]));
}

// The player answer (/api/audio) the Worker would give for a recorded shape.
export function playFromShape(sh: RecordedShape, s: number, r: number) {
  const f = fileFromShape(sh, s);
  return { status: 'ok', r, s, url: f.audio_url, duration: f.duration, t: (f.timestamps as { timestamp_from: number; timestamp_to: number }[]).map((e) => [e.timestamp_from, e.timestamp_to]) };
}
