// Shows one ayah row fully on screen: below the sticky header, above the mini-player and the tab
// bar (RQ-006 AC7, AC64, AC69; RQ-008 AC54). Used by the recitation engine (automatic scrolling), by
// in-place navigation (a link to an ayah, "go to the playing ayah") and by the RQ-008 panels.
import { headerBottom, innerScroller } from './place.ts';

// The top edge of whatever is fixed at the bottom of the screen: the mini-player and, since kit v37,
// the phone tab bar (RQ-008 AC6, AC54; hidden from 52rem, where it is skipped). Kit v38 (D-203 A):
// the reader page has no fixed recitation panel any more.
export function bottomEdge(): number {
  let edge = innerHeight;
  for (const sel of ['[data-mini-player]', 'nav[data-tabbar="bottom"]']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top < edge && r.top > 0) edge = r.top;
  }
  return edge;
}

// Returns true when it scrolled. `smooth` is ignored when the reader asks for reduced motion (AC46).
export function revealRow(row: Element, smooth = false): boolean {
  // Kit v43 (RQ-009 v0.3): on a Mushaf page whose card scrolls inside itself, the card is scrolled
  // so the ayah's first line shows near its top (and the card itself is brought on screen first).
  const sc = row.closest('[data-mushaf-card]') ? innerScroller() : null;
  if (sc) {
    const reduce0 = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const beh = (smooth && !reduce0 ? 'smooth' : 'instant') as ScrollBehavior;
    const c = sc.getBoundingClientRect();
    const first = row.getClientRects()[0] ?? row.getBoundingClientRect();
    const last = row.getClientRects()[row.getClientRects().length - 1] ?? first;
    if (first.top >= c.top && last.bottom <= c.bottom) return false;
    sc.scrollBy({ top: first.top - c.top - 8, behavior: beh });
    return true;
  }
  const top = headerBottom(); // kit v39: 0 when the header is not sticky (large text)
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
