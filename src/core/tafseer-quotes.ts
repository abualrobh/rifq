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
// unless it matches its own ayah range, exactly or, since kit v30, after an attached letter).
// Phrases in { } are labelled qiraah_or_quote: braces also
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
// A combining hamza that step 1a does not compose onto a seat (for example after tatweel, or after
// a superscript alef) is removed with the other marks in step 2. (v14 turned it into U+0621 for
// 2:72; that was reverted, because the API writes the hamza-with-madda alef, which the file stores
// as alef with hamza above + madda, as tatweel + U+0654 + fatha + alef, and those words then no
// longer matched. 2:72 goes to the reviewers instead.)
// Step 1b (kit v30, 2:72): a hamza above (U+0654) written on a superscript alef (U+0670), with
// other combining marks allowed in between, is the hamza letter U+0621 standing after that
// superscript alef. The API writes 2:72 that way (superscript alef + U+0654 + sukun), where the
// approved file writes superscript alef + U+0621 + sukun; the superscript alef is not a letter in
// letters-only form, so without this the hamza was lost and the quote of 2:72 did not match. The
// approved file (both forms) holds no U+0670 followed by U+0654, so its letters-only form does not
// change (checked on all 6,236 ayat). Only this seat is handled: the tatweel + U+0654 that the API
// writes for the madda alef is left to step 2 as before (see the v14 note above).
const HAMZA_ON_SUPERSCRIPT_ALEF = /\u0670(\p{Mn}*?)\u0654/gu;
export function composeHamza(s: string): string {
  return s.replace(HAMZA_SEAT, (_m, base: string, mid: string, hamza: string) => {
    const to = base === '\u0627' ? (hamza === '\u0654' ? '\u0623' : '\u0625') : base === '\u0648' ? '\u0624' : '\u0626';
    return to + mid;
  }).replace(HAMZA_ON_SUPERSCRIPT_ALEF, (_m, mid: string) => '\u0670' + mid + '\u0621');
}

export function lettersOnlyWords(s: string): string[] {
  return foldQuery(composeHamza(stripInvisibles(s))).replace(DROP, '').replace(NOT_LETTER, ' ').trim().split(' ').filter(Boolean);
}
export const lettersOnly = (s: string) => lettersOnlyWords(s).join(' ');

export type Bracket = '()' | '\ufd3f\ufd3e' | '{}';
export type Phrase = { bracket: Bracket; label: 'quote' | 'qiraah_or_quote'; text: string; unclosed?: boolean };
const PAIRS: [string, string, Bracket][] = [['(', ')', '()'], ['\ufd3f', '\ufd3e', '\ufd3f\ufd3e'], ['\ufd3e', '\ufd3f', '\ufd3f\ufd3e'], ['{', '}', '{}']];
// Kit v32 (reader CPU): the same pairs looked up by opening character (each opens one pair only),
// instead of a search of PAIRS at every character of the passage.
const OPENS = new Map(PAIRS.map((p) => [p[0], p]));

// Bracketed phrases of one passage in reading order, read from its displayed text (markup
// removed, entities decoded), never across a paragraph. The text is kept exactly as delivered.
export function findPhrases(html: string): Phrase[] {
  return phrasesAt(blockText(html)).map(({ start: _s, end: _e, ...p }) => p);
}

// The same scan on text already read with blockText, with each phrase's place in it (D-149
// display): `start` is the index of the opening bracket, `end` the index of the closing bracket
// (for an unclosed phrase, the end of its line). UTF-16 indexes; brackets are single code units.
export type PlacedPhrase = Phrase & { start: number; end: number };
export function phrasesAt(t: string): PlacedPhrase[] {
  const out: PlacedPhrase[] = [];
  let i = 0;
  while (i < t.length) {
    const p = OPENS.get(t[i]);
    if (!p) { i++; continue; }
    let j = i + 1;
    while (j < t.length && t[j] !== p[1] && t[j] !== '\n') j++;
    const label = p[2] === '{}' ? 'qiraah_or_quote' : 'quote';
    if (j < t.length && t[j] === p[1]) { out.push({ bracket: p[2], label, text: t.slice(i + 1, j), start: i, end: j }); i = j + 1; }
    else { out.push({ bracket: p[2], label, text: t.slice(i + 1, j), unclosed: true, start: i, end: j }); i = j; }
  }
  return out;
}

// RQ-007 P-11 (AC34): a phrase "written in Arabic letters" is one whose letters-only form (the
// same steps the check uses) keeps at least one letter.
export const hasArabicLetters = (s: string) => lettersOnlyWords(s).length > 0;

export type Result = 'matched_own_ayah' | 'matched_same_surah' | 'matched_elsewhere' | 'unmatched' | 'too_short' | 'fragment';
export type MatchType = 'exact' | 'edge' | null;

// The approved text in letters-only form, one string per ayah, in source order, in two forms:
// "uthmani" from aya_text, and (D-085) "emlaey" from aya_text_emlaey, the plain-spelling text
// stored in the same approved file. The emlaey text is used only for matching: it is never shown,
// and only its letters-only form goes into a build (private builds only). While the file is the
// D-045 development copy, the D-045 caution applies to both forms.
export type Form = 'uthmani' | 'emlaey';
// One form of the approved text: an ayah's letters by its index, a surah's letters (' ' + the
// non-empty ayat joined by ' ' + ' '), and the whole text in the same layout.
// `has` (kit v30, optional): whether a word occurs as a whole word anywhere in this form. It only
// lets matchPhrase skip a scan that cannot succeed; it never changes a result.
// `findIn` (kit v32, optional): whether the whole words `words` occur consecutively in this form's
// whole text (s omitted) or in surah s's text, from the packed word sequence. It gives exactly what
// `all.includes(' ' + words.join(' ') + ' ')` and `surah(s).includes(...)` give (unit-tested and
// checked on the approved file); it only avoids scanning the whole text.
export type FormIndex = { ayah: (i: number) => string; surah: (s: number) => string | undefined; all: string; has?: (w: string) => boolean; findIn?: (words: string[], s?: number) => boolean };
export type LettersIndex = { refs?: string[]; surah?: number[]; at: { get(ref: string): number | undefined }; forms: Partial<Record<Form, FormIndex>> };
// Kept for callers of the first version: the Uthmani letters per ayah.
export const uthmaniLetters = (ix: LettersIndex) => {
  const f = ix.forms.uthmani;
  const out: string[] = [];
  if (f) for (let i = 0; ; i++) { const l = f.ayah(i); if (l === undefined) break; out.push(l); }
  return out;
};

function formIndex(rows: { s: number }[], letters: string[]): FormIndex {
  const bySurah = new Map<number, string[]>();
  rows.forEach((r, i) => { if (!bySurah.has(r.s)) bySurah.set(r.s, []); if (letters[i]) bySurah.get(r.s)!.push(letters[i]); });
  const surahText = new Map<number, string>();
  for (const [s, l] of bySurah) surahText.set(s, ' ' + l.join(' ') + ' ');
  return { ayah: (i) => letters[i] as string, surah: (s) => surahText.get(s), all: ' ' + letters.filter(Boolean).join(' ') + ' ' };
}

// D-156 A, cold-Worker CPU: the same index, made from a packed form prepared at build time, so a
// cold Worker does no joining, no flattening and builds no map. For each form, `all` is exactly
// formIndex's `all`; `off[i]` and `len[i]` place ayah i inside it (off -1 for an empty ayah). A
// surah's text is a slice of `all` with its spaces, equal to formIndex's surah text (unit-tested).
// Kit v30 (reader CPU): `words` is every distinct word of `all`, sorted by UTF-16 code units and
// joined by single spaces, and `woff[i]` the start of word i in it (prepared at build time, so a cold
// Worker builds nothing). An exact whole-word needle can only be in `all` if each of its words is in
// this list, so a phrase with a word the Quran text does not have (a gloss) is known to be unmatched
// without scanning the whole text (about 0.7 ms of CPU per such phrase before).
// Kit v32 (Cloudflare CPU after kit v31): the whole text as a word sequence, so "do these whole
// words occur consecutively in the whole text / in surah s" no longer scans the whole string
// (about 0.25 ms per form per phrase locally, which made a /dev/quote-check/ part cost several ms):
//   seq[p]    the word number (index in the sorted `words` list) of the p-th word of `all`;
//   pstart/plist  for each word number w, the positions p where it occurs, ascending:
//                 plist[pstart[w]] .. plist[pstart[w + 1] - 1];
//   wpos[i]   the position in seq of ayah i's first word (an empty ayah has no words), and
//             wpos[ayat] the number of words, so surah s's words are wpos[first] .. wpos[last + 1] - 1.
// All are prepared at build time (packLetters); nothing is built in a Worker. The numbers can be
// plain arrays (tests) or Int32Array views on the Worker's binary data module (scripts/build.ts).
// The two strings can also come as UTF-16 code units (`allU16`, `wordsU16`: Uint16Array views on the
// Worker's data module), read a piece at a time, so a cold Worker decodes no large string: an
// ayah's letters, a surah's letters or a dictionary word are made only when a phrase needs them.
type Nums = ArrayLike<number>;
export type PackedForm = { all?: string; allU16?: Nums; off: Nums; len: Nums; words?: string; wordsU16?: Nums; woff?: Nums; seq?: Nums; pstart?: Nums; plist?: Nums; wpos?: Nums };
const isNums = (x: unknown): x is Nums => Array.isArray(x) || ArrayBuffer.isView(x);
// UTF-16 code units a .. b-1 as a string (in pieces, so a long range stays under argument limits).
function fromUnits(u: Nums, a: number, b: number): string {
  let s = '';
  const sub = (u as Uint16Array).subarray;
  for (let i = a; i < b; i += 8192) {
    const j = Math.min(b, i + 8192);
    s += String.fromCharCode.apply(null, (typeof sub === 'function' ? (u as Uint16Array).subarray(i, j) : Array.prototype.slice.call(u, i, j)) as unknown as number[]);
  }
  return s;
}
export type PackedLetters = { counts: number[]; forms: Partial<Record<Form, PackedForm>> };

export function packLetters(counts: number[], forms: Partial<Record<Form, string[]>>): PackedLetters {
  const out: PackedLetters = { counts, forms: {} };
  for (const [k, letters] of Object.entries(forms) as [Form, string[]][]) {
    if (k === 'emlaey' && !letters.some(Boolean)) continue;
    let all = ' ';
    const off: number[] = [], len: number[] = [];
    for (const l of letters) {
      if (!l) { off.push(-1); len.push(0); continue; }
      off.push(all.length); len.push(l.length);
      all += l + ' ';
    }
    const dict = [...new Set(letters.filter(Boolean).join(' ').split(' ').filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const woff: number[] = [];
    let n = 0;
    for (const w of dict) { woff.push(n); n += w.length + 1; }
    const id = new Map(dict.map((w, i) => [w, i]));
    const seq: number[] = [], wpos: number[] = [];
    for (const l of letters) { wpos.push(seq.length); if (l) for (const w of l.split(' ')) if (w) seq.push(id.get(w)!); }
    wpos.push(seq.length);
    const cnt = new Array<number>(dict.length + 1).fill(0);
    for (const w of seq) cnt[w + 1]++;
    for (let i = 1; i <= dict.length; i++) cnt[i] += cnt[i - 1];
    const pstart = cnt.slice(), plist = new Array<number>(seq.length), fill = cnt.slice(0, dict.length);
    seq.forEach((w, p) => { plist[fill[w]++] = p; });
    out.forms[k] = { all: all.length === 1 ? '  ' : all, off, len, words: dict.join(' '), woff, seq, pstart, plist, wpos };
  }
  return out;
}

// Binary search in a packed word list (see PackedForm): the word's number, or -1.
export const wordIndex = (words: string, woff: Nums, w: string): number => wordIndexIn((a, b) => { const x = words.slice(a, b); return x === w ? 0 : x < w ? -1 : 1; }, words.length, woff);
// The same search on UTF-16 code units, comparing in place (no string is made per probe). JavaScript
// compares strings by UTF-16 code units, so the order is the same as for the string list.
const wordIndexUnits = (u: Nums, woff: Nums, w: string): number => wordIndexIn((a, b) => {
  const n = Math.min(b - a, w.length);
  for (let i = 0; i < n; i++) { const d = u[a + i] - w.charCodeAt(i); if (d) return d < 0 ? -1 : 1; }
  return b - a === w.length ? 0 : b - a < w.length ? -1 : 1;
}, u.length, woff);
// cmp(a, b): word at code units a .. b-1 compared with the word looked for (-1 before, 0 equal, 1 after).
function wordIndexIn(cmp: (a: number, b: number) => number, total: number, woff: Nums): number {
  let lo = 0, hi = woff.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const end = mid + 1 < woff.length ? woff[mid + 1] - 1 : total;
    const c = cmp(woff[mid], end);
    if (c === 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
export const wordListHas = (words: string, woff: Nums, w: string): boolean => wordIndex(words, woff, w) >= 0;

// Whether the word numbers `ids` occur consecutively in seq at a position p with lo <= p and
// p + ids.length <= hi. Walks the positions of the rarest of the words only.
function seqHas(f: Required<Pick<PackedForm, 'seq' | 'pstart' | 'plist'>>, ids: number[], lo: number, hi: number): boolean {
  let j = 0;
  for (let i = 1; i < ids.length; i++) if (f.pstart[ids[i] + 1] - f.pstart[ids[i]] < f.pstart[ids[j] + 1] - f.pstart[ids[j]]) j = i;
  const end = f.pstart[ids[j] + 1];
  for (let q = f.pstart[ids[j]]; q < end; q++) {
    const p = f.plist[q] - j;
    if (p < lo || p + ids.length > hi) continue;
    let ok = true;
    for (let i = 0; i < ids.length; i++) if (f.seq[p + i] !== ids[i]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

export function packedIndex(p: PackedLetters): LettersIndex {
  // First ayah index of each surah (cum[s]), from the counts (counts[0] is 0).
  const cum: number[] = [0, 0];
  for (let s = 1; s < p.counts.length; s++) cum[s + 1] = cum[s] + p.counts[s];
  const at = { get(ref: string) { const m = /^(\d+):(\d+)$/.exec(ref); if (!m) return undefined; const s = Number(m[1]), a = Number(m[2]); return s >= 1 && s < p.counts.length && a >= 1 && a <= p.counts[s] ? cum[s] + a - 1 : undefined; } };
  const forms: Partial<Record<Form, FormIndex>> = {};
  for (const [k, f] of Object.entries(p.forms) as [Form, PackedForm][]) {
    const cache = new Map<number, string | undefined>();
    const allText = typeof f.all === 'string' ? f.all : null;
    const allU = isNums(f.allU16) ? f.allU16 : null;
    const piece = (a: number, b: number) => (allText !== null ? allText.slice(a, b) : allU ? fromUnits(allU, a, b) : '');
    let whole = allText;
    const wordsU = isNums(f.wordsU16) ? f.wordsU16 : null;
    const woff = isNums(f.woff) ? f.woff : null;
    const idOf = !woff ? null : typeof f.words === 'string' ? (w: string) => wordIndex(f.words!, woff, w) : wordsU ? (w: string) => wordIndexUnits(wordsU, woff, w) : null;
    const sq = idOf && isNums(f.seq) && isNums(f.pstart) && isNums(f.plist) && isNums(f.wpos) ? { seq: f.seq, pstart: f.pstart, plist: f.plist, wpos: f.wpos } : null;
    forms[k] = {
      // The whole text as one string, made on first use only (the fallback scans; not used when
      // findIn is there).
      get all() { return whole ?? (whole = allU ? fromUnits(allU, 0, allU.length) : '  '); },
      ...(idOf ? { has: (w: string) => idOf(w) >= 0 } : {}),
      ...(sq && idOf ? {
        findIn: (words: string[], s?: number) => {
          if (!words.length) return false;
          const ids: number[] = [];
          for (const w of words) { const i = idOf(w); if (i < 0) return false; ids.push(i); }
          if (s === undefined) return seqHas(sq, ids, 0, sq.seq.length);
          if (!(s >= 1 && s < p.counts.length)) return false;
          return seqHas(sq, ids, sq.wpos[cum[s]], sq.wpos[cum[s] + p.counts[s]]);
        },
      } : {}),
      ayah: (i) => (i < 0 || i >= f.off.length ? (undefined as unknown as string) : f.off[i] < 0 ? '' : piece(f.off[i], f.off[i] + f.len[i])),
      surah: (s) => {
        if (cache.has(s)) return cache.get(s);
        let first = -1, last = -1;
        if (s >= 1 && s < p.counts.length) for (let i = cum[s]; i < cum[s] + p.counts[s]; i++) if (f.off[i] >= 0) { if (first < 0) first = i; last = i; }
        const t = first < 0 ? undefined : piece(f.off[first] - 1, f.off[last] + f.len[last] + 1);
        cache.set(s, t);
        return t;
      },
    };
  }
  return { at, forms };
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
// At the own-ayah level an exact match is tried first, then an edge match; at the same surah and
// anywhere only exact whole words count. The first level that matches decides the result. `form` says which form(s) matched
// there, and `match` whether it was exact or edge.
export const FRAGMENT_MAX_LETTERS = 2;

// Kit v30 (FIND-X, from the real pre-live reviewer list of 2026-11-14): a quote of ONE word whose
// Quran word in its own ayah range carries an attached letter (2:178, 2:185 and 2:188: the ayah has
// wa + the word) was "too_short", so it showed plain. A one-word phrase now also matches its own
// ayah range when a whole Quran word there is exactly one of these attached-letter prefixes followed
// by the phrase's whole word:
//   an optional wa or fa, then an optional bi, li or ka (at least one letter).
// Kit v31 (QA v30 FIND-Y, D-163 A): the question alef is no longer a prefix. Rule V-14 (D-074)
// folds alef with hamza to bare alef, so a question alef could not be told from the first letter of
// a word (form-IV verbs, comparatives, first-person verbs, broken plurals), and a bare alef followed
// by a word starting with lam split the article (alef + lam) off a word, which the "never alef +
// lam" guard did not catch. With no alef in any allowed prefix, neither can happen. The real
// pre-live lists of surahs 1 and 2 have no phrase that needs it (2:178, 2:185 and 2:188 all have wa).
// Guards, so a gloss is not turned green: own ayah range only (same surah and anywhere still need
// exact whole words, unchanged); the phrase has at least ONE_WORD_EDGE_MIN_LETTERS letters; only a
// prefix from that closed list, never an arbitrary start; no suffix and no match inside a word (for
// a single word D-088's "end of the first word, start of the last word" would allow any piece of
// any word, so it is not used). Its match type is "edge", as for D-088.
// Known and accepted (QA v30): a word whose own first letter is wa, fa, ba, lam or kaf can still be
// split, so a three-letter-or-longer rest of it turns green in that ayah only.
export const ONE_WORD_EDGE_MIN_LETTERS = 3;
const PROCLITIC = /^(?:[\u0648\u0641]?[\u0628\u0644\u0643]?)$/u;
export const isProclitic = (p: string) => p.length > 0 && PROCLITIC.test(p);

// Kit v31 (reader CPU): a matcher for one passage's own ayah range. The letters of the own range
// (per form) and their words are made once per passage, not again for every phrase and level, as
// the v30 matchPhrase did. Results are exactly those of the v30 code (unit-tested against it).
export type OwnRange = { s: number; from: number; to: number };
export type MatchOut = { letters: string; words: number; result: Result; form: MatchedForm; match: MatchType };
export function phraseMatcher(ix: LettersIndex, own: OwnRange) {
  const forms = (Object.entries(ix.forms) as [Form, FormIndex][]);
  const ownTexts = new Map<Form, string>();
  const ownWordLists = new Map<Form, string[]>();
  const ownText = (k: Form, f: FormIndex) => {
    let t = ownTexts.get(k);
    if (t === undefined) {
      const parts: string[] = [];
      for (let a = own.from; a <= own.to; a++) { const i = ix.at.get(`${own.s}:${a}`); const l = i === undefined ? '' : f.ayah(i); if (l) parts.push(l); }
      t = ' ' + parts.join(' ') + ' ';
      ownTexts.set(k, t);
    }
    return t;
  };
  const ownWords = (k: Form, f: FormIndex) => {
    let w = ownWordLists.get(k);
    if (!w) { w = ownText(k, f).split(' '); ownWordLists.set(k, w); }
    return w;
  };
  const formOf = (hit: Form[]): MatchedForm => (hit.length === 2 ? 'both' : hit.length === 1 ? hit[0] : null);
  // Steps up to and including the own-ayah level, shared by match() and kind(). Returns the final
  // result when one of these steps decides it, else null (go on to the same surah and anywhere).
  function ownLevel(words: string[], letters: string): { result: Result; form: MatchedForm; match: MatchType } | null {
    if (!words.length) return { result: 'too_short', form: null, match: null };
    const exact = ' ' + letters + ' ';
    // Whole words of the own ayah range always count, even for a short phrase.
    const ownExact = formOf(forms.filter(([k, f]) => ownText(k, f).includes(exact)).map(([k]) => k));
    if (ownExact) return { result: 'matched_own_ayah', form: ownExact, match: 'exact' };
    const total = words.reduce((n, w) => n + [...w].length, 0);
    if (total <= FRAGMENT_MAX_LETTERS) return { result: 'fragment', form: null, match: null };
    if (words.length === 1 && total >= ONE_WORD_EDGE_MIN_LETTERS) {
      const w = words[0];
      const hit = formOf(forms.filter(([k, f]) => ownWords(k, f).some((q) => q.length > w.length && q.endsWith(w) && isProclitic(q.slice(0, q.length - w.length)))).map(([k]) => k));
      if (hit) return { result: 'matched_own_ayah', form: hit, match: 'edge' };
    }
    if (words.length < 2) return { result: 'too_short', form: null, match: null };
    // Edge needle: no space before the first word or after the last, so the first word may be the
    // end of a Quran word and the last word the start of one; inner spaces keep every other word whole.
    // Edge matches only at the own-ayah level; the same surah and anywhere need exact whole words,
    // so a different letter at a word edge (as in a reading with ta for ya) cannot be matched to some
    // other word elsewhere.
    const g = formOf(forms.filter(([k, f]) => ownText(k, f).includes(letters)).map(([k]) => k));
    if (g) return { result: 'matched_own_ayah', form: g, match: 'edge' };
    return null;
  }
  // Same surah and anywhere: exact whole words only, so a form whose word list lacks one of the
  // phrase's words cannot match there and is not scanned (kit v30; same results, less CPU).
  const possibleFor = (words: string[]) => forms.filter(([, f]) => !f.has || words.every((w) => f.has!(w)));
  // Kit v32: from the packed word sequence when the index has it (same answer, no whole-text scan).
  const inSurah = (f: FormIndex, words: string[], exact: string) => (f.findIn ? f.findIn(words, own.s) : (f.surah(own.s) ?? '').includes(exact));
  const inAll = (f: FormIndex, words: string[], exact: string) => (f.findIn ? f.findIn(words) : f.all.includes(exact));
  return {
    // The full result, with the form(s) and match type (the quote check, D-084).
    match(phrase: string): MatchOut {
      const words = lettersOnlyWords(phrase);
      const letters = words.join(' ');
      const o = ownLevel(words, letters);
      if (o) return { letters, words: words.length, ...o };
      const exact = ' ' + letters + ' ';
      const possible = possibleFor(words);
      const s = formOf(possible.filter(([, f]) => inSurah(f, words, exact)).map(([k]) => k));
      if (s) return { letters, words: words.length, result: 'matched_same_surah', form: s, match: 'exact' };
      const e = formOf(possible.filter(([, f]) => inAll(f, words, exact)).map(([k]) => k));
      if (e) return { letters, words: words.length, result: 'matched_elsewhere', form: e, match: 'exact' };
      return { letters, words: words.length, result: 'unmatched', form: null, match: null };
    },
    // Only the display group of the result (D-149, AC29), for the marks: "own" (matched_own_ayah),
    // "other" (matched_same_surah or matched_elsewhere) or "none" (unmatched, too_short, fragment).
    // A surah's letters are a slice of the whole text in the same layout (see FormIndex), so a
    // phrase is in the same surah or elsewhere exactly when it is in the whole text: one scan of
    // the whole text, stopping at the first form that has it, gives the same group.
    kind(phrase: string): 'own' | 'other' | 'none' {
      const words = lettersOnlyWords(phrase);
      const letters = words.join(' ');
      const o = ownLevel(words, letters);
      if (o) return o.result === 'matched_own_ayah' ? 'own' : 'none';
      const exact = ' ' + letters + ' ';
      return possibleFor(words).some(([, f]) => inAll(f, words, exact)) ? 'other' : 'none';
    },
  };
}

export function matchPhrase(ix: LettersIndex, phrase: string, own: OwnRange): MatchOut {
  return phraseMatcher(ix, own).match(phrase);
}

export type ReviewItem = { ref: string; range: string; bracket: Bracket; label: Phrase['label']; phrase: string; letters: string; result: Result; form: MatchedForm; match: MatchType; unclosed?: boolean };
export type QuoteSummary = { phrases: number; byResult: Record<Result, number>; braces: number; unclosed: number; edgeMatches: number };

export const emptyCounts = (): Record<Result, number> => ({ matched_own_ayah: 0, matched_same_surah: 0, matched_elsewhere: 0, unmatched: 0, too_short: 0, fragment: 0 });

// Checks one passage. Every phrase is counted; the reviewer list holds every phrase that did not
// match its own ayah range, except fragments (D-088), plus every phrase in braces and every
// unclosed bracket. Edge matches count as matched at their level; match says exact or edge.
// `each` (kit v30) receives every phrase with its result, so a caller that also needs the display
// class (the quote check page, AC31) does not match each phrase a second time.
export function checkPassage(ix: LettersIndex, html: string, own: { s: number; from: number; to: number }, ref: string, sum: QuoteSummary, list: ReviewItem[], each?: (p: Phrase, result: Result) => void) {
  const matcher = phraseMatcher(ix, own);
  for (const p of findPhrases(html)) {
    const m = matcher.match(p.text);
    each?.(p, m.result);
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
