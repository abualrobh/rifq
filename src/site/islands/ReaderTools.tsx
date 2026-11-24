// Reader page tools (RQ-003): the last reading position, and the check for a saved or linked
// reference that does not exist. Since kit v38 the bookmark control is in the ayah actions panel
// (RQ-008 AC30, islands/AyahPanels.tsx), which also shows the bookmark marks (AC31).
import { useEffect, useRef, useState } from 'react';
import { getStorage, setLast } from '../../core/store.ts';
import { addRecent } from '../../core/recent.ts';
import { t, type Lang } from '../../core/strings.ts';
import { topRow } from '../client/place.ts';
import { revealRow } from '../client/reveal.ts';

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

    // A link to an ayah that is not in this surah shows a message and opens nothing else (AC10).
    // RQ-008 P-6 (kit v38): "#aN;tafseer" is the reader with the Tafseer panel open on ayah N.
    const checkHash = () => {
      const h = location.hash;
      if (!h) return;
      const m = /^#a(\d{1,5})(?:;tafseer)?$/.exec(h);
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

    // P-6: the panel's ayah is shown in the reader behind it before the reading place is taken
    // (the browser does not scroll to a hash that names no element).
    const tf = /^#a(\d{1,4});tafseer$/.exec(location.hash);
    const tfRow = tf ? document.getElementById(`a${tf[1]}`) : null;
    if (tfRow) revealRow(tfRow);

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
    let panelWas = false;
    const tick = () => {
      if (document.visibilityState !== 'visible') { since.clear(); return; }
      // RQ-006 AC50 (D-117 A): while a surah plays, the player saves the playing ayah instead, and
      // the 3-second rule starts again from zero once playback stops.
      if (document.documentElement.dataset.audioFollow === '1') { since.clear(); return; }
      // RQ-008 AC35, P-7 (kit v38): while the ayah actions panel or the Tafseer panel is open the
      // last position does not change; the rule starts again from zero when it closes.
      if (document.documentElement.dataset.panel === '1') { since.clear(); panelWas = true; return; }
      if (panelWas) { panelWas = false; reseed(); return; }
      const now = performance.now();
      let best = 0;
      for (const [el, t0] of since) {
        if (now - t0 < DWELL_MS) continue;
        const a = Number(el.dataset.a);
        if (!best || a < best) best = a;
      }
      // RQ-008 AC20 (D-182 A, kit v37): the surah joins recently read only when this rule records
      // an ayah in it (addRecent does nothing when it is already first).
      if (best && setLast(st, [s, best])) addRecent(st, s);
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
    // The ayat on screen now start their 3 seconds again (after the tab was hidden, or a panel closed).
    function reseed() {
      const now = performance.now();
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        const top = headerH();
        const vis = Math.min(b.bottom, innerHeight) - Math.max(b.top, top);
        if (vis > 0 && (vis >= 0.5 * b.height || vis >= 0.5 * (innerHeight - top))) since.set(r, now);
      }
    }
    const onVis = () => { if (document.visibilityState === 'visible') reseed(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
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
