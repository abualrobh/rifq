// Kit v35 (B5, reader CPU for long English passages): the D-149 display marks of an English
// passage, the same letters as computeMarks(ix, html, own, false) (src/core/tafseer-marks.ts) for
// every passage (unit-tested on made-up and fuzzed passages), with less work on the first request
// in a new isolate:
//   - the bracketed phrases are found with the native regular-expression and indexOf scans instead
//     of a loop over every character (phrasesFast: the same phrases, in the same order, with the
//     same start and end, as phrasesAt; unit-tested);
//   - a phrase with no Arabic-script letter at all (ARABIC_SCRIPT_LETTER, already the cheap first
//     test of the coverage page and the English quote check) is "N" without the letters-only
//     folding; most phrases of the English work are like this (4,701 of 4,727 in surahs 1 and 2);
//   - the Quran letters index is asked for only when a phrase has Arabic letters, so a passage with
//     none never builds it.
// Display only. Nothing here changes a character of the passage, the matcher, its results or the
// Arabic path: the Arabic work still uses computeMarks, and this file is not one of the matching
// files whose hash is in the Arabic cache key (scripts/build.ts MATCHING_FILES). The English cache
// key holds EN_MARKS_VERSION instead, so English entries made by kit v34 are not read again.
import { blockText } from '../core/tafseer-html.ts';
import { MARKS_VERSION, type Marks } from '../core/tafseer-marks.ts';
import { hasArabicLetters, phraseMatcher, type LettersIndex } from '../core/tafseer-quotes.ts';
import { ARABIC_SCRIPT_LETTER } from './quote-check.ts';

export const EN_MARKS_VERSION = 'e1';

// The four opening characters of tafseer-quotes.ts PAIRS and the closing character of each.
const OPENER = /[({\ufd3e\ufd3f]/g;
const CLOSER: Record<string, string> = { '(': ')', '{': '}', '\ufd3f': '\ufd3e', '\ufd3e': '\ufd3f' };

export type FastPhrase = { text: string; start: number; end: number; unclosed: boolean };

// phrasesAt(t) (tafseer-quotes.ts) without its per-character loop: from each opening character, the
// phrase runs to its closing character, or, when a line break or the end comes first, it is
// unclosed and ends there; the scan goes on after the closing character (or at the line break).
export function phrasesFast(t: string): FastPhrase[] {
  const out: FastPhrase[] = [];
  OPENER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPENER.exec(t)) !== null) {
    const i = m.index;
    const c = t.indexOf(CLOSER[m[0]], i + 1);
    let nl = t.indexOf('\n', i + 1);
    if (nl < 0) nl = t.length;
    if (c >= 0 && c < nl) { out.push({ text: t.slice(i + 1, c), start: i, end: c, unclosed: false }); OPENER.lastIndex = c + 1; }
    else { out.push({ text: t.slice(i + 1, nl), start: i, end: nl, unclosed: true }); OPENER.lastIndex = nl; }
  }
  return out;
}

// computeMarks(ix, html, own, false), with the index asked for only when needed.
export function enMarks(index: () => LettersIndex, html: string, own: { s: number; from: number; to: number }): Marks {
  const ps = phrasesFast(blockText(html));
  let m: ReturnType<typeof phraseMatcher> | null = null;
  let c = '';
  for (const p of ps) {
    if (p.unclosed || !ARABIC_SCRIPT_LETTER.test(p.text) || !hasArabicLetters(p.text)) { c += 'N'; continue; }
    m ??= phraseMatcher(index(), own);
    const k = m.kind(p.text);
    c += k === 'own' ? 'O' : k === 'other' ? 'A' : 'P';
  }
  return { v: MARKS_VERSION, n: ps.length, c };
}
