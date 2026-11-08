// D-084 (changes D-078): the Tafseer quote check. It finds phrases in ( ), ornate parentheses and
// { }, and matches each against the approved Quran text by letters only. Phrases it cannot match
// go on a list for the D-012 reviewers. It never blocks a release, and the Tafseer text is never
// changed: phrases are read from the passage for the check and the list only.
//
// Letters-only form, applied the same way to a phrase and to the approved ayah text:
//  1. the approved search spelling rules, exactly as search input uses them (foldQuery in
//     variants.ts: D-072, the D-073 rules, D-074 V-14, and the interim mode for the rules awaiting
//     the D-012 reviewer). Alef wasla to alef is already rule V-12 (D-073), so no rule was added;
//  2. then these removals, which D-084 names: harakat, tanween, shadda, sukun and the other marks
//     U+064B to U+065F, superscript alef U+0670, Quranic annotation marks U+0610 to U+061A and
//     U+06D6 to U+06ED, and tatweel U+0640;
//  3. then every character that is not an Arabic letter (digits of any kind, punctuation, Latin,
//     symbols) becomes a space, and spaces collapse. So an ayah number inside a phrase is ignored.
// No Unicode normalization is used.
//
// A phrase matches when its letters-only words appear as consecutive words in the letters-only
// text of the passage's own ayah range; otherwise in the same surah; otherwise anywhere in the
// approved text (consecutive words may run across ayah ends). Results: matched_own_ayah,
// matched_same_surah, matched_elsewhere, unmatched, or too_short (fewer than 2 letters-only words,
// unless it matches its own ayah range). Phrases in { } are labelled qiraah_or_quote: braces also
// mark readings (qira'at) in this Tafseer, so they are listed for reviewers and never count as
// failures. Limits: a phrase outside brackets is not found; a bracketed phrase that is not a quote
// (a gloss, a name) is checked anyway and usually comes out unmatched or too_short; matching by
// letters cannot tell two ayat with the same words apart, and says nothing about meaning.
import { blockText } from './tafseer-html.ts';
import { foldQuery } from './variants.ts';

export const bareAyah = (t: string) => t.replace(/\u00a0[\u0660-\u0669\u06f0-\u06f90-9]+$/u, '');

const cls = (r: [number, number][]) => r.map(([a, b]) => (a === b ? `\\u{${a.toString(16)}}` : `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`)).join('');
// Marks, superscript alef, Quranic annotation marks and tatweel.
// Step 2 removes every combining mark (Unicode general category Mn, which includes U+064B to
// U+065F, U+0670, U+0610 to U+061A, the small high signs and Arabic Extended-A marks such as the
// open tanween U+08F0), every format character (Cf), tatweel, and, as before, the whole range
// U+06D6 to U+06ED (it also holds U+06E5 and U+06E6, small waw and yeh, which are not Mn).
const DROP = new RegExp(`[\\p{Mn}\\p{Cf}${cls([[0x6d6, 0x6ed], [0x640, 0x640]])}]`, 'gu');
// Arabic letters: hamza to ghain, feh to yeh, alef wasla to yeh barree, and the extended letters.
const NOT_LETTER = new RegExp(`[^${cls([[0x621, 0x63a], [0x641, 0x64a], [0x671, 0x6d3], [0x6d5, 0x6d5], [0x6ee, 0x6ef], [0x6fa, 0x6fc], [0x6ff, 0x6ff], [0x750, 0x77f], [0x8a0, 0x8c9]])}]+`, 'gu');

// Step 0 (fix after the first real pre-live run, 2026-11-08): the API writes a standalone
// superscript alef as HAIR SPACE + U+0670 + WORD JOINER, inside the word. Step 3 would turn those
// into spaces and split the word. So, before anything else:
//  a. format and invisible characters are removed (not turned into spaces): U+200B to U+200F,
//     U+2060 to U+2064, U+FEFF, U+00AD, U+034F, U+061C and U+180E;
//  b. a narrow space (U+2000 to U+200A, or U+202F) directly followed by a combining mark (Mn)
//     or a format character (Cf) is removed; any other one stays and becomes a word break.
// This applies to phrases and to the Quran text alike. The Tafseer text itself is never changed,
// and D-079 fingerprints are of the raw delivered bytes.
const INVISIBLE = new RegExp(`[${cls([[0x200b, 0x200f], [0x2060, 0x2064], [0xfeff, 0xfeff], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x180e, 0x180e]])}]`, 'gu');
// The narrow-space rule runs first, before any format character is removed: a narrow space
// directly followed by a combining mark (Mn) or a format character (Cf) is dropped. The API also
// writes HAIR SPACE + WORD JOINER + letter inside a word (seen at 2:72), which the first version
// of this rule missed because the WORD JOINER was not a mark.
const NARROW_BEFORE_MARK = new RegExp(`[${cls([[0x2000, 0x200a], [0x202f, 0x202f]])}](?=[\\p{Mn}\\p{Cf}])`, 'gu');
// Format characters of any kind (category Cf) are removed in step 0 as well, so none can reach
// step 3 and split a word.
const FORMAT = /\p{Cf}/gu;
export const stripInvisibles = (s: string) => s.replace(NARROW_BEFORE_MARK, '').replace(INVISIBLE, '').replace(FORMAT, '');

// Step 1a, hamza composition (encoding equivalence, not a spelling rule). The API's QPC text writes
// some hamza letters as a base letter plus a combining hamza mark, where the approved file uses the
// single hamza letter. Before any mark is removed, on both sides, a base letter followed by a hamza
// mark (U+0654 above or U+0655 below), with other combining marks allowed in between, becomes:
//   alef maqsura U+0649 or yeh U+064A + either hamza mark -> yeh with hamza above U+0626
//   waw U+0648 + either hamza mark                      -> waw with hamza above U+0624
//   alef U+0627 + hamza above U+0654                    -> alef with hamza above U+0623
//   alef U+0627 + hamza below U+0655                    -> alef with hamza below U+0625
// The marks in between are kept (step 2 removes them). Only yeh + U+0654, waw + U+0654, alef +
// U+0654 and alef + U+0655 are canonical equivalents in Unicode; alef maqsura as the base and a
// hamza BELOW on yeh or waw are not, and are composed because the API writes the yeh seat that way.
const HAMZA_SEAT = new RegExp(`([${cls([[0x627, 0x627], [0x648, 0x648], [0x649, 0x64a]])}])(\\p{Mn}*?)([${cls([[0x654, 0x655]])}])`, 'gu');
export function composeHamza(s: string): string {
  return s.replace(HAMZA_SEAT, (_m, base: string, mid: string, hamza: string) => {
    const to = base === '\u0627' ? (hamza === '\u0654' ? '\u0623' : '\u0625') : base === '\u0648' ? '\u0624' : '\u0626';
    return to + mid;
  });
}

export function lettersOnlyWords(s: string): string[] {
  return foldQuery(composeHamza(stripInvisibles(s))).replace(DROP, '').replace(NOT_LETTER, ' ').trim().split(' ').filter(Boolean);
}
export const lettersOnly = (s: string) => lettersOnlyWords(s).join(' ');

export type Bracket = '()' | '\ufd3f\ufd3e' | '{}';
export type Phrase = { bracket: Bracket; label: 'quote' | 'qiraah_or_quote'; text: string; unclosed?: boolean };
const PAIRS: [string, string, Bracket][] = [['(', ')', '()'], ['\ufd3f', '\ufd3e', '\ufd3f\ufd3e'], ['\ufd3e', '\ufd3f', '\ufd3f\ufd3e'], ['{', '}', '{}']];

// Bracketed phrases of one passage in reading order, read from its displayed text (markup
// removed, entities decoded), never across a paragraph. The text is kept exactly as delivered.
export function findPhrases(html: string): Phrase[] {
  const t = blockText(html);
  const out: Phrase[] = [];
  let i = 0;
  while (i < t.length) {
    const p = PAIRS.find(([o]) => o === t[i]);
    if (!p) { i++; continue; }
    let j = i + 1;
    while (j < t.length && t[j] !== p[1] && t[j] !== '\n') j++;
    const label = p[2] === '{}' ? 'qiraah_or_quote' : 'quote';
    if (j < t.length && t[j] === p[1]) { out.push({ bracket: p[2], label, text: t.slice(i + 1, j) }); i = j + 1; }
    else { out.push({ bracket: p[2], label, text: t.slice(i + 1, j), unclosed: true }); i = j; }
  }
  return out;
}

export type Result = 'matched_own_ayah' | 'matched_same_surah' | 'matched_elsewhere' | 'unmatched' | 'too_short' | 'fragment';
export type MatchType = 'exact' | 'edge' | null;

// The approved text in letters-only form, one string per ayah, in source order, in two forms:
// "uthmani" from aya_text, and (D-085) "emlaey" from aya_text_emlaey, the plain-spelling text
// stored in the same approved file. The emlaey text is used only for matching: it is never shown,
// and only its letters-only form goes into a build (private builds only). While the file is the
// D-045 development copy, the D-045 caution applies to both forms.
export type Form = 'uthmani' | 'emlaey';
type FormIndex = { letters: string[]; surahText: Map<number, string>; all: string };
export type LettersIndex = { refs: string[]; surah: number[]; at: Map<string, number>; forms: Partial<Record<Form, FormIndex>> };
// Kept for callers of the first version: the Uthmani letters per ayah.
export const uthmaniLetters = (ix: LettersIndex) => ix.forms.uthmani?.letters ?? [];

function formIndex(rows: { s: number }[], letters: string[]): FormIndex {
  const bySurah = new Map<number, string[]>();
  rows.forEach((r, i) => { if (!bySurah.has(r.s)) bySurah.set(r.s, []); if (letters[i]) bySurah.get(r.s)!.push(letters[i]); });
  const surahText = new Map<number, string>();
  for (const [s, l] of bySurah) surahText.set(s, ' ' + l.join(' ') + ' ');
  return { letters, surahText, all: ' ' + letters.filter(Boolean).join(' ') + ' ' };
}

export function lettersIndex(rows: { s: number; a: number; letters: string; emlaey?: string }[]): LettersIndex {
  const at = new Map<string, number>();
  rows.forEach((r, i) => at.set(`${r.s}:${r.a}`, i));
  const forms: Partial<Record<Form, FormIndex>> = { uthmani: formIndex(rows, rows.map((r) => r.letters)) };
  if (rows.some((r) => typeof r.emlaey === 'string' && r.emlaey)) forms.emlaey = formIndex(rows, rows.map((r) => r.emlaey ?? ''));
  return { refs: rows.map((r) => `${r.s}:${r.a}`), surah: rows.map((r) => r.s), at, forms };
}

export const indexFromSource = (list: { sora: number; aya_no: number; aya_text: string; aya_text_emlaey?: string }[]) =>
  lettersIndex(list.map((x) => ({ s: x.sora, a: x.aya_no, letters: lettersOnly(bareAyah(x.aya_text)), emlaey: typeof x.aya_text_emlaey === 'string' ? lettersOnly(x.aya_text_emlaey) : undefined })));

export type MatchedForm = 'uthmani' | 'emlaey' | 'both' | null;

// D-088 (may be reopened after both D-012 reviewers review): when a quote starts or ends with a
// split-off letter, as Jalalayn writes (one bracket around a separated "and" or question alef,
// then the rest), its first and last words may match part of a Quran word: the first word may be
// the end of the aligned Quran word and the last word its start. Every other word must match
// exactly. This applies to phrases of 2 or more letters-only words. A phrase of at most 2 letters
// in all (a one-letter piece, or a two-letter split piece) is a "fragment": counted, but left off
// the reviewers' list, unless it matches whole words of its own ayah range. Braces are still
// always listed (a one-letter reading can matter).
// At each level (own ayah range, same surah, anywhere) an exact match is tried first, then an
// edge match; the first level that matches decides the result. `form` says which form(s) matched
// there, and `match` whether it was exact or edge.
export const FRAGMENT_MAX_LETTERS = 2;

export function matchPhrase(ix: LettersIndex, phrase: string, own: { s: number; from: number; to: number }): { letters: string; words: number; result: Result; form: MatchedForm; match: MatchType } {
  const words = lettersOnlyWords(phrase);
  const letters = words.join(' ');
  const out = (result: Result, form: MatchedForm = null, match: MatchType = null) => ({ letters, words: words.length, result, form, match });
  if (!words.length) return out('too_short');
  const exact = ' ' + letters + ' ';
  const forms = (Object.entries(ix.forms) as [Form, FormIndex][]);
  const at = (test: (f: FormIndex) => string | undefined, needle: string): MatchedForm => {
    const hit = forms.filter(([, f]) => (test(f) ?? '').includes(needle)).map(([k]) => k);
    return hit.length === 2 ? 'both' : hit.length === 1 ? hit[0] : null;
  };
  const ownText = (f: FormIndex) => {
    const parts: string[] = [];
    for (let a = own.from; a <= own.to; a++) { const i = ix.at.get(`${own.s}:${a}`); if (i !== undefined && f.letters[i]) parts.push(f.letters[i]); }
    return ' ' + parts.join(' ') + ' ';
  };
  const levels: [Result, (f: FormIndex) => string | undefined][] = [
    ['matched_own_ayah', ownText], ['matched_same_surah', (f) => f.surahText.get(own.s)], ['matched_elsewhere', (f) => f.all],
  ];
  const total = words.reduce((n, w) => n + [...w].length, 0);
  // Whole words of the own ayah range always count, even for a short phrase.
  const ownExact = at(ownText, exact);
  if (ownExact) return out('matched_own_ayah', ownExact, 'exact');
  if (total <= FRAGMENT_MAX_LETTERS) return out('fragment');
  if (words.length < 2) return out('too_short');
  // Edge needle: no space before the first word or after the last, so the first word may be the
  // end of a Quran word and the last word the start of one; inner spaces keep every other word whole.
  for (const [result, text] of levels) {
    const e = result === 'matched_own_ayah' ? null : at(text, exact);
    if (e) return out(result, e, 'exact');
    const g = at(text, letters);
    if (g) return out(result, g, 'edge');
  }
  return out('unmatched');
}

export type ReviewItem = { ref: string; range: string; bracket: Bracket; label: Phrase['label']; phrase: string; letters: string; result: Result; form: MatchedForm; match: MatchType; unclosed?: boolean };
export type QuoteSummary = { phrases: number; byResult: Record<Result, number>; braces: number; unclosed: number; edgeMatches: number };

export const emptyCounts = (): Record<Result, number> => ({ matched_own_ayah: 0, matched_same_surah: 0, matched_elsewhere: 0, unmatched: 0, too_short: 0, fragment: 0 });

// Checks one passage. Every phrase is counted; the reviewer list holds every phrase that did not
// match its own ayah range, except fragments (D-088), plus every phrase in braces and every
// unclosed bracket. Edge matches count as matched at their level; match says exact or edge.
export function checkPassage(ix: LettersIndex, html: string, own: { s: number; from: number; to: number }, ref: string, sum: QuoteSummary, list: ReviewItem[]) {
  for (const p of findPhrases(html)) {
    const m = matchPhrase(ix, p.text, own);
    sum.phrases++;
    sum.byResult[m.result]++;
    if (p.label === 'qiraah_or_quote') sum.braces++;
    if (p.unclosed) sum.unclosed++;
    if (m.match === 'edge') sum.edgeMatches++;
    const listed = p.label === 'qiraah_or_quote' || p.unclosed || (m.result !== 'matched_own_ayah' && m.result !== 'fragment');
    if (listed) {
      list.push({ ref, range: `${own.s}:${own.from}-${own.to}`, bracket: p.bracket, label: p.label, phrase: p.text, letters: m.letters, result: m.result, form: m.form, match: m.match, ...(p.unclosed ? { unclosed: true } : {}) });
    }
  }
}

export const newSummary = (): QuoteSummary => ({ phrases: 0, byResult: emptyCounts(), braces: 0, unclosed: 0, edgeMatches: 0 });

export { reviewCsv } from './review-csv.ts';

// by_chapter returns one record per ayah. Neighbouring records of one surah with byte-identical
// text are taken as one passage covering those ayat (the same rule as the by_ayah parser), which
// gives each passage its own ayah range for matching. Each passage is checked once.
export function chapterPassages(items: { verse_key: string; text: string }[]): { ref: string; s: number; from: number; to: number; text: string }[] {
  const rows = items.map((x) => { const m = /^(\d+):(\d+)$/.exec(x.verse_key); return m ? { s: Number(m[1]), a: Number(m[2]), text: x.text } : null; })
    .filter((x): x is { s: number; a: number; text: string } => !!x && x.text.length > 0)
    .sort((x, y) => x.s - y.s || x.a - y.a);
  const out: { ref: string; s: number; from: number; to: number; text: string }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.s === r.s && last.to === r.a - 1 && last.text === r.text) { last.to = r.a; continue; }
    out.push({ ref: `${r.s}:${r.a}`, s: r.s, from: r.a, to: r.a, text: r.text });
  }
  return out;
}
