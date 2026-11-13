// RQ-006 v1.3 mini-player (D-126 1A, AC63, AC67, D-128 B, D-130).
//
// In the layout of every page a reader can open (A1), after the main content and before the footer
// in the tab order (P-12), shown as a bar fixed at the bottom of the screen while a recitation is
// loaded in this tab (playing or paused), and while its ended or not-available state is shown
// (AC75). Before the first play, and after it is closed, nothing is shown and no space is kept.
// The island is persisted across in-place page changes (transition:persist), so it never flickers
// or loses focus; the interface language follows the new page (AC74).
// It has no reciter control (A5) and shows no Quran text.
import { useEffect, useRef, type MouseEvent } from 'react';
import { ayahPath, t, type Lang } from '../../core/strings.ts';
import { useRecitation } from '../client/use-recitation.ts';

// The island keeps its first props across page changes (transition:persist-props in the layout), so
// the router never re-renders it while it may still be hydrating; the interface language comes from
// the engine, which reads it from each new page (AC74).
export default function MiniPlayer({ lang: first, dev = false }: { lang: Lang; dev?: boolean }) {
  const { snap, engine } = useRecitation(dev);
  const lang: Lang = engine ? snap.lang : first;
  const box = useRef<HTMLElement>(null);
  const shown = snap.phase !== 'none' && snap.s > 0;

  // The page keeps room for the bar while it is shown (AC49, AC67 g): --mini-h is its height.
  useEffect(() => {
    const root = document.documentElement;
    const el = box.current;
    if (!shown || !el) { root.style.removeProperty('--mini-h'); return; }
    const setH = () => root.style.setProperty('--mini-h', Math.ceil(el.getBoundingClientRect().height) + 'px');
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);

  if (!shown) return null;
  const s = snap.s, a = snap.last || 1;
  const name = snap.names[lang];
  const list = snap.lists[lang] ?? snap.lists.ar ?? snap.lists.en;
  const reciter = list?.find((r) => r.id === snap.rid)?.name ?? '';
  const latin = /[A-Za-z]/.test(reciter);
  const ended = snap.phase === 'ended', failed = snap.phase === 'failed';
  const own = snap.page === s;
  const status = ended ? t(lang, 'miniEnded') : failed ? t(lang, 'audioUnavailable') : '';
  const href = ayahPath(lang, s, a);

  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!engine) return;
    engine.goPlaying(); // AC64: automatic scrolling back on
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab: an ordinary link
    const to = new URL(href, location.href);
    if (to.pathname !== location.pathname) return; // the router opens the page in place (nav.ts)
    // Already on the playing surah's page in this language: show and focus the ayah here.
    e.preventDefault();
    history.replaceState(history.state, '', to.hash);
    engine.reveal();
    const row = document.getElementById(`a${a}`);
    if (row) { if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1'); row.focus({ preventScroll: true }); }
  };
  const close = () => {
    engine?.close();
    // Focus is never left on a removed control (AC67 d, AC68).
    document.getElementById('content')?.focus({ preventScroll: true });
  };

  return (
    <section ref={box} className="mini" aria-label={t(lang, 'miniRegion')} data-mini-player data-phase={snap.phase} data-playing={snap.playing ? '1' : '0'} data-s={s} data-a={a}>
      {!ended && !failed
        ? <button type="button" className="btn icon-btn mini-play" data-mini-toggle data-state={snap.playing ? 'playing' : 'paused'}
            aria-label={t(lang, snap.playing ? 'miniPause' : 'miniPlay', { s, a })} title={t(lang, snap.playing ? 'miniPause' : 'miniPlay', { s, a })}
            onClick={() => engine?.pauseOrResume()}>
            {snap.playing
              ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>}
          </button>
        : null}
      <div className="mini-info" data-mini-info>
        <p className="mini-now"><span className="mini-label">{t(lang, 'miniNowPlaying')}</span>{' '}<bdi dir={lang === 'ar' ? 'rtl' : 'ltr'} data-mini-surah>{s}. {name}</bdi>{' · '}<span data-mini-ayah>{t(lang, 'audioNowAyah', { a })}</span></p>
        <p className="mini-sub">
          {status
            ? <span data-mini-state>{status}</span>
            : <>{reciter && <bdi lang={latin ? 'en' : 'ar'} dir={latin ? 'ltr' : 'rtl'} data-mini-reciter>{reciter}</bdi>}{reciter && ' · '}<bdi lang="en" dir="ltr" data-mini-credit>Quran Foundation</bdi></>}
        </p>
      </div>
      <a className="btn icon-btn mini-go" href={href} data-mini-go aria-label={t(lang, 'miniGo', { s, a })} title={t(lang, 'miniGo', { s, a })} onClick={go}>
        <svg className="mini-go-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h10M4 12h10M4 18h7M17 9l4 3-4 3z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </a>
      <button type="button" className="btn icon-btn mini-close" data-mini-close aria-label={t(lang, 'miniClose')} title={t(lang, 'miniClose')} onClick={close}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      {/* AC75, SC 4.1.3: the ended or not-available state is announced once, away from the playing
          surah's page (there the full player speaks; no second announcement, P-9). */}
      <p className="sr-only" role="status" aria-live={own ? 'off' : 'polite'} data-mini-status>{status}</p>
    </section>
  );
}
