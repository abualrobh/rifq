// TypeScript port of the round 4 search core (prototype/round4/search-core.mjs).
// The matching logic is unchanged. Since round 2 the search form is the approved D-027 rules
// (variants.ts), and the index format is version 2: version 1 plus a flags word (which rules the
// index was built with) and the English surah names, both taken from the source at build time.
import { RULES_AWAITING_D012_REVIEWER, type PendingMode } from './search-config.ts';
import { foldQuery } from './variants.ts';

export const PAGE = 50;
export const MAX_CHARS = 100;
export const INDEX_MAGIC = 0x51464952;
export const INDEX_VERSION = 2;
// Header flags word: the mode of the rules awaiting the D-012 reviewer that the index was built with.
export const MODE_FLAGS: Record<PendingMode, number> = { off: 0, draft: 1, 'interim-placeholder': 2 };
export const indexFlags = (mode: PendingMode = RULES_AWAITING_D012_REVIEWER) => MODE_FLAGS[mode];
const SECTIONS = 14;

export type Index = {
  nAyah: number; nWords: number; nTerms: number; nSurah: number; flags: number;
  termOff: Uint32Array; postOff: Uint32Array; postings: Uint32Array; ayahFirstWord: Uint32Array;
  textOff: Uint32Array; nameOff: Uint32Array; wordAyah: Uint16Array; ayahSurah: Uint16Array; ayahNo: Uint16Array;
  termBlob: Uint8Array; textBlob: Uint8Array; nameBlob: Uint8Array; nameEnOff: Uint32Array; nameEnBlob: Uint8Array;
};

export type Result = { s: number; a: number; name: string; en: string; text: string; hl: number[] };
export type SearchOut = { total: number; page: number; results: Result[] };

// The index must have been built with the same rule setting as this code, or queries and index
// words would be folded differently.
export function openIndex(buf: ArrayBuffer, expectFlags = indexFlags()): Index {
  const h = new Uint32Array(buf, 0, 7 + SECTIONS);
  if (h[0] !== INDEX_MAGIC || h[1] !== INDEX_VERSION) throw new Error('bad index');
  const [nAyah, nWords, nTerms, nSurah, flags] = [h[2], h[3], h[4], h[5], h[6]];
  if (flags !== expectFlags) throw new Error('index was built with a different search rule setting');
  const o = (i: number) => h[7 + i];
  const termOff = new Uint32Array(buf, o(0), nTerms + 1);
  const textOff = new Uint32Array(buf, o(4), nAyah + 1);
  const nameOff = new Uint32Array(buf, o(5), nSurah + 1);
  const nameEnOff = new Uint32Array(buf, o(9), nSurah + 1);
  return {
    nAyah, nWords, nTerms, nSurah, flags,
    termOff,
    postOff: new Uint32Array(buf, o(1), nTerms + 1),
    postings: new Uint32Array(buf, o(2), nWords),
    ayahFirstWord: new Uint32Array(buf, o(3), nAyah + 1),
    textOff,
    nameOff,
    wordAyah: new Uint16Array(buf, o(6), nWords),
    ayahSurah: new Uint16Array(buf, o(7), nAyah),
    ayahNo: new Uint16Array(buf, o(8), nAyah),
    termBlob: new Uint8Array(buf, o(10), termOff[nTerms]),
    textBlob: new Uint8Array(buf, o(11), textOff[nAyah]),
    nameBlob: new Uint8Array(buf, o(12), nameOff[nSurah]),
    nameEnOff,
    nameEnBlob: new Uint8Array(buf, o(13), nameEnOff[nSurah]),
  };
}

// Compares term t with q over q's length: <0, 0 (t starts with q), >0.
function cmpPrefix(ix: Index, t: number, q: Uint8Array): number {
  const s = ix.termOff[t], e = ix.termOff[t + 1], b = ix.termBlob;
  for (let i = 0; i < q.length; i++) {
    if (s + i >= e) return -1;
    const d = b[s + i] - q[i];
    if (d) return d;
  }
  return 0;
}

// [lo, hi) range of dictionary terms that start with q.
function range(ix: Index, q: Uint8Array): [number, number] {
  let lo = 0, hi = ix.nTerms;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (cmpPrefix(ix, m, q) < 0) lo = m + 1; else hi = m; }
  const start = lo;
  hi = ix.nTerms;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (cmpPrefix(ix, m, q) <= 0) lo = m + 1; else hi = m; }
  return [start, lo];
}

const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const enc = new TextEncoder();

// With few candidates, the engine's own array scan beats marking a term's words in JS, which runs
// cold on a Worker's first search. The budget caps total scanning in one search.
const SCAN_MAX = 128, SCAN_BUDGET = 1 << 20;

type List = { ps: number; pe: number; size: number; sorted: boolean; view: Uint32Array | null };

// Every term matches a whole word or the start of a word (RQ-002 AC12). Terms must be adjacent,
// inside one ayah. Starts from the term with the fewest words, then checks only those candidates
// against the other terms, rarest first. Work never depends on Mushaf size.
export function search(ix: Index, query: string, page = 1): SearchOut {
  const terms = foldQuery(query).split(/\s+/).filter(Boolean);
  const len = terms.length;
  if (!len) return { total: 0, page, results: [] };
  const post = ix.postings, seen = new Map<string, List>();
  const lists: List[] = new Array(len), order: number[] = new Array(len);
  for (let t = 0; t < len; t++) {
    let l = seen.get(terms[t]);
    if (!l) {
      const [a, b] = range(ix, enc.encode(terms[t]));
      const ps = ix.postOff[a], pe = ix.postOff[b];
      if (ps === pe) return { total: 0, page, results: [] };
      l = { ps, pe, size: pe - ps, sorted: b - a === 1, view: null };
      seen.set(terms[t], l);
    }
    lists[t] = l; order[t] = t;
  }
  // Rarest first; equal lists stay together so one mark can serve them.
  if (len > 1) order.sort((x, y) => lists[x].size - lists[y].size || lists[x].ps - lists[y].ps);
  const seed = order[0], cand = post.slice(lists[seed].ps, lists[seed].pe);
  let m = cand.length, budget = SCAN_BUDGET;
  let mark: Uint8Array | null = null, marked: List | null = null;
  for (let o = 1; o < len && m; o++) {
    const t = order[o], l = lists[t], d = t - seed;
    if (m <= SCAN_MAX && marked !== l && m * l.size <= budget) {
      budget -= m * l.size;
      l.view ??= post.subarray(l.ps, l.pe);
      m = keepScanned(cand, m, l.view, d);
    } else {
      mark ??= new Uint8Array(ix.nWords);
      if (marked !== l) { mark.fill(0); setMarks(mark, post, l.ps, l.pe); marked = l; }
      m = keepMarked(cand, m, mark, d);
    }
  }
  if (!lists[seed].sorted && m > 1) cand.subarray(0, m).sort();
  // Walk matches in Mushaf order; count ayat; keep highlights for the requested page.
  const first = (page - 1) * PAGE, last = first + PAGE, back = len - 1 - seed;
  let total = 0, prev = -1;
  const results: Result[] = [];
  let hl: number[] | null = null;
  for (let i = 0; i < m; i++) {
    const g = cand[i] + back;
    const ay = ix.wordAyah[g];
    if (ay !== prev) {
      // a phrase may run across an ayah boundary in the word order: reject that
      if (ix.wordAyah[g - len + 1] !== ay) continue;
      prev = ay;
      if (total >= first && total < last) { hl = []; results.push(toResult(ix, ay, hl)); } else hl = null;
      total++;
    }
    if (hl) { const p = g - ix.ayahFirstWord[ay]; for (let k = len - 1; k >= 0; k--) { if (!hl.includes(p - k)) hl.push(p - k); } }
  }
  return { total, page, results };
}

// Few candidates: the engine's own array scan, which needs no warm-up. A negative word is simply not found.
function keepScanned(cand: Uint32Array, m: number, view: Uint32Array, d: number): number {
  let n = 0;
  for (let i = 0; i < m; i++) { const c = cand[i]; if (view.includes(c + d)) cand[n++] = c; }
  return n;
}

function setMarks(mark: Uint8Array, post: Uint32Array, ps: number, pe: number): void {
  for (let i = ps; i < pe; i++) mark[post[i]] = 1;
}

// A word outside the Mushaf reads as undefined, which counts as unmarked.
function keepMarked(cand: Uint32Array, m: number, mark: Uint8Array, d: number): number {
  let n = 0;
  for (let i = 0; i < m; i++) { const c = cand[i]; if (mark[c + d]) cand[n++] = c; }
  return n;
}

export function surahName(ix: Index, s: number): string {
  return dec.decode(ix.nameBlob.subarray(ix.nameOff[s - 1], ix.nameOff[s]));
}

// English surah name, as stored in the source (sora_name_en).
export function surahNameEn(ix: Index, s: number): string {
  return dec.decode(ix.nameEnBlob.subarray(ix.nameEnOff[s - 1], ix.nameEnOff[s]));
}

function toResult(ix: Index, ay: number, hl: number[]): Result {
  const s = ix.ayahSurah[ay];
  return {
    s, a: ix.ayahNo[ay],
    name: surahName(ix, s),
    en: surahNameEn(ix, s),
    text: dec.decode(ix.textBlob.subarray(ix.textOff[ay], ix.textOff[ay + 1])),
    hl,
  };
}

// Round 4 input checks, kept for the equality test: 100 characters, ASCII Latin letters rejected.
export function validateRound4(q: unknown): string | null {
  if (typeof q !== 'string' || !q.trim()) return 'empty';
  if ([...q].length > MAX_CHARS) return 'too_long';
  if (/[A-Za-z]/.test(q)) return 'latin';
  return null;
}

// Round 4 handle(), kept unchanged for the equality test. The Worker uses api.ts.
export function handleRound4(ix: Index, raw: string): { status: number; body: string } {
  if (raw.length > 2048) return { status: 413, body: '{"error":"too_long"}' };
  let b: any;
  try { b = JSON.parse(raw); } catch { return { status: 400, body: '{"error":"bad_json"}' }; }
  const bad = validateRound4(b?.q);
  if (bad) return { status: 400, body: JSON.stringify({ error: bad }) };
  const page = Number.isInteger(b.page) && b.page > 0 ? b.page : 1;
  return { status: 200, body: JSON.stringify(search(ix, b.q, page)) };
}
