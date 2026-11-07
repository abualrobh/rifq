// D-078: every Quran quote inside a Tafseer passage is checked against the approved Quran file
// before release, and any mismatch blocks release. The Tafseer text is never changed.
//
// What this can and cannot do:
// - Finding quotes. The API reference documents `text` only as an "HTML-formatted tafsir body"; it
//   does not say whether or how quotes are marked. So quotes are found in two ways, both set in
//   QuoteMarkers:
//   1. Markup: elements whose tag and/or class match a configured list. The list is EMPTY by
//      default, because no real response has been seen. Once one is seen, the marker can be added.
//   2. Delimiters: text between ornate parentheses (U+FD3F and U+FD3E, in either order) or between
//      curly braces, which Arabic typesetting commonly uses around quoted ayat. Whether this
//      Tafseer uses them is unknown. Braces used for anything else will be reported as quotes that
//      do not match, which blocks release (it fails safe, never silently passes).
//   A quote that carries no marker at all cannot be found. Nothing here guesses at unmarked quotes.
// - Comparing. A quote passes only if its exact UTF-8 characters, trimmed of surrounding spaces,
//   appear in the approved file's ayah text (the stored text without the D-068 ayah-number ending),
//   starting and ending on word edges. A quote may run across consecutive ayat, joined by one space.
//   No Unicode normalization is used (rifq-rules.md). A quote in a different script (for example
//   plain spelling rather than Uthmani), with an ellipsis, with ayah numbers inside it, or with
//   different spacing will be reported as a mismatch even if a person would call it correct.
//   The report also says whether the quote matches after removing marks and tatweel, to help the
//   D-012 reviewer; that never turns a mismatch into a pass.
// - It does not check that a quote is attributed to the right ayah, or judge meaning.
// Reports hold references, positions, lengths and hashes only, never Tafseer or Quran text.
import { blockText, tokenize } from './tafseer-html.ts';
import { foldPlaceholder } from './fold.ts';

export type QuoteMarkers = { pairs: [string, string][]; markup: { tag?: string; className?: string }[] };
export const DEFAULT_MARKERS: QuoteMarkers = {
  pairs: [['\ufd3f', '\ufd3e'], ['\ufd3e', '\ufd3f'], ['{', '}']],
  markup: [],
};

export type FoundQuote = { via: 'delimiter' | 'markup'; text: string; start: number; end: number; unclosed?: boolean };

// Quotes in one passage, in reading order. Positions are UTF-16 offsets in the passage's block text.
export function findQuotes(html: string, markers: QuoteMarkers = DEFAULT_MARKERS): FoundQuote[] {
  const out: FoundQuote[] = [];
  const text = blockText(html);
  const openers = new Map<string, Set<string>>();
  for (const [o, c] of markers.pairs) { if (!openers.has(o)) openers.set(o, new Set()); openers.get(o)!.add(c); }
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const closers = openers.get(ch);
    if (!closers) { i++; continue; }
    let j = i + 1;
    while (j < text.length && !closers.has(text[j]) && text[j] !== '\n') j++;
    if (j < text.length && closers.has(text[j])) {
      out.push({ via: 'delimiter', text: text.slice(i + 1, j), start: i + 1, end: j });
      i = j + 1;
    } else {
      out.push({ via: 'delimiter', text: '', start: i, end: i, unclosed: true });
      i++;
    }
  }
  if (markers.markup.length) {
    const toks = tokenize(html);
    const match = (tag: string, attrs: Record<string, string>) => markers.markup.some((m) =>
      (!m.tag || m.tag === tag) && (!m.className || (attrs.class ?? '').split(/\s+/).includes(m.className)));
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t !== 'open' || !match(t.tag, t.attrs)) continue;
      let depth = 1, s = '';
      for (let m = k + 1; m < toks.length && depth > 0; m++) {
        const u = toks[m];
        if (u.t === 'open' && u.tag === t.tag) depth++;
        else if (u.t === 'close' && u.tag === t.tag) depth--;
        else if (u.t === 'text') s += u.v;
      }
      out.push({ via: 'markup', text: s, start: -1, end: -1, unclosed: depth > 0 });
    }
  }
  return out;
}

// The approved file as one searchable string.
export type QuranIndex = { joined: string; starts: number[]; refs: string[]; folded?: string };
export const bareAyah = (t: string) => t.replace(/\u00a0[\u0660-\u0669\u06f0-\u06f90-9]+$/u, '');

export function quranIndex(list: { sora: number; aya_no: number; aya_text: string }[]): QuranIndex {
  const starts: number[] = [], refs: string[] = [];
  let joined = '';
  for (const a of list) {
    if (joined) joined += ' ';
    starts.push(joined.length);
    refs.push(`${a.sora}:${a.aya_no}`);
    joined += bareAyah(a.aya_text);
  }
  return { joined, starts, refs };
}

function refAt(ix: QuranIndex, pos: number): string {
  let lo = 0, hi = ix.starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ix.starts[mid] <= pos) lo = mid; else hi = mid - 1; }
  return ix.refs[lo];
}

const SPACE = /[ \u00a0\n\t]/;
const squash = (s: string) => foldPlaceholder(s).replace(/[ \u00a0\n\t]+/g, ' ').trim();

export type QuoteResult =
  | { result: 'exact'; from: string; to: string }
  | { result: 'mismatch'; reason: 'empty' | 'unclosed' | 'matches_only_without_marks' | 'not_found' };

export function compareQuote(ix: QuranIndex, quote: FoundQuote): QuoteResult {
  if (quote.unclosed) return { result: 'mismatch', reason: 'unclosed' };
  const q = quote.text.replace(/^[ \u00a0\n\t]+|[ \u00a0\n\t]+$/g, '');
  if (!q) return { result: 'mismatch', reason: 'empty' };
  let from = 0;
  for (;;) {
    const k = ix.joined.indexOf(q, from);
    if (k < 0) break;
    const before = k === 0 || SPACE.test(ix.joined[k - 1]);
    const after = k + q.length === ix.joined.length || SPACE.test(ix.joined[k + q.length]);
    if (before && after) return { result: 'exact', from: refAt(ix, k), to: refAt(ix, k + q.length - 1) };
    from = k + 1;
  }
  if (ix.folded === undefined) ix.folded = squash(ix.joined);
  const fq = squash(q);
  return fq && ix.folded.includes(fq) ? { result: 'mismatch', reason: 'matches_only_without_marks' } : { result: 'mismatch', reason: 'not_found' };
}
