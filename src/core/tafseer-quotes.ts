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
const DROP = new RegExp(`[${cls([[0x64b, 0x65f], [0x670, 0x670], [0x610, 0x61a], [0x6d6, 0x6ed], [0x640, 0x640]])}]`, 'gu');
// Arabic letters: hamza to ghain, feh to yeh, alef wasla to yeh barree, and the extended letters.
const NOT_LETTER = new RegExp(`[^${cls([[0x621, 0x63a], [0x641, 0x64a], [0x671, 0x6d3], [0x6d5, 0x6d5], [0x6ee, 0x6ef], [0x6fa, 0x6fc], [0x6ff, 0x6ff], [0x750, 0x77f], [0x8a0, 0x8c9]])}]+`, 'gu');

// Step 0 (fix after the first real pre-live run, 2026-11-08): the API writes a standalone
// superscript alef as HAIR SPACE + U+0670 + WORD JOINER, inside the word. Step 3 would turn those
// into spaces and split the word. So, before anything else:
//  a. format and invisible characters are removed (not turned into spaces): U+200B to U+200F,
//     U+2060 to U+2064, U+FEFF, U+00AD, U+034F, U+061C and U+180E;
//  b. a narrow space (U+2000 to U+200A, or U+202F) directly followed by a combining mark
//     (Unicode category Mn) is removed; any other one stays and becomes a word break in step 3.
// This applies to phrases and to the Quran text alike. The Tafseer text itself is never changed,
// and D-079 fingerprints are of the raw delivered bytes.
const INVISIBLE = new RegExp(`[${cls([[0x200b, 0x200f], [0x2060, 0x2064], [0xfeff, 0xfeff], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x180e, 0x180e]])}]`, 'gu');
const NARROW_BEFORE_MARK = new RegExp(`[${cls([[0x2000, 0x200a], [0x202f, 0x202f]])}](?=\\p{Mn})`, 'gu');
export const stripInvisibles = (s: string) => s.replace(INVISIBLE, '').replace(NARROW_BEFORE_MARK, '');

export function lettersOnlyWords(s: string): string[] {
  return foldQuery(stripInvisibles(s)).replace(DROP, '').replace(NOT_LETTER, ' ').trim().split(' ').filter(Boolean);
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

export type Result = 'matched_own_ayah' | 'matched_same_surah' | 'matched_elsewhere' | 'unmatched' | 'too_short';

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

// A level (own ayah range, same surah, anywhere) matches if the phrase matches it in either form;
// the first level that matches decides the result, and `form` says which form(s) matched there.
export function matchPhrase(ix: LettersIndex, phrase: string, own: { s: number; from: number; to: number }): { letters: string; words: number; result: Result; form: MatchedForm } {
  const words = lettersOnlyWords(phrase);
  const letters = words.join(' ');
  if (!words.length) return { letters, words: 0, result: 'too_short', form: null };
  const needle = ' ' + letters + ' ';
  const forms = (Object.entries(ix.forms) as [Form, FormIndex][]);
  const at = (test: (f: FormIndex) => boolean): MatchedForm => {
    const hit = forms.filter(([, f]) => test(f)).map(([k]) => k);
    return hit.length === 2 ? 'both' : hit.length === 1 ? hit[0] : null;
  };
  const ownText = (f: FormIndex) => {
    const parts: string[] = [];
    for (let a = own.from; a <= own.to; a++) { const i = ix.at.get(`${own.s}:${a}`); if (i !== undefined && f.letters[i]) parts.push(f.letters[i]); }
    return ' ' + parts.join(' ') + ' ';
  };
  let f = at((x) => ownText(x).includes(needle));
  if (f) return { letters, words: words.length, result: 'matched_own_ayah', form: f };
  if (words.length < 2) return { letters, words: words.length, result: 'too_short', form: null };
  f = at((x) => (x.surahText.get(own.s) ?? '').includes(needle));
  if (f) return { letters, words: words.length, result: 'matched_same_surah', form: f };
  f = at((x) => x.all.includes(needle));
  if (f) return { letters, words: words.length, result: 'matched_elsewhere', form: f };
  return { letters, words: words.length, result: 'unmatched', form: null };
}

export type ReviewItem = { ref: string; range: string; bracket: Bracket; label: Phrase['label']; phrase: string; letters: string; result: Result; form: MatchedForm; unclosed?: boolean };
export type QuoteSummary = { phrases: number; byResult: Record<Result, number>; braces: number; unclosed: number };

export const emptyCounts = (): Record<Result, number> => ({ matched_own_ayah: 0, matched_same_surah: 0, matched_elsewhere: 0, unmatched: 0, too_short: 0 });

// Checks one passage. Every phrase is counted; the reviewer list holds every phrase that did not
// match its own ayah range, every phrase in braces, and every unclosed bracket.
export function checkPassage(ix: LettersIndex, html: string, own: { s: number; from: number; to: number }, ref: string, sum: QuoteSummary, list: ReviewItem[]) {
  for (const p of findPhrases(html)) {
    const m = matchPhrase(ix, p.text, own);
    sum.phrases++;
    sum.byResult[m.result]++;
    if (p.label === 'qiraah_or_quote') sum.braces++;
    if (p.unclosed) sum.unclosed++;
    if (m.result !== 'matched_own_ayah' || p.label === 'qiraah_or_quote' || p.unclosed) {
      list.push({ ref, range: `${own.s}:${own.from}-${own.to}`, bracket: p.bracket, label: p.label, phrase: p.text, letters: m.letters, result: m.result, form: m.form, ...(p.unclosed ? { unclosed: true } : {}) });
    }
  }
}

export const newSummary = (): QuoteSummary => ({ phrases: 0, byResult: emptyCounts(), braces: 0, unclosed: 0 });

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
