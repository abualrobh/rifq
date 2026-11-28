// RQ-008 stage 4 (kit v40, D-199): first-visit tips, AC79 to AC85, P-12.
// "Tips seen" is one yes/no value on this device only (AC80, A7): the key rifq.tips holds "1" once the
// tips were closed with Skip, Done or Esc. It is never sent anywhere (AC87). Like the other stored
// values it is untrusted input: anything but "1" counts as not seen.
import type { StorageLike } from './store.ts';

export const TIPS_KEY = 'rifq.tips';

// Kit v43 (RQ-009 AC120, P-16): the page-mode tip has its own yes/no "page tip seen" value in the
// same key: "1" reader tips seen, "p" page tip seen, "1p" both. Anything else counts as neither.
export function tipsSeen(st: StorageLike | null): { ok: boolean; seen: boolean } {
  if (!st) return { ok: false, seen: false };
  try { const v = st.getItem(TIPS_KEY); return { ok: true, seen: v === '1' || v === '1p' }; } catch { return { ok: false, seen: false }; }
}
export function pageTipSeen(st: StorageLike | null): { ok: boolean; seen: boolean } {
  if (!st) return { ok: false, seen: false };
  try { const v = st.getItem(TIPS_KEY); return { ok: true, seen: v === 'p' || v === '1p' }; } catch { return { ok: false, seen: false }; }
}

// AC80: records "tips seen" (keeping "page tip seen"). False when it could not be stored.
export function markTipsSeen(st: StorageLike | null): boolean {
  if (!st) return false;
  try { st.setItem(TIPS_KEY, pageTipSeen(st).seen ? '1p' : '1'); return true; } catch { return false; }
}
// RQ-009 AC120: records "page tip seen" (keeping "tips seen"). False when it could not be stored.
export function markPageTipSeen(st: StorageLike | null): boolean {
  if (!st) return false;
  try { st.setItem(TIPS_KEY, tipsSeen(st).seen ? '1p' : 'p'); return true; } catch { return false; }
}

// AC85: "Show tips again" clears "tips seen", and the page tip's value too (RQ-009 AC120). False
// when storage is blocked.
export function clearTipsSeen(st: StorageLike | null): boolean {
  if (!st) return false;
  try { st.removeItem(TIPS_KEY); return true; } catch { return false; }
}

// AC83: each tip mentions only features this build has. Tip 1 names playing and Tafseer, so it is
// shown only in a build with both; RQ-008 has no short variant yet (Open question 4), so a build
// without audio or without Tafseer shows tips 2 and 3 only ("Tip 1 of 2", "Tip 2 of 2"). Builder's
// choice, for Hamzeh to confirm; the test site's kit has both.
export type TipId = 1 | 2 | 3;
export function tipList(audio: boolean, tafseer: boolean): TipId[] {
  return audio && tafseer ? [1, 2, 3] : [2, 3];
}
