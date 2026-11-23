// The reading place on a reader page: the ayah row at the top of the reading area, below the sticky
// header. Shared by the Settings island (text size keeps the place), ReaderTools (D-062) and the
// in-place router (nav.ts: Back to the reader after a text-size change, RQ-008 AC73, QA v37 FIND-BN).
// Moved here from islands/Settings.tsx in kit v38 so the router does not import an island; the
// Settings island re-exports both functions unchanged.

// Bottom edge of the sticky header: rows above it are hidden behind the header.
export function headerBottom(): number {
  return document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
}

// The reading place: the first ayah that starts below the sticky header. If none starts on screen
// (one long ayah fills it), the ayah that covers the top of the reading area.
export function topRow(): { el: Element; top: number } | null {
  const h = headerBottom();
  let cover: Element | null = null;
  for (const el of document.querySelectorAll('.ayah-row')) {
    const r = el.getBoundingClientRect();
    if (r.top >= h - 1) return r.top < innerHeight ? { el, top: r.top } : cover ? { el: cover, top: cover.getBoundingClientRect().top } : null;
    if (r.bottom > h) cover = el;
  }
  return cover ? { el: cover, top: cover.getBoundingClientRect().top } : null;
}
