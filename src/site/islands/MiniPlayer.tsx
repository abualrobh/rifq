// RQ-006 v1.3 mini-player (D-126 1A, AC63, AC67, D-128 B, D-130).
//
// In the layout of every page a reader can open (A1), after the main content and before the footer
// in the tab order (P-12), shown as a bar fixed at the bottom of the screen while a recitation is
// loaded in this tab (playing or paused), and while its ended or not-available state is shown
// (AC75). Before the first play, and after it is closed, nothing is shown and no space is kept.
// Its container is persisted across in-place page changes (transition:persist), so it never
// flickers or loses focus; the interface language follows the new page (AC74).
// It has no reciter control (A5) and shows no Quran text.
//
// Kit v42 (D-270 A, V41-H1): at large text the bar is one row: previous ayah, play/pause, next ayah
// and a "more" button (44 px targets, 8 px apart; mirrored in Arabic by the page direction). "More"
// opens a small bottom sheet (a modal dialog, like the ayah panels) with what playing, the short
// credit naming the reciter and Quran Foundation (D-268 A), go to the playing ayah, close (D-128),
// and the recitation source details shown behind the reader's reciter button. "Large text" is
// measured, not a fixed zoom level: see compactNow(). At other sizes the bar is as in kit v41.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { ayahPath, t, type Lang } from '../../core/strings.ts';
import { useRecitation } from '../client/use-recitation.ts';
import { closeModal, openModal, trap } from '../client/modal.ts';
import SourceDetails from './SourceDetails.tsx';
import { focusedKey } from '../client/mini-focus.ts';

// D-270 A: when the kit v41 bar does not fit its two rows. Its second row (global.css) needs the
// surah line's 14rem, go-to and close (2 x 2.75rem) and two .5rem gaps = 20.5rem, plus the bar's
// inline padding (2 x .75rem on a phone): 22rem of screen width, in the page's own rem, so browser
// text zoom (root font) and page zoom (fewer CSS pixels) both count. Below that the v41 bar takes
// three or more rows. The large-text class of kit v39 (html.rifq-tall-text: the screen is less than
// 40 lines of text tall, client/tabbar.ts) also gives the one-row bar on phone-width pages, where the
// v41 bar had its own large-text layout. Width and text size only: the bar's own height never
// changes the answer, so the two layouts cannot alternate.
export const FIT_REM = 22;
export function compactNow(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
  if (root.clientWidth < FIT_REM * rem) return true;
  return root.classList.contains('rifq-tall-text') && matchMedia('(max-width: 51.99rem)').matches;
}

const moreIcon = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="5" r="2.1" fill="currentColor" /><circle cx="12" cy="12" r="2.1" fill="currentColor" /><circle cx="12" cy="19" r="2.1" fill="currentColor" /></svg>;
const goIcon = <svg className="mini-go-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h10M4 12h10M4 18h7M17 9l4 3-4 3z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const closeIcon = (n: number) => <svg width={n} height={n} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;

// Mounted once per tab by src/site/client/mini-mount.ts into a persisted container (not hydrated as
// an island); the interface language comes from the engine, which reads it from each new page (AC74).
export default function MiniPlayer({ lang: first, dev = false }: { lang: Lang; dev?: boolean }) {
  const { snap, engine } = useRecitation(dev);
  const lang: Lang = engine ? snap.lang : first;
  const box = useRef<HTMLElement>(null);
  const remProbe = useRef<HTMLSpanElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const shown = snap.phase !== 'none' && snap.s > 0;
  // D-270 A: decided on the first render (from the page, not the bar), so the bar never shows in one
  // layout and then jumps to the other.
  const [compact, setCompact] = useState(compactNow);
  const [more, setMore] = useState(false);

  // Measured again when the screen width changes (ResizeObserver on the bar), when the text size
  // changes (the 1rem probe inside the bar) and when the large-text class changes (in-place page
  // changes and text zoom set it again, client/tabbar.ts).
  // Kit v43 (D-272 A, QA v42 FIND-CS): the two layouts are different trees, so a switch while one of
  // the bar's controls has keyboard or screen-reader focus would leave focus on the page body. The
  // focused control is remembered just before the switch (refocus) and the same control in the new
  // layout gets focus (below). The sheet's own controls are left to the sheet rule further down.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const check = () => {
      const next = compactNow();
      if (next !== compact) refocus.current = focusedKey(box.current);
      setCompact(next);
    };
    check();
    const ro = new ResizeObserver(check);
    if (box.current) ro.observe(box.current);
    if (remProbe.current) ro.observe(remProbe.current);
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', check);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', check); };
  }, [shown, compact]); // again after a switch: the probe is a new element in the other layout

  // After a switch (D-272 A): the same control in the new layout; go to and close are not in the
  // one-row bar, so they go to "more"; "more" is not in the two-row bar, so it goes to play/pause
  // (or go to, where an ended or not-available line has taken play/pause's place).
  useLayoutEffect(() => {
    const k = refocus.current;
    refocus.current = null;
    if (!k || !box.current) return;
    const order = compact ? [k, 'more'] : k === 'more' ? ['toggle', 'go'] : [k, 'toggle', 'go'];
    for (const key of order) {
      const el = [...box.current.querySelectorAll<HTMLElement>(`[data-mini-${key}]`)].find((e) => !e.closest('[data-mini-sheet]') && !(e as HTMLButtonElement).disabled);
      if (!el) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
  }, [compact]);

  // The sheet: focus moves to its heading when it opens (a modal dialog: Tab stays inside, the page
  // behind is inert). If the bar stops being one row while it is open (the phone is turned, the text
  // made smaller), it closes and focus goes to play/pause; if the recitation is closed (from the lock
  // screen), it goes with the bar and focus goes to the page, never to a removed control (AC67 d).
  useEffect(() => { if (more) { openModal(sheet.current, '[data-more-title]'); void engine?.loadReciters(lang).catch(() => undefined); } }, [more]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (more && (!compact || !shown)) {
      closeModal(sheet.current);
      setMore(false);
      const to = shown ? box.current?.querySelector<HTMLElement>('[data-mini-toggle], [data-mini-go]') : document.getElementById('content');
      to?.focus({ preventScroll: true });
    }
  }, [compact, shown, more]);

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
  const rec = list?.find((r) => r.id === snap.rid) ?? null;
  const reciter = rec?.name ?? '';
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
  // The sheet closed by its close button, Esc or a tap on the dimmed area: focus back on "more".
  const hideMore = () => { closeModal(sheet.current); setMore(false); moreBtn.current?.focus({ preventScroll: true }); };
  const goFromSheet = (e: MouseEvent<HTMLAnchorElement>) => { closeModal(sheet.current); setMore(false); go(e); };
  const close = () => {
    closeModal(sheet.current);
    setMore(false);
    engine?.close();
    // Focus is never left on a removed control (AC67 d, AC68).
    document.getElementById('content')?.focus({ preventScroll: true });
  };

  // QA FIND-M (kit v26): a screen reader hears each thing once. The region's name (miniRegion, D-134)
  // already says "now playing", so the visible label of the same meaning is hidden from it; the
  // ended or not-available line is read from the status below, so its visible copy is hidden too.
  const nowLine = <><bdi dir={lang === 'ar' ? 'rtl' : 'ltr'} data-mini-surah>{s}. {name}</bdi>{' · '}<span data-mini-ayah>{t(lang, 'audioNowAyah', { a })}</span></>;
  // The short credit: the reciter (once the list has loaded in this tab, D-269 A) and Quran Foundation.
  const credit = <>{reciter && <bdi lang={latin ? 'en' : 'ar'} dir={latin ? 'ltr' : 'rtl'} data-mini-reciter>{reciter}</bdi>}{reciter && ' · '}<bdi lang="en" dir="ltr" data-mini-credit>Quran Foundation</bdi></>;
  const stateLine = (where: string) => <p className="mini-sub mini-state" aria-hidden="true" data-mini-sub="state" data-where={where}><span data-mini-state={loading ? 'loading' : snap.phase}>{said}</span></p>;
  // D-207 B (kit v39, RQ-006 AC28): previous and next ayah are back, in the mini-player (the only
  // player, D-203 A), around play/pause. They act on the playing recitation only, exactly as the kit
  // v37 player's buttons and the lock-screen controls (engine.seekAyah): within the playing surah,
  // disabled at its first and last ayah. The existing prevAyah and nextAyah names. The same buttons
  // in both layouts.
  const steps = !ended && !failed && <>
    <button type="button" className="btn icon-btn mini-step" data-mini-prev aria-label={t(lang, 'prevAyah')} title={t(lang, 'prevAyah')}
      disabled={snap.mode === 'idle' || snap.current <= 1} onClick={() => engine?.seekAyah(engine.get().current - 1)}>
      <svg className="mini-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5v14M19 5l-9 7 9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </button>
    <button type="button" className="btn icon-btn mini-play" data-mini-toggle data-state={snap.playing ? 'playing' : 'paused'}
      aria-label={t(lang, snap.playing ? 'miniPause' : 'miniPlay', { s, a })} title={t(lang, snap.playing ? 'miniPause' : 'miniPlay', { s, a })}
      onClick={() => engine?.pauseOrResume()}>
      {snap.playing
        ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
        : <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>}
    </button>
    <button type="button" className="btn icon-btn mini-step" data-mini-next aria-label={t(lang, 'nextAyah')} title={t(lang, 'nextAyah')}
      disabled={snap.mode === 'idle' || snap.current < 1 || snap.current >= snap.count} onClick={() => engine?.seekAyah(engine.get().current + 1)}>
      <svg className="mini-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 5v14M5 5l9 7-9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </button>
  </>;
  // AC75, SC 4.1.3: the ended or not-available state is announced once, away from the playing surah's
  // page (there the Play surah row speaks, kit v38; no second announcement, P-9).
  const live = <p className="sr-only" role="status" aria-live={own ? 'off' : 'polite'} data-mini-status>{said}</p>;
  // The 1rem probe: its size changes with the text size, which the bar's own size may not.
  const probe = <span ref={remProbe} className="mini-rem" aria-hidden="true" />;

  if (compact) {
    // D-270 A: one row. While loading, the loading line shows under it (FIND-BW: the cue stays where
    // the reader is); an ended or not-available line takes the place of the three buttons.
    return (
      <section ref={box} className="mini" aria-label={t(lang, 'miniRegion')} data-mini-player data-compact="1" data-phase={snap.phase} data-playing={snap.playing ? '1' : '0'} data-loading={loading ? '1' : '0'} aria-busy={loading || undefined} data-s={s} data-a={a}>
        <div className="mini-row" data-mini-row>
          {steps}
          {(ended || failed) && said ? stateLine('row') : null}
          <button ref={moreBtn} type="button" className="btn icon-btn mini-more" data-mini-more aria-haspopup="dialog" aria-expanded={more} aria-controls="mini-sheet"
            aria-label={t(lang, 'miniMore')} title={t(lang, 'miniMore')} onClick={() => setMore(true)}>{moreIcon}</button>
        </div>
        {loading ? stateLine('below') : null}
        <dialog ref={sheet} id="mini-sheet" className="sheet mini-sheet" aria-modal="true" aria-labelledby="mini-sheet-h" data-mini-sheet
          onCancel={(e) => { e.preventDefault(); hideMore(); }}
          onClick={(e) => { if (e.target === e.currentTarget) hideMore(); }} onKeyDown={trap}>
          {more && <div className="sheet-in">
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-head">
              <div className="sheet-titles">
                <h2 className="sheet-title" id="mini-sheet-h" tabIndex={-1} data-more-title>{t(lang, 'miniMore')}</h2>
                <p className="sheet-sub" data-more-now>{nowLine}</p>
              </div>
              <button type="button" className="btn icon-btn sheet-close" data-more-close aria-label={t(lang, 'close')} title={t(lang, 'close')} onClick={hideMore}>{closeIcon(20)}</button>
            </div>
            {said && <p className="msg sheet-status" data-more-state>{said}</p>}
            {/* D-268 A: at large text the short credit, the same line as the bar's at other sizes. */}
            <p className="mini-sub more-credit" data-mini-sub="credit">{credit}</p>
            <div className="more-acts">
              <a className="more-act" href={href} data-mini-go onClick={goFromSheet}>{goIcon}<span>{t(lang, 'miniGo', { s, a })}</span></a>
              <button type="button" className="more-act" data-mini-close onClick={close}>{closeIcon(18)}<span>{t(lang, 'miniClose')}</span></button>
            </div>
            {rec && <div className="src-box" data-more-source><SourceDetails lang={lang} reciter={rec} idBase="mini" /></div>}
          </div>}
        </dialog>
        {live}
        {probe}
      </section>
    );
  }

  return (
    <section ref={box} className="mini" aria-label={t(lang, 'miniRegion')} data-mini-player data-phase={snap.phase} data-playing={snap.playing ? '1' : '0'} data-loading={loading ? '1' : '0'} aria-busy={loading || undefined} data-s={s} data-a={a}>
      {steps}
      <div className="mini-info" data-mini-info>
        <p className="mini-now"><span className="mini-label" aria-hidden="true" data-mini-label>{t(lang, 'miniNowPlaying')}</span>{' '}{nowLine}</p>
        {/* QA v27 (Informational): when the line shows a state, the whole paragraph is hidden from
            screen readers (the status below reads it), so no empty paragraph is exposed. */}
        <p className="mini-sub" aria-hidden={said ? 'true' : undefined} data-mini-sub={said ? 'state' : 'credit'}>
          {said
            ? <span data-mini-state={loading ? 'loading' : snap.phase}>{said}</span>
            : credit}
        </p>
      </div>
      <a className="btn icon-btn mini-go" href={href} data-mini-go aria-label={t(lang, 'miniGo', { s, a })} title={t(lang, 'miniGo', { s, a })} onClick={go}>
        {goIcon}
      </a>
      <button type="button" className="btn icon-btn mini-close" data-mini-close aria-label={t(lang, 'miniClose')} title={t(lang, 'miniClose')} onClick={close}>
        {closeIcon(18)}
      </button>
      {live}
      {probe}
    </section>
  );
}
