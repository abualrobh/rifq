// The reading place on a reader page: the ayah row at the top of the reading area, below the sticky
// header. Shared by the Settings island (text size keeps the place), ReaderTools (D-062) and the
// in-place router (nav.ts: Back to the reader after a text-size change, RQ-008 AC73, QA v37 FIND-BN).
// Moved here from islands/Settings.tsx in kit v38 so the router does not import an island; the
// Settings island re-exports both functions unchanged.

// Bottom edge of the sticky header: rows above it are hidden behind the header. Kit v39: at large
// text the reader header is not sticky (it scrolls away with the page, html.rifq-tall-text), so
// nothing is hidden behind it and the reading area starts at the top of the screen.
export function headerBottom(): number {
  const h = document.querySelector('.site-header');
  if (!h || getComputedStyle(h).position !== 'sticky') return 0;
  return h.getBoundingClientRect().bottom;
}

// Kit v43 (RQ-009 v0.3): the Mushaf page card when it scrolls inside itself (page mode at normal
// sizes, D-283 B); null otherwise.
export function innerScroller(): HTMLElement | null {
  const c = document.querySelector<HTMLElement>('[data-mushaf-card]');
  if (!c || c.scrollHeight <= c.clientHeight + 1) return null;
  const o = getComputedStyle(c).overflowY;
  return o === 'auto' || o === 'scroll' ? c : null;
}

// The reading place: the first ayah that starts below the sticky header. If none starts on screen
// (one long ayah fills it), the ayah that covers the top of the reading area.
// Kit v43 (RQ-009 AC31): on a Mushaf page the ayat flow inline, so an ayah "starts" where its first
// line starts (its first box), and the reading area is the part of the page card on screen.
export function topRow(): { el: Element; top: number } | null {
  let h = headerBottom(), bottom = innerHeight;
  const sc = innerScroller();
  if (sc) { const b = sc.getBoundingClientRect(); h = Math.max(h, b.top); bottom = Math.min(bottom, b.bottom); }
  let cover: Element | null = null;
  for (const el of document.querySelectorAll('.ayah-row')) {
    const box = el.getBoundingClientRect();
    const first = el.getClientRects()[0] ?? box;
    if (first.top >= h - 1) return first.top < bottom ? { el, top: first.top } : cover ? { el: cover, top: cover.getBoundingClientRect().top } : null;
    if (box.bottom > h) cover = el;
  }
  return cover ? { el: cover, top: cover.getBoundingClientRect().top } : null;
}
