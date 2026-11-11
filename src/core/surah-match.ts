// Surah name matching shared by search offers (RQ-002 AC13, in the Worker) and the surah index
// filter (RQ-004 AC12, in the browser), so the two can never disagree. D-064: a name matches whole,
// or by its start with 2 or more letters, after the search form (D-072, D-073) is applied to both
// sides. The start is the start of the full name (D-092 option A, the default pending Hamzeh).
// `folded` holds the search form of each Arabic name as stored in the source, index 0 unused.
import { foldQuery } from './variants.ts';

export const foldName = foldQuery;

// The query in its matching form: search form applied, runs of spaces joined by one space.
export function foldNameQuery(q: string): string {
  return foldQuery(q).trim().split(/\s+/).join(' ');
}

// Surah numbers whose name matches, in source order. An empty query matches nothing.
export function matchSurahNames(folded: readonly string[], q: string): number[] {
  const fq = foldNameQuery(q);
  const out: number[] = [];
  if (!fq) return out;
  const long = [...fq].length >= 2;
  for (let s = 1; s < folded.length; s++) {
    const f = folded[s];
    if (f === fq || (long && f.startsWith(fq))) out.push(s);
  }
  return out;
}
