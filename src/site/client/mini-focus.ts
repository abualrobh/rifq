// Kit v43 (D-272 A, QA v42 FIND-CS): which of the mini-player's controls has focus (its data-mini-*
// key), or null when focus is elsewhere or inside the "more" sheet. MiniPlayer.tsx remembers it just
// before the bar switches layout and focuses the same control in the new layout.
export const MINI_KEYS = ['prev', 'toggle', 'next', 'more', 'go', 'close'] as const;
export function focusedKey(box: HTMLElement | null): string | null {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (!box || !el || !box.contains(el) || el.closest('[data-mini-sheet]')) return null;
  return MINI_KEYS.find((k) => el.hasAttribute(`data-mini-${k}`)) ?? null;
}
