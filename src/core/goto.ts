// RQ-008 Go to (kit v39, stage 3, AC59 to AC69, D-190 C). Direct results worked out in the browser
// from build data only (AC64): nothing typed is sent anywhere or stored (AC67). Word search is a
// separate, explicit step (AC66, the Search island's POST /api/search).
// Rules, in this order:
// - At most 100 characters (MAX_CHARS, RQ-002).
// - The juz keyword and a number (AC63): the Arabic keyword, with or without its article, in both
//   interfaces; "juz N" (Latin) in the English interface only (D-190 C). The keyword is the
//   kindJuz string of strings.ts in its search form, so no Arabic is written here. 1 to 30 gives a
//   juz result (D-090: the first ayah of that juz in the file); any other number gives juzMissing.
// - A reference S or S:A in any digit form (AC60, the shared parseRef, D-050, D-064, D-072): a valid
//   ayah gives an ayah result and its surah result; a valid surah a surah result; out of range,
//   refMissing. A bare number is always a surah (D-064).
// - Latin letters: in the Arabic interface, the D-050 message latinOnly (AC61); in the English
//   interface, English names by the D-091 rule (D-190 C).
// - A surah name followed by a number (AC62): an ayah result for each matching surah that has that
//   ayah; none, refMissing.
// - A surah name (AC61): the shared matchSurahNames (D-064 as changed by D-092, D-105), source order.
import { asciiDigits, MAX_CHARS, parseRef } from './query.ts';
import { foldNameQuery, matchSurahNames, matchSurahNamesEn } from './surah-match.ts';
import { t, type Lang } from './strings.ts';

export type GotoResult =
  | { kind: 'ayah'; s: number; a: number }
  | { kind: 'surah'; s: number }
  | { kind: 'juz'; j: number; s: number; a: number };
export type GotoMsg = 'refMissing' | 'juzMissing' | 'latinOnly' | 'tooLong' | null;
export type GotoOut = { results: GotoResult[]; msg: GotoMsg };

export type GotoData = {
  lang: Lang;
  // folded[s]: the search form of surah s's Arabic name (index 0 unused), as the index filter has it.
  folded: readonly string[];
  // English match keys (enKeys) of each surah; English interface only.
  en?: readonly (readonly [string, string])[];
  // counts[s]: ayah count of surah s (index 0 unused).
  counts: readonly number[];
  // The first ayah of each juz in the file (D-090), by juz number.
  juz: readonly { juz: number; s: number; a: number }[];
};

const LATIN = /\p{Script=Latin}/u;
// The juz keyword in its search form, from strings.ts (Arabic kindJuz), with an optional article.
let juzKey = '';
const AR_ARTICLE = String.fromCodePoint(0x627, 0x644);
function juzWord(): string {
  if (!juzKey) juzKey = foldNameQuery(t('ar', 'kindJuz'));
  return juzKey;
}

function juzNumber(q: string, lang: Lang): number | null {
  const d = asciiDigits(q.trim());
  const m = /^(.*?)\s*(\d{1,4})$/u.exec(d);
  if (!m || !m[1]) return null;
  const word = m[1].trim();
  if (lang === 'en' && /^juz$/i.test(word)) return Number(m[2]);
  if (LATIN.test(word)) return null;
  const f = foldNameQuery(word);
  const k = juzWord();
  return f === k || f === AR_ARTICLE + k ? Number(m[2]) : null;
}

export function gotoResults(q: string, d: GotoData): GotoOut {
  const none: GotoOut = { results: [], msg: null };
  if (!q.trim()) return none;
  if ([...q].length > MAX_CHARS) return { results: [], msg: 'tooLong' };
  const total = d.counts.length - 1;
  const has = (s: number, a?: number) => s >= 1 && s <= total && (a === undefined || (a >= 1 && a <= d.counts[s]));

  const j = juzNumber(q, d.lang);
  if (j !== null) {
    const x = d.juz.find((y) => y.juz === j);
    return x && j >= 1 && j <= 30 ? { results: [{ kind: 'juz', j, s: x.s, a: x.a }], msg: null } : { results: [], msg: 'juzMissing' };
  }

  const r = parseRef(q);
  if (r) {
    if (!has(r.s, r.a)) return { results: [], msg: 'refMissing' };
    return { results: r.a === undefined ? [{ kind: 'surah', s: r.s }] : [{ kind: 'ayah', s: r.s, a: r.a }, { kind: 'surah', s: r.s }], msg: null };
  }

  const latin = LATIN.test(q);
  if (latin && (d.lang !== 'en' || !d.en)) return { results: [], msg: 'latinOnly' };
  const match = (name: string) => (LATIN.test(name) ? matchSurahNamesEn(d.en!, name) : matchSurahNames(d.folded, name));

  // A name followed by an ayah number (AC62).
  const m = /^(.*\S)\s+(\d{1,4})$/u.exec(asciiDigits(q.trim()));
  if (m && !/^\d/.test(m[1])) {
    const a = Number(m[2]);
    const list = match(m[1]);
    if (!list.length) return none;
    const out: GotoResult[] = list.filter((s) => has(s, a)).map((s) => ({ kind: 'ayah', s, a }));
    return out.length ? { results: out, msg: null } : { results: [], msg: 'refMissing' };
  }
  return { results: match(q).map((s) => ({ kind: 'surah', s }) as GotoResult), msg: null };
}
