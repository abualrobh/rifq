// SEARCH-ONLY form (D-027, D-072, D-073). It is applied to search input and to the words of the
// search index, never to displayed text. Displayed ayah text is always the raw source bytes.
// No Unicode normalization runs anywhere: every rule is an explicit code point table below, taken
// from the draft variant list (private-data/drafts/d027-variant-list.json) by rule ID.
// Code points are written as numbers so that this file holds no Arabic-script characters.
import { PRESENTATION_FORMS } from './presentation-forms.ts';
import { RULES_AWAITING_D012_REVIEWER, type PendingMode } from './search-config.ts';

export type RuleStatus = 'D-073' | 'D-072' | 'D-074' | 'awaiting D-012 reviewer';
export type Rule = {
  id: string;
  status: RuleStatus;
  // 'query' rules act on search input only. 'both' rules act on search input and index words.
  side: 'both' | 'query';
  seq?: [number[], number[]][]; // sequence replacements, applied first
  map?: [number, number[]][]; // single code point to code points
  remove?: number[];
  // For rules awaiting the D-012 reviewer: what the interim mode does (the round 1 placeholder).
  interimRemove?: number[];
};

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// V-25 (D-072): letters of other Arabic-script keyboards read as the Arabic letter they stand for.
// U+06CC and U+06A9 follow the draft list's measured alternative. The three heh forms map to heh.
export const V25_MAP: [number, number[]][] = [
  [0x06cc, [0x064a]], // FARSI YEH -> YEH
  [0x06a9, [0x0643]], // KEHEH -> KAF
  [0x06c1, [0x0647]], // HEH GOAL -> HEH
  [0x06be, [0x0647]], // HEH DOACHASHMEE -> HEH
  [0x06d5, [0x0647]], // AE -> HEH
];

export const RULES: Rule[] = [
  // Approved under D-073 (no reviewer needed).
  { id: 'V-01', status: 'D-073', side: 'both', remove: [0x064e, 0x064f, 0x0650] },
  { id: 'V-02', status: 'D-073', side: 'both', remove: [0x064b, 0x064c, 0x064d] },
  { id: 'V-03', status: 'D-073', side: 'both', remove: [0x0651] },
  { id: 'V-04', status: 'D-073', side: 'both', remove: [0x0652, 0x06e1, 0x06e0, 0x06df] },
  { id: 'V-06', status: 'D-073', side: 'both', remove: [0x0653, 0x06e4] },
  { id: 'V-08', status: 'D-073', side: 'both', remove: [0x0640] },
  { id: 'V-12', status: 'D-073', side: 'both', map: [[0x0671, [0x0627]]] },
  { id: 'V-16', status: 'D-073', side: 'both' }, // standalone hamza is kept
  { id: 'V-19', status: 'D-073', side: 'both', remove: range(0x06d6, 0x06dc) },
  { id: 'V-20', status: 'D-073', side: 'both', remove: [0x06e2, 0x06e3, 0x06e9, 0x06ea, 0x06eb, 0x06ec, 0x06ed] },
  { id: 'V-21', status: 'D-073', side: 'both', remove: [0x06de, 0x06dd, 0xfd3e, 0xfd3f] },
  { id: 'V-22', status: 'D-073', side: 'both' }, // ayah number digits are not words (fold.ts NOT_WORD)
  { id: 'V-23', status: 'D-073', side: 'both' }, // any whitespace separates query words
  { id: 'V-24', status: 'D-073', side: 'query', remove: [0x061c, ...range(0x200b, 0x200f), ...range(0x202a, 0x202e), ...range(0x2066, 0x2069), 0xfeff] },
  { id: 'V-28', status: 'D-073', side: 'both', remove: [0x0658, 0x0659, 0x065a, 0x065b, 0x065c, 0x065d, 0x065f] },
  // Approved under D-072 (query side). V-27 is handled in query.ts (reference digits). V-14 is
  // approved under D-074 and listed below with the reviewer rules it came from.
  { id: 'V-25', status: 'D-072', side: 'query', map: V25_MAP },
  { id: 'V-26', status: 'D-072', side: 'query', map: PRESENTATION_FORMS.map(([c, to]) => [c, [...to]]) },
  { id: 'V-27', status: 'D-072', side: 'query' },
  // Awaiting the D-012 reviewer; see RULES_AWAITING_D012_REVIEWER in search-config.ts. The seq, map
  // and remove operations are the draft list's proposals ('draft' mode). interimRemove is the round 1
  // placeholder behaviour for the same code points ('interim-placeholder' mode, awaiting the
  // reviewer); a rule with no interimRemove keeps its characters in that mode, as the placeholder did.
  { id: 'V-05', status: 'awaiting D-012 reviewer', side: 'both', remove: [0x0656, 0x0657, 0x065e], interimRemove: [0x0656, 0x0657, 0x065e] },
  { id: 'V-07', status: 'awaiting D-012 reviewer', side: 'both', remove: [0x0670], interimRemove: [0x0670] },
  { id: 'V-09', status: 'awaiting D-012 reviewer', side: 'both', remove: [0x06e5, 0x06e6], interimRemove: [0x06e5, 0x06e6] },
  { id: 'V-10', status: 'awaiting D-012 reviewer', side: 'both', interimRemove: [0x06e7, 0x06e8], seq: [[[0x0640, 0x06e7], [0x064a]], [[0x0640, 0x06e8], [0x0646]]], map: [[0x06e7, [0x064a]], [0x06e8, [0x0646]]] },
  { id: 'V-11', status: 'awaiting D-012 reviewer', side: 'both', interimRemove: [0x0654, 0x0655], seq: [[[0x0640, 0x0654], [0x0621]], [[0x064a, 0x0655], [0x0621]], [[0x0648, 0x0655], [0x0621]]], map: [[0x0654, [0x0621]], [0x0655, [0x0621]]] },
  { id: 'V-13', status: 'awaiting D-012 reviewer', side: 'both', seq: [[[0x0622], [0x0621, 0x0627]]] },
  // V-14 is ON: approved under D-074 (2026-11-07) for search input and index words only, pending
  // the D-012 reviewer, who can change it later. Alef with hamza above or below reads as plain alef.
  { id: 'V-14', status: 'D-074', side: 'both', map: [[0x0623, [0x0627]], [0x0625, [0x0627]]] },
  { id: 'V-15', status: 'awaiting D-012 reviewer', side: 'both', map: [[0x0624, [0x0621]], [0x0626, [0x0621]]] },
  { id: 'V-17', status: 'awaiting D-012 reviewer', side: 'both' }, // draft keeps alef maqsura and yeh apart
  { id: 'V-18', status: 'awaiting D-012 reviewer', side: 'both' }, // draft keeps ta marbuta and heh apart
];

const pending = (r: Rule) => r.status === 'awaiting D-012 reviewer';
// True when a rule acts as drafted. A pending rule in interim mode acts through interimRemove only.
export const isOn = (r: Rule, mode: PendingMode = RULES_AWAITING_D012_REVIEWER) => !pending(r) || mode === 'draft';

type Compiled = { seq: [string, string][]; cp: Map<number, string> };

const str = (cps: readonly number[]) => String.fromCodePoint(...cps);

// Order follows the draft list: removals of query-only controls, then query-only maps, then
// sequence replacements, then single code point maps and removals.
function compile(side: 'index' | 'query', mode: PendingMode): { pre: Map<number, string>; main: Compiled } {
  const pre = new Map<number, string>();
  const main: Compiled = { seq: [], cp: new Map() };
  for (const r of RULES) {
    if (pending(r) && mode === 'interim-placeholder') { for (const c of r.interimRemove ?? []) main.cp.set(c, ''); continue; }
    if (!isOn(r, mode)) continue;
    if (r.side === 'query') {
      if (side !== 'query') continue;
      for (const c of r.remove ?? []) pre.set(c, '');
      for (const [c, to] of r.map ?? []) if (!pre.has(c)) pre.set(c, str(to));
      continue;
    }
    for (const [from, to] of r.seq ?? []) main.seq.push([str(from), str(to)]);
    for (const [c, to] of r.map ?? []) main.cp.set(c, str(to));
    for (const c of r.remove ?? []) main.cp.set(c, '');
  }
  return { pre, main };
}

function mapCps(s: string, m: Map<number, string>): string {
  let out = '';
  for (const ch of s) {
    const v = m.get(ch.codePointAt(0)!);
    out += v === undefined ? ch : v;
  }
  return out;
}

function applyMain(s: string, c: Compiled): string {
  for (const [from, to] of c.seq) s = s.split(from).join(to);
  return mapCps(s, c.cp);
}

export function makeFolds(mode: PendingMode = RULES_AWAITING_D012_REVIEWER) {
  const ix = compile('index', mode).main;
  const q = compile('query', mode);
  return {
    // A word of the search index. Built from source words at build time only.
    term: (s: string) => applyMain(s, ix),
    // Search input. V-26 output is passed through V-25, so a Farsi yeh form reads as yeh.
    query: (s: string) => applyMain(mapCps(mapCps(s, q.pre), q.pre), q.main),
  };
}

const DEFAULT = makeFolds();
export const foldTerm = DEFAULT.term;
export const foldQuery = DEFAULT.query;

// Code points that only query-side rules act on. The build checks that the source has none of
// them, so applying those rules to the index would change nothing.
export function queryOnlyCodePoints(): Set<number> {
  const s = new Set<number>();
  for (const r of RULES) if (r.side === 'query') { for (const c of r.remove ?? []) s.add(c); for (const [c] of r.map ?? []) s.add(c); }
  return s;
}
