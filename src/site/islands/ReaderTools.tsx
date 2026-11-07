// Reader page tools (RQ-003): the per-ayah bookmark buttons, the last reading position, and the
// check for a saved or linked reference that does not exist. The buttons are in the static HTML,
// invisible (space reserved) until this island loads, so reading never waits for it.
import { useEffect, useRef, useState } from 'react';
import { addBookmark, getStorage, isBookmarked, load, removeBookmark, setLast } from '../../core/store.ts';
import { t, type Lang } from '../../core/strings.ts';
import { topRow } from './Settings.tsx';

// Last position (RQ-003 AC4). U-24 is open; this build uses: among the ayat that have stayed
// visible for 3 seconds without a break, the one nearest the top. "Visible" means at least half of
// the ayah, or at least half of the screen for a long ayah.
export const DWELL_MS = 3000;

export default function ReaderTools({ lang, s, count }: { lang: Lang; s: number; count: number }) {
  const [msg, setMsg] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const say = (text: string) => {
      const n = ++seq.current;
      setMsg('');
      requestAnimationFrame(() => { if (n === seq.current) setMsg(text); });
    };
    const st = getStorage(window);
    const list = document.querySelector('ol.ayat');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button.bm')];
    const sync = () => {
      const { saves } = load(st);
      for (const b of buttons) {
        const a = Number(b.dataset.a);
        const on = isBookmarked(saves, [s, a]);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', t(lang, on ? 'bookmarkOn' : 'bookmarkOff', { a }));
      }
    };
    sync();
    // The buttons keep their space while pending, so showing them moves no text (no layout shift).
    for (const b of buttons) { b.removeAttribute('data-pending'); b.removeAttribute('tabindex'); }

    const onClick = (e: Event) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button.bm');
      if (!b) return;
      const a = Number(b.dataset.a);
      if (b.getAttribute('aria-pressed') === 'true') {
        say(removeBookmark(st, [s, a]) === 'failed' ? t(lang, 'saveFailed') : t(lang, 'removed'));
      } else {
        const r = addBookmark(st, [s, a]);
        say(r === 'saved' || r === 'exists' ? t(lang, 'saved') : r === 'limit' ? t(lang, 'limit') : t(lang, 'saveFailed'));
      }
      sync();
    };
    list?.addEventListener('click', onClick);
    window.addEventListener('storage', sync);

    // A link to an ayah that is not in this surah shows a message and opens nothing else (AC10).
    const checkHash = () => {
      const h = location.hash;
      if (!h) return;
      const m = /^#a(\d{1,5})$/.exec(h);
      const a = m ? Number(m[1]) : 0;
      if (!m || a < 1 || a > count) {
        say(t(lang, 'badRef', { s, a: m ? a : '?' }));
        window.scrollTo({ top: 0 });
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);

    // Keep the language switch on the same ayah.
    const sw = document.getElementById('lang-switch') as HTMLAnchorElement | null;
    const rows = [...document.querySelectorAll<HTMLElement>('li.ayah-row')];
    const headerH = () => document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
    const onSwitch = () => {
      const top = topRow()?.el;
      if (sw && top) sw.hash = top.id;
    };
    sw?.addEventListener('click', onSwitch);

    // Design review M-2: when the Quran font arrives, the text reflows. Until the reader moves the
    // page, keep the ayah that was at the top (or the linked ayah) in place, and start counting the
    // 3-second dwell (D-062) only once the font is ready, so the reflow cannot pick the wrong ayah.
    const anchor = topRow();
    let moved = false;
    const onMove = () => { moved = true; };
    const moveEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const ev of moveEvents) window.addEventListener(ev, onMove, { passive: true, once: true });
    let stopped = false;
    const fontsReady = Promise.race([
      (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    const since = new Map<HTMLElement, number>();
    // An ayah counts as visible when at least half of it is on screen, or when it fills at least
    // half of the screen (a long ayah). A sliver at the edge does not count.
    const seen = (e: IntersectionObserverEntry) => e.isIntersecting &&
      (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= 0.5 * (e.rootBounds?.height ?? innerHeight));
    const io = new IntersectionObserver((entries) => {
      const now = performance.now();
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (seen(e)) { if (!since.has(el)) since.set(el, now); } else since.delete(el);
      }
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], rootMargin: `-${Math.ceil(headerH())}px 0px 0px 0px` });
    let iv = 0;
    const tick = () => {
      if (document.visibilityState !== 'visible') { since.clear(); return; }
      const now = performance.now();
      let best = 0;
      for (const [el, t0] of since) {
        if (now - t0 < DWELL_MS) continue;
        const a = Number(el.dataset.a);
        if (!best || a < best) best = a;
      }
      if (best) setLast(st, [s, best]);
    };
    void fontsReady.then(() => {
      if (stopped) return;
      if (!moved && anchor) {
        const d = anchor.el.getBoundingClientRect().top - anchor.top;
        if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: 'instant' as ScrollBehavior });
      }
      rows.forEach((r) => io.observe(r));
      iv = window.setInterval(tick, 500);
    });
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        const now = performance.now();
        for (const r of rows) {
          const b = r.getBoundingClientRect();
          const top = headerH();
          const vis = Math.min(b.bottom, innerHeight) - Math.max(b.top, top);
          if (vis > 0 && (vis >= 0.5 * b.height || vis >= 0.5 * (innerHeight - top))) since.set(r, now);
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      list?.removeEventListener('click', onClick);
      window.removeEventListener('storage', sync);
      window.removeEventListener('hashchange', checkHash);
      sw?.removeEventListener('click', onSwitch);
      document.removeEventListener('visibilitychange', onVis);
      stopped = true;
      for (const ev of moveEvents) window.removeEventListener(ev, onMove);
      io.disconnect();
      clearInterval(iv);
    };
  }, [lang, s, count]);

  return <p className="toast" role="status" aria-live="polite" data-reader-status>{msg}</p>;
}
