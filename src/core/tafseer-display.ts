// Kit v36: display-only structure for English Tafseer passages (RQ-007). Nothing here is used by the
// D-078 quote finder, the D-149 marks or the Worker: src/core/tafseer-html.ts and
// src/core/tafseer-marks.ts (and so the Arabic check version) are unchanged. Every function takes
// the display nodes that markedNodes() or sanitize() made and only regroups them into extra
// elements: no character is added, removed, changed or moved (the text of the nodes, read in
// order, is the same before and after; unit-tested).
//
// 1. Headings (QA v35 FIND-BB). The English work's HTML uses <h1> and <h2>, which the sanitizer
//    does not allow, so it unwraps them and their words ran into the next heading or paragraph
//    with no space or line break between them. headingBlocks() reads the same passage string through the
//    same tokenizer, finds where each <h1>/<h2> started and ended among the display nodes, and
//    wraps those nodes in a heading element ('tf-h1' / 'tf-h2'), which the view shows as a block.
//    If the nodes do not line up with the string (they always should), the nodes are returned as
//    they are.
// 2. Quotations split by markup (QA v35 FIND-BA 1). In an English paragraph, <<Arabic <b>Arabic</b>
//    Arabic>> is several text nodes. quoteGroups() puts the whole quotation, from << to >>, into one
//    group ('tf-arq'), which the view shows as one right-to-left element, so both marks sit at the
//    outer ends. Only when everything between the marks is Arabic script (no letter of another
//    script, no line break, no block).
import { ALLOWED_TAGS, DROP_WITH_CONTENT, tokenize } from './tafseer-html.ts';
import type { MNode } from './tafseer-marks.ts';
import { hasOtherLetter } from './bidi.ts';

// The same void list as tafseer-html.ts (not exported there; that file is a matching file and stays
// unchanged). Only 'br' is both allowed and void.
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);
const HEADINGS: Record<string, string> = { h1: 'tf-h1', h2: 'tf-h2' };
// Elements that start a new block (an unclosed heading ends before them).
const BLOCKS = new Set(['p', 'div', 'blockquote', 'ul', 'ol', 'li', 'h3', 'h4', 'h5', 'h6', 'br', 'tf-h1', 'tf-h2']);
export const HEADING_TAGS = new Set(Object.values(HEADINGS));
export const QUOTE_GROUP = 'tf-arq';

type Skel = { k: 't'; len: number } | { k: 'e'; tag: string; children: Skel[] } | { k: 'h'; open: boolean; tag: string };
type Marker = { mark: 'h'; open: boolean; tag: string };
type Item = MNode | Marker;

// sanitize()'s tree walk (tafseer-html.ts), with text runs as lengths and a marker where an <h1> or
// <h2> opened or closed.
function skeleton(html: string): Skel[] {
  const root: Skel[] = [];
  const stack: { tag: string; children: Skel[] }[] = [];
  const top = () => (stack.length ? stack[stack.length - 1].children : root);
  let dropping = 0, dropTag = '';
  for (const tk of tokenize(html)) {
    if (dropping) { if (tk.t === 'close' && tk.tag === dropTag) dropping--; continue; }
    if (tk.t === 'text') { if (tk.v) top().push({ k: 't', len: tk.v.length }); continue; }
    if (HEADINGS[tk.tag]) { top().push({ k: 'h', open: tk.t === 'open', tag: HEADINGS[tk.tag] }); continue; }
    if (tk.t === 'open') {
      if (DROP_WITH_CONTENT.has(tk.tag)) { dropping = 1; dropTag = tk.tag; continue; }
      if (!ALLOWED_TAGS.has(tk.tag)) continue;
      if (tk.tag === 'br') { top().push({ k: 'e', tag: 'br', children: [] }); continue; }
      const el = { k: 'e' as const, tag: tk.tag, children: [] as Skel[] };
      top().push(el);
      if (!VOID.has(tk.tag)) stack.push(el);
      continue;
    }
    if (!ALLOWED_TAGS.has(tk.tag) || VOID.has(tk.tag)) continue;
    const k = stack.map((x) => x.tag).lastIndexOf(tk.tag);
    if (k >= 0) stack.length = k;
  }
  return root;
}

const lengthOf = (n: MNode): number => (typeof n === 'string' ? n.length : 'tfq' in n ? n.open.length + n.text.length + n.close.length : -1);

// Lays the markers of the skeleton into the display nodes. Each text run of the skeleton is one or
// more display pieces of the same total length (markedNodes only splits runs). null: no fit.
function merge(sk: Skel[], out: MNode[]): Item[] | null {
  const res: Item[] = [];
  let j = 0;
  for (const s of sk) {
    if (s.k === 'h') { res.push({ mark: 'h', open: s.open, tag: s.tag }); continue; }
    if (s.k === 't') {
      let need = s.len;
      while (need > 0) {
        const o = out[j++];
        if (o === undefined) return null;
        const l = lengthOf(o);
        if (l <= 0 || l > need) return null;
        need -= l;
        res.push(o);
      }
      continue;
    }
    const o = out[j++];
    if (o === undefined || typeof o === 'string' || 'tfq' in o || o.tag !== s.tag) return null;
    const kids = merge(s.children, o.children);
    if (!kids) return null;
    res.push({ tag: o.tag, children: kids as MNode[] });
  }
  return j === out.length ? res : null;
}

const isMarker = (x: Item): x is Marker => typeof x === 'object' && 'mark' in x;
const isBlock = (x: Item) => typeof x === 'object' && !isMarker(x) && !('tfq' in x) && BLOCKS.has(x.tag);

// Turns the markers of one list into heading elements: from an opening marker to the next closing
// marker in the same list (as a browser does, a new heading also ends an open one). A heading with
// no closing marker in its list ends before the next block. Empty headings are left out (they have
// no words). Stray closing markers are ignored.
function group(list: Item[]): MNode[] {
  const out: MNode[] = [];
  let cur: { tag: string; children: MNode[] } | null = null;
  let open = false; // cur has a closing marker later in this list
  const end = () => { if (cur && cur.children.length) out.push(cur); cur = null; };
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (isMarker(x)) {
      if (!x.open) { if (cur) end(); continue; }
      end();
      cur = { tag: x.tag, children: [] };
      open = list.slice(i + 1).some((y) => isMarker(y));
      continue;
    }
    const node: MNode = typeof x === 'object' && !('tfq' in x) ? { tag: x.tag, children: group(x.children as Item[]) } : x;
    if (cur && !open && isBlock(x)) end();
    (cur ? cur.children : out).push(node);
  }
  end();
  return out;
}

// FIND-BB: the passage's <h1>/<h2> as heading elements ('tf-h1', 'tf-h2') around the same nodes.
export function headingBlocks(html: string, nodes: MNode[]): { nodes: MNode[]; headings: number } {
  const sk = skeleton(html);
  let count = 0;
  const walk = (s: Skel[]) => { for (const x of s) { if (x.k === 'h' && x.open) count++; if (x.k === 'e') walk(x.children); } };
  walk(sk);
  if (!count) return { nodes, headings: 0 };
  const m = merge(sk, nodes);
  if (!m) return { nodes, headings: 0 };
  const g = group(m);
  let made = 0;
  const cnt = (n: MNode[]) => { for (const x of n) if (typeof x === 'object' && !('tfq' in x)) { if (HEADING_TAGS.has(x.tag)) made++; cnt(x.children); } };
  cnt(g);
  return { nodes: g, headings: made };
}

// FIND-BA 1: quotation marks that open and close a quotation across markup in one line.
const AR_LETTER = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufd3d\ufd40-\ufdff\ufe70-\ufefe]/;
const PAIRS: Record<string, string> = { '\u00ab': '\u00bb', '\u2039': '\u203a' };
const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'span']);
function flat(n: MNode): string | null {
  if (typeof n === 'string') return n;
  if ('tfq' in n) return n.open + n.text + n.close;
  if (!INLINE.has(n.tag)) return null;
  let s = '';
  for (const c of n.children) { const t = flat(c); if (t === null) return null; s += t; }
  return s;
}

export function quoteGroups(nodes: MNode[]): MNode[] {
  const list: MNode[] = nodes.map((n) => (typeof n === 'object' && !('tfq' in n) ? { tag: n.tag, children: quoteGroups(n.children) } : n));
  const out: MNode[] = [];
  let i = 0;
  let head: string | null = null; // the rest of list[i] still to scan, when list[i] is a string
  while (i < list.length) {
    const x = head ?? list[i];
    head = null;
    if (typeof x !== 'string') { out.push(x); i++; continue; }
    let done = false;
    for (let p = 0; p < x.length && !done; p++) {
      const close = PAIRS[x[p]];
      if (!close) continue;
      const q0 = x.indexOf(close, p + 1);
      if (q0 >= 0) { p = q0; continue; } // both marks in one text node: arabicRuns handles it
      // Look for the closing mark in a later string of this list, through inline nodes only.
      let text = x.slice(p);
      let j = i + 1, at = -1;
      for (; j < list.length; j++) {
        const y = list[j];
        const t = flat(y);
        if (t === null) break;
        if (typeof y === 'string') {
          const q = y.indexOf(close);
          const o = y.indexOf(x[p]);
          if (q >= 0 && (o < 0 || o > q)) { at = q; text += y.slice(0, q + 1); break; }
          if (o >= 0) break;
        } else if (t.includes(close) || t.includes(x[p])) break;
        text += t;
      }
      if (at < 0 || !AR_LETTER.test(text) || hasOtherLetter(text) || text.includes('\n')) continue;
      const y = list[j] as string;
      if (p > 0) out.push(x.slice(0, p));
      out.push({ tag: QUOTE_GROUP, children: [x.slice(p), ...list.slice(i + 1, j), y.slice(0, at + 1)] });
      i = j;
      const rest = y.slice(at + 1);
      if (rest) head = rest; else i++;
      done = true;
    }
    if (!done) { out.push(x); i++; }
  }
  return out;
}
