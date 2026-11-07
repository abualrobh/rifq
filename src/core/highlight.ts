// Highlighting by whole word position, so no span splits joined letters (RQ-002 AC3).
// The pieces join back to exactly the input string: nothing is added, removed or normalized.
import { NOT_WORD, WORD_SPLIT_KEEP } from './fold.ts';

export type Piece = { text: string; hl: boolean };

export function segment(text: string, hl: readonly number[]): Piece[] {
  let word = -1;
  const out: Piece[] = [];
  for (const p of text.split(WORD_SPLIT_KEEP)) {
    if (!p) continue;
    if (p === ' ' || p === '\u00a0' || NOT_WORD.test(p)) { out.push({ text: p, hl: false }); continue; }
    word++;
    out.push({ text: p, hl: hl.includes(word) });
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
