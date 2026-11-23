// RQ-006 v1.3 mini-player (D-126 1A, AC63, AC67, D-128 B, D-130).
//
// In the layout of every page a reader can open (A1), after the main content and before the footer
// in the tab order (P-12), shown as a bar fixed at the bottom of the screen while a recitation is
// loaded in this tab (playing or paused), and while its ended or not-available state is shown
// (AC75). Before the first play, and after it is closed, nothing is shown and no space is kept.
// Its container is persisted across in-place page changes (transition:persist), so it never
// flickers or loses focus; the interface language follows the new page (AC74).
// It has no reciter control (A5) and shows no Quran text.
import { useEffect, useRef, type MouseEvent } from 'react';
import { ayahPath, t, type Lang } from '../../core/strings.ts';
import { useRecitation } from '../client/use-recitation.ts';

// Mounted once per tab by src/site/client/mini-mount.ts into a persisted container (not hydrated as
// an island); the interface language comes from the engine, which reads it from each new page (AC74).
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
  // Kit v39 (QA v38 FIND-BW, RQ-006 AC20): while the recitation is loading, the mini-player says so
  // with the existing audioLoading message, where the reader is (playing from an ayah far down left
  // the only loading line at the top of the surah, off screen). On the playing surah's page the Play
  // surah row's status already announces it, so here it is announced only on other pages.
  const loading = !status && snap.loading;
  const said = status || (loading ? t(lang, 'audioLoading') : '');
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

  // QA FIND-M (kit v26): a screen reader hears each thing once. The region's name (miniRegion, D-134)
  // already says "now playing", so the visible label of the same meaning is hidden from it; the
  // ended or not-available line is read from the status below, so its visible copy is hidden too.
  return (
    <section ref={box} className="mini" aria-label={t(lang, 'miniRegion')} data-mini-player data-phase={snap.phase} data-playing={snap.playing ? '1' : '0'} data-loading={loading ? '1' : '0'} aria-busy={loading || undefined} data-s={s} data-a={a}>
      {/* D-207 B (kit v39, RQ-006 AC28): previous and next ayah are back, in the mini-player (the only
          player, D-203 A), around play/pause. They act on the playing recitation only, exactly as the
          kit v37 player's buttons and the lock-screen controls (engine.seekAyah): within the playing
          surah, disabled at its first and last ayah. The existing prevAyah and nextAyah names. */}
      {!ended && !failed && <button type="button" className="btn icon-btn mini-step" data-mini-prev aria-label={t(lang, 'prevAyah')} title={t(lang, 'prevAyah')}
        disabled={snap.mode === 'idle' || snap.current <= 1} onClick={() => engine?.seekAyah(engine.get().current - 1)}>
        <svg className="mini-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5v14M19 5l-9 7 9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </button>}
      {!ended && !failed
        ? <button type="button" className="btn icon-btn mini-play" data-mini-toggle data-state={snap.playing ? 'playing' : 'paused'}
            aria-label={t(lang, snap.playing ? 'miniPause' : 'miniPlay', { s, a })} title={t(lang, snap.playing ? 'miniPause' : 'miniPlay', { s, a })}
            onClick={() => engine?.pauseOrResume()}>
            {snap.playing
              ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>}
          </button>
        : null}
      {!ended && !failed && <button type="button" className="btn icon-btn mini-step" data-mini-next aria-label={t(lang, 'nextAyah')} title={t(lang, 'nextAyah')}
        disabled={snap.mode === 'idle' || snap.current < 1 || snap.current >= snap.count} onClick={() => engine?.seekAyah(engine.get().current + 1)}>
        <svg className="mini-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 5v14M5 5l9 7-9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </button>}
      <div className="mini-info" data-mini-info>
        <p className="mini-now"><span className="mini-label" aria-hidden="true" data-mini-label>{t(lang, 'miniNowPlaying')}</span>{' '}<bdi dir={lang === 'ar' ? 'rtl' : 'ltr'} data-mini-surah>{s}. {name}</bdi>{' · '}<span data-mini-ayah>{t(lang, 'audioNowAyah', { a })}</span></p>
        {/* QA v27 (Informational): when the line shows a state, the whole paragraph is hidden from
            screen readers (the status below reads it), so no empty paragraph is exposed. */}
        <p className="mini-sub" aria-hidden={said ? 'true' : undefined} data-mini-sub={said ? 'state' : 'credit'}>
          {said
            ? <span data-mini-state={loading ? 'loading' : snap.phase}>{said}</span>
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
          surah's page (there the Play surah row speaks, kit v38; no second announcement, P-9). */}
      <p className="sr-only" role="status" aria-live={own ? 'off' : 'polite'} data-mini-status>{said}</p>
    </section>
  );
}
