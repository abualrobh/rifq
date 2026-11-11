// Search API used by the Worker. It wraps the round 4 matcher with the D-050 input rules and the
// RQ-002 AC13 surah and ayah offers. Queries use the search form of variants.ts (D-072, D-073).
// It stores nothing and logs nothing.
import { foldQuery } from './variants.ts';
import { search, surahName, surahNameEn, type Index, type SearchOut } from './search-core.ts';
import { parseRef, validate } from './query.ts';
import { matchSurahNames } from './surah-match.ts';
export { parseRef, validate, asciiDigits } from './query.ts';

export const MAX_BODY = 2048;

// name is the Arabic surah name and en the English one, both as stored in the source.
export type Offer =
  | { kind: 'surah'; s: number; name: string; en: string }
  | { kind: 'ayah'; s: number; a: number; name: string; en: string };
export type SearchOk = SearchOut & { offers: Offer[]; ref: 'none' | 'found' | 'missing' };
export type SearchErr = { error: 'empty' | 'too_long' | 'latin' | 'bad_json' | 'rate_limited' | 'method' | 'not_found' | 'bad_length' | 'unsupported_type' | 'cross_site' | 'unavailable' };
export type ApiOut = { status: number; data: SearchOk | SearchErr };

type Lazy = { counts: number[]; folded: string[] };
const lazy = new WeakMap<Index, Lazy>();
function meta(ix: Index): Lazy {
  let v = lazy.get(ix);
  if (!v) {
    const counts = new Array(ix.nSurah + 1).fill(0);
    for (let i = 0; i < ix.nAyah; i++) counts[ix.ayahSurah[i]]++;
    const folded = [''];
    for (let s = 1; s <= ix.nSurah; s++) folded.push(foldQuery(surahName(ix, s)));
    v = { counts, folded };
    lazy.set(ix, v);
  }
  return v;
}

export function ayahCount(ix: Index, s: number): number {
  return s >= 1 && s <= ix.nSurah ? meta(ix).counts[s] : 0;
}

// Surah names in Arabic: the whole name, or the start of the name, after applying the search form
// to both sides. At least two letters are needed for a start-of-name match (D-064).
export function offers(ix: Index, q: string): { offers: Offer[]; ref: SearchOk['ref'] } {
  const r = parseRef(q);
  if (r) {
    const n = ayahCount(ix, r.s);
    if (!n || (r.a !== undefined && (r.a < 1 || r.a > n))) return { offers: [], ref: 'missing' };
    const name = surahName(ix, r.s), en = surahNameEn(ix, r.s);
    return { offers: [r.a === undefined ? { kind: 'surah', s: r.s, name, en } : { kind: 'ayah', s: r.s, a: r.a, name, en }], ref: 'found' };
  }
  // Shared with the surah index filter (RQ-004 AC12), so index and search never disagree.
  const out: Offer[] = matchSurahNames(meta(ix).folded, q).map((s) => ({ kind: 'surah', s, name: surahName(ix, s), en: surahNameEn(ix, s) }));
  return { offers: out, ref: 'none' };
}

export function runQuery(ix: Index, q: unknown, page: unknown): ApiOut {
  const bad = validate(q);
  if (bad) return { status: 400, data: { error: bad } };
  const p = Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
  const res = search(ix, q as string, p);
  const o = offers(ix, q as string);
  return { status: 200, data: { ...res, offers: p === 1 ? o.offers : [], ref: o.ref } };
}

export function handleJson(ix: Index, raw: string): ApiOut {
  if (raw.length > MAX_BODY) return { status: 413, data: { error: 'too_long' } };
  let b: any;
  try { b = JSON.parse(raw); } catch { return { status: 400, data: { error: 'bad_json' } }; }
  return runQuery(ix, b?.q, b?.page);
}
