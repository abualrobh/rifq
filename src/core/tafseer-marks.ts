// D-149 Tafseer bracket display, classified as D-156 A sets: the Worker runs the quote check
// (tafseer-quotes.ts, D-084, D-085, D-088) once when it fetches a passage, and keeps one class
// letter per bracketed phrase with the cached passage. Only those letters ("marks") go to the
// browser, next to the passage text exactly as delivered (AC4). The browser finds the same phrases
// in the same text with the same code (phrasesAt needs no Quran data) and applies the marks.
//
// A mark is a class only: no Quran text, no letters-only text, no position in the approved file
// (D-157: the matching data stays in the Worker bundle).
//
// Classes, one letter per phrase in reading order (RQ-005 v1.1 AC29):
//   O  own ayah: matched_own_ayah (exact or D-088 edge)  -> Quran font, green, between { }
//   A  another ayah: matched_same_surah, matched_elsewhere -> Quran font, brown, between ( )
//   P  plain: unmatched, too_short, fragment (D-152 A: also a { } phrase) -> plain, between ( )
//   N  as delivered: an unclosed phrase (P-2), or, in a work that is not Arabic, a phrase with no
//      Arabic letters (RQ-007 P-11, AC34). Nothing about it changes.
//
// Display only: no word of the Tafseer changes. The delivered string goes through the same
// tokenizer and the same allow-list as sanitize() (tafseer-html.ts); a classified phrase's two
// bracket characters are swapped for the marks above and its words are put in an element the
// island builds itself with fixed class names. If the marks are missing or do not fit the passage
// (version, count, letters), nothing is styled and the passage is shown as delivered (AC37).
import { ALLOWED_TAGS, BLOCK_TAGS, blockText, DROP_WITH_CONTENT, tokenize, type Node } from './tafseer-html.ts';
import { hasArabicLetters, phraseMatcher, phrasesAt, type LettersIndex, type PlacedPhrase, type Result } from './tafseer-quotes.ts';

export const MARKS_VERSION = 1;
export type MarkClass = 'O' | 'A' | 'P' | 'N';
export type Marks = { v: typeof MARKS_VERSION; n: number; c: string };
const MARK_RE = /^[OAPN]*$/;
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);

export function classOf(result: Result, p: { text: string; unclosed?: boolean }, arabicWork: boolean): MarkClass {
  if (p.unclosed) return 'N';
  if (!arabicWork && !hasArabicLetters(p.text)) return 'N';
  if (result === 'matched_own_ayah') return 'O';
  if (result === 'matched_same_surah' || result === 'matched_elsewhere') return 'A';
  return 'P';
}

// Worker side: the marks of one passage against its covered range (P-1). The phrases are read with
// blockText, exactly as findPhrases reads them for /dev/quote-check/ (AC31).
// The same class from the matcher's display group (kit v31 reader CPU, see phraseMatcher.kind):
// equal to classOf on the full result for every phrase (unit-tested).
export function classOfKind(kind: 'own' | 'other' | 'none', p: { text: string; unclosed?: boolean }, arabicWork: boolean): MarkClass {
  if (p.unclosed) return 'N';
  if (!arabicWork && !hasArabicLetters(p.text)) return 'N';
  return kind === 'own' ? 'O' : kind === 'other' ? 'A' : 'P';
}

export function computeMarks(ix: LettersIndex, html: string, own: { s: number; from: number; to: number }, arabicWork: boolean): Marks {
  const ps = phrasesAt(blockText(html));
  const m = phraseMatcher(ix, own);
  let c = '';
  for (const p of ps) c += p.unclosed ? 'N' : classOfKind(m.kind(p.text), p, arabicWork);
  return { v: MARKS_VERSION, n: ps.length, c };
}

// Strict check of marks received from the network: anything else is ignored (AC37).
export function validMarks(m: unknown, phrases: number): m is Marks {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  const o = m as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  return keys === 'c,n,v' && o.v === MARKS_VERSION && Number.isInteger(o.n) && o.n === phrases
    && typeof o.c === 'string' && o.c.length === phrases && MARK_RE.test(o.c);
}

// A styled phrase: its words exactly as delivered, with the marks that replace its brackets.
export type QNode = { tfq: 'O' | 'A' | 'P'; open: string; close: string; text: string };
export type MNode = string | QNode | { tag: string; children: MNode[] };
export const OPEN_CLOSE: Record<'O' | 'A' | 'P', [string, string]> = { O: ['{', '}'], A: ['(', ')'], P: ['(', ')'] };

// The sanitize() tree with each text run's offset in blockText(html). The walk is sanitize() and
// blockText() at once, token by token, so the two cannot drift apart (unit-tested).
type TNode = { s: string; off: number } | { tag: string; children: TNode[] };
function walk(html: string): { nodes: TNode[]; text: string } {
  const root: TNode[] = [];
  const stack: { tag: string; children: TNode[] }[] = [];
  const top = () => (stack.length ? stack[stack.length - 1].children : root);
  let text = '';
  let dropping = 0, dropTag = '';
  for (const tk of tokenize(html)) {
    if (dropping) { if (tk.t === 'close' && tk.tag === dropTag) dropping--; continue; }
    if (tk.t === 'text') { if (tk.v) top().push({ s: tk.v, off: text.length }); text += tk.v; continue; }
    if (tk.t === 'open' && DROP_WITH_CONTENT.has(tk.tag)) { dropping = 1; dropTag = tk.tag; continue; }
    if (BLOCK_TAGS.has(tk.tag)) text += '\n';
    if (tk.t === 'open') {
      if (!ALLOWED_TAGS.has(tk.tag)) continue;
      if (tk.tag === 'br') { top().push({ tag: 'br', children: [] }); continue; }
      const el = { tag: tk.tag, children: [] as TNode[] };
      top().push(el);
      if (!VOID.has(tk.tag)) stack.push(el);
      continue;
    }
    if (!ALLOWED_TAGS.has(tk.tag) || VOID.has(tk.tag)) continue;
    const k = stack.map((x) => x.tag).lastIndexOf(tk.tag);
    if (k >= 0) stack.length = k;
  }
  return { nodes: root, text };
}
export const blockTextOf = (html: string) => walk(html).text;
const plain = (n: TNode[]): Node[] => n.map((x) => ('s' in x ? x.s : { tag: x.tag, children: plain(x.children) }));

// Browser side: the passage as display nodes with the marks applied, or null when the marks are
// missing or do not fit (the caller then shows sanitize(html), as delivered). A phrase whose two
// brackets are not in the same text run (markup inside the phrase) is left as delivered.
export function markedNodes(html: string, marks: unknown): { nodes: MNode[]; styled: number; left: number } | null {
  const w = walk(html);
  const ps = phrasesAt(w.text);
  if (!validMarks(marks, ps.length)) return null;
  // Text runs in reading order, to find the run that holds both brackets of a phrase.
  const runs: { s: string; off: number }[] = [];
  const collect = (n: TNode[]) => { for (const x of n) { if ('s' in x) runs.push(x); else collect(x.children); } };
  collect(w.nodes);
  const byRun = new Map<{ s: string; off: number }, { p: PlacedPhrase; c: 'O' | 'A' | 'P' }[]>();
  let styled = 0, left = 0;
  ps.forEach((p, i) => {
    const c = marks.c[i] as MarkClass;
    // An unclosed phrase is never restyled, whatever the mark says (P-2).
    if (c === 'N' || p.unclosed) return;
    const run = runs.find((r) => p.start >= r.off && p.end < r.off + r.s.length);
    if (!run) { left++; return; }
    if (!byRun.has(run)) byRun.set(run, []);
    byRun.get(run)!.push({ p, c });
    styled++;
  });
  const build = (n: TNode[]): MNode[] => {
    const out: MNode[] = [];
    for (const x of n) {
      if (!('s' in x)) { out.push({ tag: x.tag, children: build(x.children) }); continue; }
      const list = byRun.get(x);
      if (!list) { out.push(x.s); continue; }
      let at = 0;
      for (const { p, c } of list) {
        const a = p.start - x.off, b = p.end - x.off;
        if (a > at) out.push(x.s.slice(at, a));
        out.push({ tfq: c, open: OPEN_CLOSE[c][0], close: OPEN_CLOSE[c][1], text: x.s.slice(a + 1, b) });
        at = b + 1;
      }
      if (at < x.s.length) out.push(x.s.slice(at));
    }
    return out;
  };
  return { nodes: build(w.nodes), styled, left };
}

// sanitize() through the same walk (used by tests to prove the walk keeps sanitize's tree).
export const sanitizeViaWalk = (html: string): Node[] => plain(walk(html).nodes);

// The words a reader sees, in order, with the styled phrases' marks in place.
export function markedText(nodes: MNode[]): string {
  let s = '';
  for (const n of nodes) s += typeof n === 'string' ? n : 'tfq' in n ? n.open + n.text + n.close : markedText(n.children);
  return s;
}
