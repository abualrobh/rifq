// RQ-008 D-186 B, P-23 (kit v39): the stored ayah number, isolated for display only.
// The approved file ends each aya_text with a no-break space (U+00A0) followed by the ayah number in
// digits (D-068). splitAyahNumber returns the text up to and including that last no-break space
// (head) and the digits after it (no), so the reader can wrap the digits in one element for the
// end-of-ayah ornament; head + no is the stored text exactly (AC99). Anything else (no no-break
// space, or anything but digits after it) returns null: that ayah is shown as stored with no
// ornament (AC107), and the build lists its reference.
// Digits: any Unicode decimal digit (the development copy uses Arabic-Indic digits); nothing is
// converted. No character is added (no U+06DD).
export function splitAyahNumber(text: string): { head: string; no: string } | null {
  const i = text.lastIndexOf(' ');
  if (i < 0) return null;
  const no = text.slice(i + 1);
  if (!/^\p{Nd}{1,4}$/u.test(no)) return null;
  return { head: text.slice(0, i + 1), no };
}

// The exact markup the reader page uses around the number (P-23). The build byte check (scripts/
// check-bytes.ts) accepts a reader ayah only when its delivered bytes are the stored bytes with this
// opening tag inserted right after the last no-break space and this closing tag at the end.
export const AYAH_NO_OPEN = '<span class="ayah-no">';
export const AYAH_NO_CLOSE = '</span>';
