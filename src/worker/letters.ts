// The approved Quran text in letters-only form (D-084, D-085), held only inside the Worker bundle.
// D-157: a Worker bundle holding this data (both forms), never served to readers and never in the
// public repository or the static files, counts as private storage under D-039, D-049 and D-085.
// It is used for matching only: /dev/quote-check/ (D-084) and the D-149 display marks (D-156 A).
// Nothing here is ever put into a response.
import { lettersIndex, packedIndex, phraseMatcher, type LettersIndex, type PackedLetters } from '../core/tafseer-quotes.ts';
import { computeMarks } from '../core/tafseer-marks.ts';

// Letters-only text per ayah, in source order: Uthmani (aya_text) and, under D-085, plain spelling
// (aya_text_emlaey). Builds give it packed (`packed`, see packLetters), so a cold Worker only wraps
// it; tests may give the plain lists. `sha256` is the approved file's SHA-256 and `checkVersion` the
// version of the matching code (scripts/build.ts); both go into the Tafseer cache key (D-156 A).
export type LettersQuran = { counts: number[]; letters?: string[]; emlaey?: string[]; packed?: PackedLetters['forms']; sha256?: string; checkVersion?: string };

// Which route built this isolate's index first (kit v30, QA v29 FIND-W: the label was always
// "/api/tafseer request 0" when the quote check or the timing page built it). No time is kept: the
// Workers clock does not move while code runs, so a time measured here would be 0.
export type IndexTiming = { builtBy: string | null };

// Kit v30 (reader CPU): the first runs of the matching code in an isolate are slow (its regular
// expressions, with large Unicode classes, are compiled on first use and compiled again to machine
// code on the next use; the functions are compiled too). Measured locally (Node 22): about 1 to 3 ms
// for the first phrases. warmUp() runs the same code twice on made-up letters (no Quran text) when
// the Worker starts, so that cost is paid at startup rather than inside a reader's first
// /api/tafseer request. This part touches no real data and changes no result; any error is ignored.
// Kit v31 (reader CPU): given the Worker's letters data, it also classifies two probes with the
// passage matcher on a throwaway copy of the packed index (same strings, nothing copied): the first
// word of 1:1 and that word without its first letter, both read from the index itself. That
// compiles the packed-index paths a reader's first passage uses (ayah slices, the own-ayah steps, the
// one-word rule). Nothing leaves the function, the Worker's own index is not built by it (the timing
// page still says which route built that), and no result can change. Measured locally (Node 22,
// not Cloudflare): about +0.5 ms at startup and about -0.5 ms on the first passage. Probes that
// scan the whole text were tried and left out: they cost more at startup than they saved.
export function warmUp(q?: LettersQuran | null): void {
  warmMadeUp();
  try {
    if (!q?.packed) return;
    const ix = packedIndex({ counts: q.counts, forms: q.packed });
    const first = ix.at.get('1:1');
    const f = ix.forms.uthmani ?? ix.forms.emlaey;
    if (first === undefined || !f) return;
    const w = f.ayah(first).split(' ')[0];
    if (!w) return;
    const m = phraseMatcher(ix, { s: 1, from: 1, to: 1 });
    m.kind(w); m.kind(w.slice(1));
  } catch { /* warm-up only */ }
}

function warmMadeUp(): void {
  try {
    const cp = (...c: number[]) => String.fromCodePoint(...c);
    // Made-up words: letters, marks, a hair space + superscript alef + word joiner, a hamza seat.
    const w1 = cp(0x628, 0x64e, 0x62a, 0x651, 0x6e1), w2 = cp(0x633, 0x200a, 0x670, 0x2060, 0x644, 0x64a, 0x654), w3 = cp(0x648, 0x62f, 0x631, 0x632);
    const ix = lettersIndex([{ s: 1, a: 1, letters: `${cp(0x628, 0x62a)} ${cp(0x633, 0x644, 0x626)} ${w3}` }, { s: 1, a: 2, letters: cp(0x641, 0x642, 0x643) }]);
    const html = `<p>x (${w1} ${w2}) y {${cp(0x62f, 0x631, 0x632)}} z (${cp(0x641, 0x642, 0x643)} ${w1}) (${cp(0x637, 0x638, 0x639)} ${cp(0x63a, 0x63a)})</p>`;
    for (let i = 0; i < 3; i++) computeMarks(ix, html, { s: 1, from: 1, to: 1 }, true);
  } catch { /* warm-up only */ }
}

// One index per Worker isolate, built on first use and kept while the isolate lives.
export function makeLetters(q: LettersQuran) {
  let ix: LettersIndex | null = null;
  const timing: IndexTiming = { builtBy: null };
  const rows = () => {
    const out: { s: number; a: number; letters: string; emlaey?: string }[] = [];
    let i = 0;
    for (let s = 1; s < q.counts.length; s++) for (let a = 1; a <= q.counts[s]; a++) { out.push({ s, a, letters: q.letters?.[i] ?? '', emlaey: q.emlaey?.[i] }); i++; }
    return out;
  };
  const make = () => (q.packed ? packedIndex({ counts: q.counts, forms: q.packed }) : lettersIndex(rows()));
  return {
    q,
    timing,
    built: () => ix !== null,
    index(by = 'unnamed'): LettersIndex {
      if (ix) return ix;
      ix = make();
      timing.builtBy = by;
      return ix;
    },
    // Cache-key part (D-156 A): check version and approved-file SHA-256, or "unversioned" when a
    // test config gives neither.
    key: () => `${q.checkVersion ?? 'unversioned'}-${q.sha256 ?? 'nosha'}`,
  };
}
export type Letters = ReturnType<typeof makeLetters>;
