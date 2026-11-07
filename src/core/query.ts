// Small, data-free query helpers shared by the browser island and the Worker.
export const MAX_CHARS = 100;

// D-050: any Latin letter makes it an English query. Digits of any script are allowed.
export function validate(q: unknown): 'empty' | 'too_long' | 'latin' | null {
  if (typeof q !== 'string' || !q.trim()) return 'empty';
  if ([...q].length > MAX_CHARS) return 'too_long';
  if (/\p{Script=Latin}/u.test(q)) return 'latin';
  return null;
}

// Arabic-Indic and Extended Arabic-Indic digits to ASCII digits (D-050, and V-27 under D-072).
// References only, never Quran text.
export function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (c) => String((c.charCodeAt(0) & 0xf) % 10));
}

// Accepted reference forms (D-064, D-072): "S" or "S:A", in Latin, Arabic-Indic or Extended
// Arabic-Indic digits. Spaces around the colon are allowed, so "S : A" is a reference (Q081, D-072).
export function parseRef(q: string): { s: number; a?: number } | null {
  const t = asciiDigits(q.trim());
  let m = /^(\d{1,4})$/.exec(t);
  if (m) return { s: Number(m[1]) };
  m = /^(\d{1,4})\s*:\s*(\d{1,4})$/.exec(t);
  if (m) return { s: Number(m[1]), a: Number(m[2]) };
  return null;
}

