// CSV for the D-084 reviewer list (RFC 4180 quoting). Kept apart from tafseer-quotes.ts so the
// development page island does not load the search spelling tables. Phrases are Tafseer text:
// private use only.
export type CsvRow = { ref: string; range: string; bracket: string; label: string; phrase: string; letters: string; result: string; form?: string | null; unclosed?: boolean };

export function reviewCsv(list: CsvRow[]): string {
  const q = (v: string) => '"' + v.replace(/"/g, '""') + '"';
  const head = ['ref', 'range', 'bracket', 'label', 'phrase', 'letters_only', 'result', 'matched_form', 'unclosed'];
  return [head.join(','), ...list.map((r) => [r.ref, r.range, r.bracket, r.label, r.phrase, r.letters, r.result, r.form ?? '', r.unclosed ? 'yes' : ''].map(q).join(','))].join('\r\n') + '\r\n';
}
