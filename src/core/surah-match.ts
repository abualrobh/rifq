// Surah name matching shared by search offers (RQ-002 AC13, in the Worker) and the surah index
// filter (RQ-004 AC12, in the browser), so the two can never disagree.
// Arabic (D-064 as changed by D-092): a name matches whole, or by its start with 2 or more letters,
// after the search form (D-072, D-073) is applied to both sides. The start may be the start of the
// full name or the start just after the article (the two letters alef and lam), so the first
// letters of "the cow" without the article find that surah too.
// English (D-091, index filter in the English interface only): the same rule on sora_name_en,
// ignoring case, macrons, dots below, the ‘ ’ marks, hyphens and spaces, and also from just after
// an article such as "Al-", "An-" or "Ash-". English names are only folded for matching; the
// displayed name is always the source bytes.
// `folded` holds the search form of each Arabic name as stored in the source, index 0 unused.
import { foldQuery } from './variants.ts';

export const foldName = foldQuery;
// Alef (U+0627) and lam (U+0644): the Arabic article in the search form. Written as code points,
// because only strings.ts may hold Arabic-script characters.
const AR_ARTICLE = String.fromCodePoint(0x627, 0x644);

// The query in its matching form: search form applied, runs of spaces joined by one space.
export function foldNameQuery(q: string): string {
  return foldQuery(q).trim().split(/\s+/).join(' ');
}

// The name after its article, or '' when it has none (or nothing would be left).
export function afterArticle(folded: string): string {
  return folded.startsWith(AR_ARTICLE) && [...folded].length > 2 ? folded.slice(AR_ARTICLE.length) : '';
}

function matches(fq: string, keys: readonly string[]): boolean {
  const long = [...fq].length >= 2;
  return keys.some((k) => k !== '' && (k === fq || (long && k.startsWith(fq))));
}

// Surah numbers whose Arabic name matches, in source order. An empty query matches nothing.
export function matchSurahNames(folded: readonly string[], q: string): number[] {
  const fq = foldNameQuery(q);
  const out: number[] = [];
  if (!fq) return out;
  for (let s = 1; s < folded.length; s++) if (matches(fq, [folded[s], afterArticle(folded[s])])) out.push(s);
  return out;
}

// English folding for matching only: decompose, drop combining marks (macrons, dots below),
// lower case, keep letters a-z and digits only (drops ‘ ’ marks, hyphens and spaces).
export function foldEn(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Both match keys of an English name: the whole name, and the name after a leading article.
// RQ-004 v1.0 P-11: the article is one of the 9 forms stored in sora_name_en, Al, An, Ar, As,
// Ash, At, Ad, Adh, Az (also with a dot below, as in Aṣ, Aṭ, Aḍ), starting with a plain capital A
// and followed by a hyphen. The whole stored piece before the hyphen is compared, so "Ash-" is
// never read as "As-" (longest form first). A name that starts with another letter, such as
// Ā (U+0100) in surah 3, has no article (D-105 pending; the draft follows option A). On the query
// side a space after the article works like the hyphen, because spaces and hyphens are dropped.
export function enKeys(name: string): [string, string] {
  const m = /^A([^-\s]{1,3})[-\s]/.exec(name);
  const art = m && /^(l|n|r|s|sh|t|d|dh|z)$/.test(foldEn(m[1])) ? foldEn(name.slice(m[0].length)) : '';
  return [foldEn(name), art];
}

// Surah numbers whose English name matches the query, in source order.
export function matchSurahNamesEn(keys: readonly (readonly [string, string])[], q: string): number[] {
  const fq = foldEn(q);
  const out: number[] = [];
  if (!fq) return out;
  for (let s = 1; s < keys.length; s++) if (matches(fq, keys[s])) out.push(s);
  return out;
}
