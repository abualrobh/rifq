// Adds up the AC70 in-place mode counts (QA v26 FIND-L) written by test/e2e/helpers.ts.
// Usage: node scripts/inplace-summary.ts <build>/reports/inplace-counts-<run>.jsonl
// Prints counts only (test titles of the tests that did not end with the "still playing" check).
import { readFileSync } from 'node:fs';

type Row = { file: string; title: string; primed: boolean; primes: number; inPlacePlaying: number; inPlaceSilent: number; fellBack: number; keptFull: Record<string, number>; end: string };
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
const ends: Record<string, number> = {};
for (const r of rows) ends[r.end] = (ends[r.end] ?? 0) + 1;
const kept: Record<string, number> = {};
for (const r of rows) for (const [k, v] of Object.entries(r.keptFull)) kept[k] = (kept[k] ?? 0) + v;
console.log(JSON.stringify({
  tests: rows.length, primed: rows.filter((r) => r.primed).length, primes: sum((r) => r.primes),
  inPlaceChangesPlaying: sum((r) => r.inPlacePlaying), inPlaceChangesSilent: sum((r) => r.inPlaceSilent), fellBackToFullLoad: sum((r) => r.fellBack),
  gotosKeptFull: kept, end: ends,
  notEndingWithStillPlayingCheck: rows.filter((r) => r.primed && r.end !== 'checked-playing').map((r) => `${r.file}: ${r.title.slice(0, 60)} (${r.end})`),
  silentChanges: rows.filter((r) => r.inPlaceSilent > 0).map((r) => `${r.file}: ${r.title.slice(0, 60)} (${r.inPlaceSilent})`),
}, null, 1));
