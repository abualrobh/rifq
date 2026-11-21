// Latin runs inside Arabic interface text (decision IDs such as D-076, "SHA-256", "Quran
// Foundation"). In a right-to-left paragraph some browsers (iPhone Safari, reported on the Tafseer
// dev notice) reorder these runs and the Arabic commas or brackets around them. Each run is isolated
// as its own left-to-right box (<bdi dir="ltr">), so it keeps its own order and the punctuation
// around it stays in place. The text itself is never changed: joining the parts gives the string
// back exactly. English interface text needs no isolation and is returned as one part.
export type BidiPart = { text: string; ltr: boolean };

// A Latin word with optional -digits or -letters pieces (D-076, SHA-256), and further Latin words
// joined by single spaces (Quran Foundation). Digits on their own are not isolated.
const LATIN_RUN = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*(?: [A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)*/g;

export function bidiParts(text: string, rtl: boolean): BidiPart[] {
  if (!rtl) return [{ text, ltr: false }];
  const out: BidiPart[] = [];
  let at = 0;
  for (const m of text.matchAll(LATIN_RUN)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), ltr: false });
    out.push({ text: m[0], ltr: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), ltr: false });
  return out;
}

// For HTML written as a string (the Worker's no-JavaScript pages). `esc` escapes text for HTML.
export function bidiHtml(text: string, rtl: boolean, esc: (s: string) => string): string {
  return bidiParts(text, rtl).map((p) => (p.ltr ? `<bdi dir="ltr">${esc(p.text)}</bdi>` : esc(p.text))).join('');
}

// RQ-007 AC20 (kit v34): Arabic runs inside an English Tafseer passage. A run is a stretch of
// Arabic-script characters (the Arabic blocks and presentation forms, written as escapes because
// only strings.ts may hold Arabic characters), with the spaces and joiners between them; a space
// at either end stays outside. The browser marks each run lang="ar" and shows it right to left
// inside the English line. The text is never changed: joining the parts gives the string back
// exactly (unit-tested), so where a run cannot be marked the text wins (P-4).
// The ornate parentheses U+FD3E and U+FD3F are brackets, not letters: an English phrase in them
// stays outside any Arabic run (since kit v35 they join a run only around an Arabic quotation).
//
// Kit v35 (B2, RQ-007 R-5): the neutral marks that belong to an Arabic quotation go into its run,
// so they are laid out right to left with it, exactly as the same characters are shown in an
// Arabic paragraph (no character is added, removed or swapped; the browser's own mirroring does
// the rest):
//   - a quotation: an opening mark (guillemet U+00AB, double quote U+201C or U+0022, single
//     guillemet U+2039, a round bracket, or an ornate parenthesis in either order, as D-078 reads
//     them) followed, after optional spaces, by an Arabic letter, up to its closing mark (U+00BB,
//     U+201D, U+0022, U+203A, U+0029, the other ornate parenthesis), when everything between is
//     Arabic script, digits, spaces and punctuation, with no letter of another script and no line
//     break; the whole quotation, marks included, is one run;
//   - digits between two Arabic words stay in the run (an Arabic number inside a quotation);
//   - an opening guillemet right before a run that reaches the end of its line (a quotation that
//     goes on after markup), or a closing guillemet right after a run that starts the text, joins
//     that run;
//   - runs separated only by spaces or digits are one run.
// Words of English around a run keep their English order: a letter of another script always ends a
// run, and English commas or full stops next to a run stay outside it.
//
// Kit v36 (QA v35 FIND-BA; still no character added, removed or changed):
//   - a bracket or guillemet quotation finds its own closing mark, counting nested pairs of the
//     same kind, so "( A (B) )" is one run with both outer brackets (it was "( A (B)" and a lone ")");
//   - curly double quotes U+201C/U+201D are not mirrored by the browser, so inside a right-to-left
//     run they showed reversed; they now stay outside the run, in the English line, around it;
//   - the caller says whether the text starts or ends a line (`edges`). The "opening guillemet
//     before a run that reaches the end of the text" and "closing guillemet after a run that
//     starts the text" rules apply only there, so a quotation split by markup inside one line no
//     longer leaves a closing guillemet in the middle (the view groups such a quotation instead,
//     src/core/tafseer-display.ts quoteGroups). Without `edges` both apply, as in kit v35.
const AR_CHAR_SRC = '[\\u0600-\\u06FF\\u0750-\\u077F\\u0870-\\u089F\\u08A0-\\u08FF\\uFB50-\\uFD3D\\uFD40-\\uFDFF\\uFE70-\\uFEFE]';
const AR_CHAR = new RegExp(AR_CHAR_SRC);
const GAP_SRC = '[ \\u00A0\\u200A-\\u200F\\u2060]';
const AR_RUN = new RegExp(`${AR_CHAR_SRC}(?:(?:${GAP_SRC}|[0-9])*${AR_CHAR_SRC})*`, 'g');
const GAP_ONLY = new RegExp(`^(?:${GAP_SRC}|[0-9])*$`);
const SPACE = new RegExp(`^${GAP_SRC}$`);
const QUOTE_CLOSE: Record<string, string> = { '\u00ab': '\u00bb', '\u201c': '\u201d', '"': '"', '\u2039': '\u203a', '(': ')', '\ufd3f': '\ufd3e', '\ufd3e': '\ufd3f' };
// Only quotation marks (not brackets) join a run across markup or a line break.
const OPEN_ONLY = new Set(['\u00ab', '\u2039']);
const CLOSE_ONLY = new Set(['\u00bb', '\u203a']);
// A letter of any script but Arabic (Latin, Greek, Cyrillic, ...): it ends a run and spoils a quotation.
const OTHER_LETTER = /(?!\p{Script_Extensions=Arabic})\p{L}/u;
export const hasOtherLetter = (t: string) => OTHER_LETTER.test(t);
export type RunPart = { text: string; ar: boolean };
export type RunEdges = { open: boolean; close: boolean };
// The index of the closing mark that pairs with an opening mark before `from`, counting nested pairs
// of the same kind (only where the two marks differ), up to `end`; -1 if there is none.
function pairClose(text: string, from: number, end: number, open: string, close: string): number {
  if (open === close) { const c = text.indexOf(close, from); return c >= 0 && c < end ? c : -1; }
  let depth = 0;
  for (let k = from; k < end; k++) {
    if (text[k] === open) depth++;
    else if (text[k] === close) { if (depth === 0) return k; depth--; }
  }
  return -1;
}
export function arabicRuns(text: string, edges: RunEdges = { open: true, close: true }): RunPart[] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(AR_RUN)) spans.push([m.index!, m.index! + m[0].length]);
  if (!spans.length) return [{ text, ar: false }];
  // Quotations: grow a run over its opening mark and up to its closing mark.
  for (let k = 0; k < spans.length; k++) {
    let [a, b] = spans[k];
    let i = a - 1;
    while (i >= 0 && SPACE.test(text[i])) i--;
    const open = i >= 0 ? text[i] : '';
    const close = QUOTE_CLOSE[open];
    // Plain and curly double quotes look the same at both ends: only one written right against
    // the Arabic word counts, so an English quotation's closing mark is never taken as an opening.
    const tight = open === '"' || open === '\u201c';
    if (close !== undefined && !(tight && i !== a - 1)) {
      const lineEnd = text.indexOf('\n', b) < 0 ? text.length : text.indexOf('\n', b);
      const c = pairClose(text, b, lineEnd, open, close);
      if (c >= 0 && !hasOtherLetter(text.slice(i + 1, c)) && !(tight && SPACE.test(text[c - 1]))) {
        // Curly quotes stay outside (kit v36): the run is the quoted words up to the closing mark.
        if (open === '\u201c') b = Math.max(b, c); else { a = i; b = c + 1; }
      }
      else if (edges.open && OPEN_ONLY.has(open) && c < 0 && text.slice(b, lineEnd).trim() === '') a = i;
    }
    // A closing mark right after a run that starts the text.
    if (edges.close && a === spans[k][0] && b < text.length && CLOSE_ONLY.has(text[b]) && text.slice(0, a).trim() === '') b += 1;
    spans[k] = [a, b];
  }
  // Join runs that overlap, touch, or are separated only by spaces and digits.
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && (sp[0] <= last[1] || GAP_ONLY.test(text.slice(last[1], sp[0])))) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  const out: RunPart[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: text.slice(at, a), ar: false });
    out.push({ text: text.slice(a, b), ar: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), ar: false });
  return out;
}
// A text that is one Arabic line: Arabic letters and no letter of another script (kit v35, B2: a
// paragraph of the English passage holding only such a line is laid out right to left as a whole).
export const isArabicLine = (t: string) => AR_CHAR.test(t) && !hasOtherLetter(t);

// Kit v36 (QA v35 FIND-BA 2): a line that is Arabic with a few words of another script, such as a
// name in Latin letters: its first and last letters are Arabic and at least two thirds of its
// letters are Arabic. The view lays it out right to left like an Arabic line and isolates the other
// words left to right, so the Arabic reads in order and the Latin words keep theirs.
const AR_SCRIPT_LETTER = /\p{Script_Extensions=Arabic}/u;
export function isMostlyArabicLine(t: string): boolean {
  const letters = t.match(/\p{L}/gu);
  if (!letters || !AR_CHAR.test(t)) return false;
  let ar = 0;
  for (const l of letters) if (AR_SCRIPT_LETTER.test(l)) ar++;
  const other = letters.length - ar;
  return other > 0 && ar >= 2 * other && AR_SCRIPT_LETTER.test(letters[0]) && AR_SCRIPT_LETTER.test(letters[letters.length - 1]);
}
