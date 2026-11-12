// RQ-004 surah index filter (v1.0 decisions). Runs in the browser only: the filter text is never
// sent to a server or stored (P-4, AC16). Input rules are the search rules (D-050, RQ-002 AC15):
// references S or S:A in any digit form (D-064, D-072); Arabic names whole or by their first 2 or
// more letters, also from just after the article (D-064 as changed by D-092; shared with search
// offers so the two agree, AC12); at most 100 characters (P-8). Latin letters: in the English
// interface they match English names (D-091 B, AC13, when `en` keys are given); in the Arabic
// interface they get the Arabic-only message (D-050).
import { parseRef, validate } from './query.ts';
import { matchSurahNames, matchSurahNamesEn } from './surah-match.ts';

export type FilterResult =
  | { kind: 'all' }
  | { kind: 'latin' }
  | { kind: 'too_long' }
  | { kind: 'missing' }
  | { kind: 'ref'; s: number; a?: number }
  | { kind: 'names'; list: number[] };

// folded[s] is the search form of surah s's Arabic name; counts[s] its ayah count; index 0 unused.
// en, when given (English interface only), holds the English match keys of each surah (enKeys).
export function filterIndex(folded: readonly string[], counts: readonly number[], q: string, en?: readonly (readonly [string, string])[]): FilterResult {
  const bad = validate(q);
  if (bad === 'empty') return { kind: 'all' };
  if (bad === 'latin' && en) return { kind: 'names', list: matchSurahNamesEn(en, q) };
  if (bad) return { kind: bad };
  const r = parseRef(q);
  if (r) {
    const n = r.s >= 1 && r.s < counts.length ? counts[r.s] : 0;
    if (!n || (r.a !== undefined && (r.a < 1 || r.a > n))) return { kind: 'missing' };
    return r.a === undefined ? { kind: 'ref', s: r.s } : { kind: 'ref', s: r.s, a: r.a };
  }
  return { kind: 'names', list: matchSurahNames(folded, q) };
}

// Surah numbers to show for a result; null means all rows.
export function visibleRows(r: FilterResult): number[] | null {
  if (r.kind === 'ref') return [r.s];
  if (r.kind === 'names') return r.list;
  if (r.kind === 'missing') return [];
  return null;
}
