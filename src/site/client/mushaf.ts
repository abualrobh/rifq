// RQ-009 v0.3 (D-286, kit v43): turning Mushaf pages. Loaded once per tab (it stays loaded across
// in-place page changes); it acts on the Mushaf page on screen ([data-mushaf]).
// - AC14, D-281 A: the next page lies to the left in both interfaces. A swipe with the finger
//   moving from left to right opens the next page; from right to left, the previous page.
// - AC15, P-3, P-4: a swipe counts only with one finger, at least 50 px sideways and at least twice
//   the up-down move, started more than 20 px from the screen's left and right edges, with no text
//   selection and no dialog, sheet or panel open. Mouse and pen drags never turn a page.
// - AC17, P-6: with focus on the page card or the page-turn row (not in a text field, panel or the
//   mini-player), Left Arrow opens the next page and Right Arrow the previous one; Page Down,
//   Page Up and Space scroll as usual and turn the page only when there is nothing left to scroll
//   in that direction.
// - AC19: after a turn, "Page {p} · Juz {j}" is said once. A button or key turn moves focus to the
//   new page's heading; a swipe or an automatic turn does not move focus.
// - AC20, P-7: a short slide (200 ms) in the turn direction; none with reduced motion.
// - AC21: the page changes in place (Astro's router), so a recitation keeps playing.
// - AC35, AC36, D-280 A: while the page shown holds the playing surah, the page turns by itself to
//   the playing ayah's page (the recitation engine asks with rifq:playing-elsewhere); a turn by hand
//   pauses this for 5 s (the engine's SCROLL_PAUSE_MS), then it resumes if the page still holds the
//   playing surah. An automatic turn moves no focus (AC19, D-272).
// Nothing here is stored except the view choice (client/view.ts), and nothing is sent anywhere.
import { navigate } from 'astro:transitions/client';
import { t, type Lang } from '../../core/strings.ts';
import { getEngine } from './recitation.ts';
import { pageHref } from './view.ts';

export const SWIPE_MIN_PX = 50;
export const SWIPE_EDGE_PX = 20;
export const TURN_MS = 200;
type How = 'button' | 'key' | 'swipe' | 'auto';
let pending: { how: How; dir: 1 | -1 } | null = null;

const mushaf = () => document.querySelector<HTMLElement>('[data-mushaf]');
const lang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'ar');
const blocked = () => !!document.querySelector('dialog[open]') || !!document.documentElement.dataset.panel;

function turn(dir: 1 | -1, how: How) {
  const m = mushaf();
  if (!m) return;
  const href = dir > 0 ? m.dataset.nextHref : m.dataset.prevHref;
  if (!href) return; // AC18: no page there
  pending = { how, dir };
  void navigate(href);
}

// ----- swipe (touch only) -----
let start: { x: number; y: number; ok: boolean } | null = null;
function onTouchStart(e: TouchEvent) {
  start = null;
  if (!mushaf() || e.touches.length !== 1) return;
  const card = (e.target as Element | null)?.closest?.('[data-mushaf-card], .mp-turn');
  if (!card) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  const edge = x <= SWIPE_EDGE_PX || x >= innerWidth - SWIPE_EDGE_PX;
  start = { x, y, ok: !edge };
}
function onTouchMove(e: TouchEvent) { if (start && e.touches.length !== 1) start.ok = false; }
function onTouchEnd(e: TouchEvent) {
  const s = start;
  start = null;
  if (!s || !s.ok || e.touches.length > 0 || e.changedTouches.length !== 1 || blocked()) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed && sel.toString().length) return;
  const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
  turn(dx > 0 ? 1 : -1, 'swipe');
}

// ----- keys -----
function scroller(): { el: HTMLElement | null; atEnd: boolean; atStart: boolean } {
  const card = document.querySelector<HTMLElement>('[data-mushaf-card]');
  if (card && card.scrollHeight > card.clientHeight + 1 && getComputedStyle(card).overflowY !== 'visible') {
    return { el: card, atEnd: card.scrollTop + card.clientHeight >= card.scrollHeight - 2, atStart: card.scrollTop <= 1 };
  }
  const d = document.documentElement;
  return { el: null, atEnd: scrollY + innerHeight >= d.scrollHeight - 2, atStart: scrollY <= 1 };
}
function onKey(e: KeyboardEvent) {
  if (!mushaf() || e.altKey || e.ctrlKey || e.metaKey || blocked()) return;
  const f = document.activeElement;
  if (!(f instanceof Element) || !f.closest('[data-mushaf-card], .mp-turn')) return;
  if (f.closest('input, textarea, select, [contenteditable], [data-mini-player], dialog')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); turn(1, 'key'); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); turn(-1, 'key'); return; }
  if (f.closest('a, button') && e.key === ' ') return;
  const sc = scroller();
  if ((e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) && sc.atEnd) { e.preventDefault(); turn(1, 'key'); }
  else if ((e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) && sc.atStart) { e.preventDefault(); turn(-1, 'key'); }
}

// ----- buttons (Previous, Next: plain links, so the router opens them; noted here for AC19) -----
function onClick(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.('a[data-page-next], a[data-page-prev]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  pending = { how: e.detail === 0 ? 'key' : 'button', dir: a.hasAttribute('data-page-next') ? 1 : -1 };
}

// ----- the recitation (D-280 A) -----
function onPlayingElsewhere(e: Event) {
  const d = (e as CustomEvent<{ s: number; a: number }>).detail;
  const m = mushaf();
  if (!m || !d) return;
  const href = pageHref(lang(), d.s, d.a, false, false);
  if (!href || href === location.pathname) return;
  pending = { how: 'auto', dir: 1 };
  void navigate(href);
}

function onLoad() {
  const m = mushaf();
  const p = pending;
  pending = null;
  if (!m || !p) return;
  const l = lang(), n = Number(m.dataset.mushaf), j = Number(m.dataset.juz);
  const status = m.querySelector<HTMLElement>('[data-page-status]');
  if (status) { status.textContent = ''; requestAnimationFrame(() => { status.textContent = t(l, 'pageTurned', { p: n, j }); }); }
  const card = m.querySelector<HTMLElement>('[data-mushaf-card]');
  if (card && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    card.classList.add(p.dir > 0 ? 'mp-in-next' : 'mp-in-prev');
    window.setTimeout(() => card.classList.remove('mp-in-next', 'mp-in-prev'), TURN_MS + 50);
  }
  const engine = getEngine();
  if (p.how === 'auto') { engine?.reveal(); return; }
  if (p.how === 'button' || p.how === 'key') m.ownerDocument.querySelector<HTMLElement>('[data-mushaf-h]')?.focus({ preventScroll: true });
  // AC36: a turn by hand during surah playback pauses the automatic turns for 5 s.
  engine?.pauseFollow();
}

const w = (typeof window === 'undefined' ? {} : window) as unknown as { __rifqMushaf?: boolean };
if (typeof document !== 'undefined' && !w.__rifqMushaf) {
  w.__rifqMushaf = true;
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('rifq:playing-elsewhere', onPlayingElsewhere);
  document.addEventListener('astro:page-load', onLoad);
}
