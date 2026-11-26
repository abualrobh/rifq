// Bottom sheets as native modal dialogs (showModal: the page behind is inert). Moved here unchanged
// from islands/AyahPanels.tsx in kit v42, so the mini-player's "more" sheet (D-270 A) uses the same
// behaviour as the ayah actions and Tafseer panels without loading their code.
import type { KeyboardEvent as RKeyboardEvent } from 'react';

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Opening a modal dialog must not move the reader (AC35): the scroll position is put back if the
// browser moved it, and focus goes to the heading inside the dialog (AC33).
export function openModal(d: HTMLDialogElement | null, focusSel: string) {
  if (!d || d.open) return;
  const x = scrollX, y = scrollY;
  try { d.showModal(); } catch { d.setAttribute('open', ''); }
  d.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
  if (scrollX !== x || scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
}
export function closeModal(d: HTMLDialogElement | null) {
  if (!d?.open) return;
  const x = scrollX, y = scrollY;
  d.close();
  if (scrollX !== x || scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
}
// Tab and Shift+Tab stay inside the dialog (AC33), on every browser.
export function trap(e: RKeyboardEvent<HTMLDialogElement>) {
  if (e.key !== 'Tab') return;
  const box = e.currentTarget;
  const f = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
  if (!f.length) return;
  const cur = document.activeElement as HTMLElement | null;
  const i = cur ? f.indexOf(cur) : -1;
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && (i === f.length - 1 || i === -1 && !box.contains(cur))) { e.preventDefault(); f[0].focus(); }
}
