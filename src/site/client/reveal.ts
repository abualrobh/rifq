// Shows one ayah row fully on screen: below the sticky header, above the reader page's player and
// the mini-player (RQ-006 AC7, AC64, AC69). Used by the recitation engine (automatic scrolling) and
// by in-place navigation (a link to an ayah, "go to the playing ayah").

// The top edge of whatever is fixed or sticky at the bottom of the screen (player, mini-player).
export function bottomEdge(): number {
  let edge = innerHeight;
  for (const sel of ['[data-player]', '[data-mini-player]']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top < edge && r.top > 0) edge = r.top;
  }
  return edge;
}

// Returns true when it scrolled. `smooth` is ignored when the reader asks for reduced motion (AC46).
export function revealRow(row: Element, smooth = false): boolean {
  const top = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
  const bar = bottomEdge();
  const r = row.getBoundingClientRect();
  // Fully on screen already: nothing to do. An ayah taller than the space is shown from its start.
  if (r.top >= top && r.bottom <= bar) return false;
  if (r.height > bar - top && Math.abs(r.top - top - 8) <= 4) return false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // An 8 px margin above, less when the ayah only just fits, so its end stays above the player.
  const margin = Math.min(8, Math.max(0, bar - top - r.height));
  window.scrollBy({ top: r.top - top - margin, behavior: (smooth && !reduce ? 'smooth' : 'instant') as ScrollBehavior });
  return true;
}
