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
