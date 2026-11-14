// The approved Quran text in letters-only form (D-084, D-085), held only inside the Worker bundle.
// D-157: a Worker bundle holding this data (both forms), never served to readers and never in the
// public repository or the static files, counts as private storage under D-039, D-049 and D-085.
// It is used for matching only: /dev/quote-check/ (D-084) and the D-149 display marks (D-156 A).
// Nothing here is ever put into a response.
import { lettersIndex, packedIndex, type LettersIndex, type PackedLetters } from '../core/tafseer-quotes.ts';

// Letters-only text per ayah, in source order: Uthmani (aya_text) and, under D-085, plain spelling
// (aya_text_emlaey). Builds give it packed (`packed`, see packLetters), so a cold Worker only wraps
// it; tests may give the plain lists. `sha256` is the approved file's SHA-256 and `checkVersion` the
// version of the matching code (scripts/build.ts); both go into the Tafseer cache key (D-156 A).
export type LettersQuran = { counts: number[]; letters?: string[]; emlaey?: string[]; packed?: PackedLetters['forms']; sha256?: string; checkVersion?: string };

// Which route built this isolate's index first (kit v30, QA v29 FIND-W: the label was always
// "/api/tafseer request 0" when the quote check or the timing page built it). No time is kept: the
// Workers clock does not move while code runs, so a time measured here would be 0.
export type IndexTiming = { builtBy: string | null };

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
