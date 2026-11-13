// RQ-006 v1.3 (D-126 1A): pages change in place, so a recitation keeps playing across RIFQ.
//
// Choice: Astro's own client router (<ClientRouter /> in the layout) with the <audio> element and
// the mini-player persisted (transition:persist). Why: it is part of the Astro version RIFQ already
// pins (no new dependency, no code from another origin), it swaps head and body the way the static
// build expects (islands unmount and hydrate again, so each page's listeners and timers end with it,
// AC73), it keeps a live media element and an island's React state across swaps, it handles the
// browser's back and forward with scroll positions (AC69), and it announces the new title once
// (AC68). A hand-written router would have to redo all of that. What it does not do the way RIFQ
// needs is done here:
// - AC72, AC66: only RIFQ's own reader-facing pages (A1) are placed in the tab. Any other answer
//   (the gate's 401, a lock-out, a rate limit, 503 or any error, a non-HTML answer, a page without
//   the A1 marker, /api/ or /dev/, a redirect away) or a fetch that fails or takes longer than
//   NAV_TIMEOUT_MS loads the address in full instead, so the browser shows it normally; the
//   recitation then stops, as AC66 says.
// - AC71: no prefetching at all (prefetch is off in astro.config.mjs), and this file asks for one
//   page per navigation, from RIFQ's origin, never /api/ or /dev/. Nothing is stored.
// - AC70, R-9: night mode and text size are kept on the root element across the swap (the router
//   replaces the root's attributes with the new page's), so there is no flash of the other palette
//   or size; the new page's lang and dir come with it.
// - AC68: after a change, focus goes to the start of the main content, or to the ayah row for a
//   link to an ayah; AC69: such a row is shown fully below the header and above the players.
// - AC67 h: page changes have no animated transition (global.css turns the view transition off).
import { navigate } from 'astro:transitions/client';
import { revealRow } from './reveal.ts';

export const NAV_TIMEOUT_MS = 10000;
const FULL = /^\/(?:api|dev)(?:\/|$)/;

type PrepEvent = Event & { to: URL; navigationType: string; formData?: FormData; signal: AbortSignal; newDocument: Document; loader: () => Promise<void> };
type SwapEvent = Event & { swap: () => void };

let lastType = 'push';
let lastIndex = 0;

async function preloadStyles(doc: Document) {
  const waits: Promise<unknown>[] = [];
  for (const el of doc.querySelectorAll('head link[rel=stylesheet]')) {
    const href = el.getAttribute('href');
    if (!href || document.querySelector(`link[rel=stylesheet][href="${CSS.escape(href)}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'preload'; l.as = 'style'; l.href = href;
    waits.push(new Promise((r) => { l.addEventListener('load', r); l.addEventListener('error', r); }));
    document.head.append(l);
  }
  await Promise.all(waits);
}

function onPrep(ev: Event) {
  const e = ev as PrepEvent;
  // Forms (search without JavaScript) carry data-astro-reload and never come here; anything else
  // that is not a plain page link is loaded in full.
  if (e.formData || FULL.test(e.to.pathname) || e.to.origin !== location.origin) { e.preventDefault(); return; }
  lastType = e.navigationType;
  e.loader = async () => {
    const ctl = new AbortController();
    const abort = () => ctl.abort();
    e.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, NAV_TIMEOUT_MS);
    try {
      const res = await fetch(e.to.href, { signal: ctl.signal, credentials: 'same-origin', headers: { accept: 'text/html' } });
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (res.status !== 200 || type !== 'text/html') { e.preventDefault(); return; }
      if (res.redirected) {
        const r = new URL(res.url);
        if (r.origin !== location.origin || FULL.test(r.pathname)) { e.preventDefault(); return; }
        r.hash = e.to.hash;
        e.to = r;
      }
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      if (!doc.querySelector('meta[name="rifq-page"]') || !doc.querySelector('meta[name="astro-view-transitions-enabled"]')) { e.preventDefault(); return; }
      doc.querySelectorAll('noscript').forEach((n) => n.remove());
      await preloadStyles(doc);
      e.newDocument = doc;
    } catch {
      // A newer navigation took over (the router drops this one); otherwise offline, an error or the
      // time limit: load in full.
      if (!e.signal.aborted) e.preventDefault();
    } finally {
      clearTimeout(timer);
      e.signal.removeEventListener('abort', abort);
    }
  };
}

function onBeforeSwap(ev: Event) {
  const e = ev as SwapEvent;
  holdUnmounts();
  // An automatic (smooth) scroll still running on the old page must not carry on into the new one.
  window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' as ScrollBehavior });
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  const props = [...root.style].map((p) => [p, root.style.getPropertyValue(p)] as const);
  const swap = e.swap;
  e.swap = () => {
    swap();
    // Set through the CSS object model, which the policy allows (no style attribute is written).
    root.classList.toggle('dark', dark);
    for (const [p, v] of props) root.style.setProperty(p, v);
  };
}

// An island of the page being left may still be hydrating (React hydrates in a transition, after
// Astro has already marked the island done). Unmounting a root before its hydration has finished
// makes React report error #424 (seen in the tests on quick page changes). So the unmount the router
// asks for is held until that root has finished hydrating, then let through. The root is already
// out of the page, so nothing shows; its effects end with the unmount a moment later.
function stillHydrating(el: Element): boolean {
  const k = Object.keys(el).find((x) => x.startsWith('__reactContainer'));
  const fiber = k ? (el as unknown as Record<string, { memoizedState?: { isDehydrated?: boolean } } | undefined>)[k] : undefined;
  return !!fiber?.memoizedState?.isDehydrated;
}
function holdUnmounts() {
  for (const el of document.querySelectorAll('astro-island')) {
    if ((el as HTMLElement).dataset.rifqHold) continue;
    (el as HTMLElement).dataset.rifqHold = '1';
    el.addEventListener('astro:unmount', (e) => {
      if (!stillHydrating(el)) return;
      e.stopImmediatePropagation();
      const retry = () => { if (stillHydrating(el)) setTimeout(retry, 50); else el.dispatchEvent(new CustomEvent('astro:unmount')); };
      setTimeout(retry, 50);
    }, { capture: true });
  }
}

function onAfterSwap() {
  lastIndex = (history.state as { index?: number } | null)?.index ?? lastIndex;
  const m = /^#a(\d{1,4})$/.exec(location.hash);
  const row = m && lastType !== 'traverse' ? document.getElementById(`a${m[1]}`) : null;
  if (row && row.matches('li.ayah-row')) {
    revealRow(row);
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
    row.focus({ preventScroll: true });
    return;
  }
  document.getElementById('content')?.focus({ preventScroll: true });
}

const w = (typeof window === 'undefined' ? {} : window) as unknown as { __rifqNav?: boolean };
if (typeof document !== 'undefined' && !w.__rifqNav) {
  w.__rifqNav = true;
  document.addEventListener('astro:before-preparation', onPrep);
  document.addEventListener('astro:before-swap', onBeforeSwap);
  document.addEventListener('astro:after-swap', onAfterSwap);
}

// For islands that move to another page by script (the Tafseer page across a surah edge): in place
// when the router is on this page, otherwise an ordinary replace.
export function goReplace(url: string) {
  if (document.querySelector('meta[name="astro-view-transitions-enabled"]')) {
    // The router needs its own state on the entry it replaces; a script may have cleared it.
    if (!history.state) history.replaceState({ index: lastIndex, scrollX, scrollY }, '');
    void navigate(url, { history: 'replace' });
  }
  else location.replace(url);
}
