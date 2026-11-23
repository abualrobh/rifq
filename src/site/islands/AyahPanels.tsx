// RQ-008 stage 2 (kit v38): the ayah actions panel (AC26 to AC37, D-187 A, D-189 A, D-192 A) and the
// Tafseer panel over the reader (AC38 to AC49), on reader pages.
//
// Ayah actions panel. Each ayah has one actions button (static HTML in Reader.astro, shown once this
// island loads), named "Options for ayah {a}" (AC26). Tapping or clicking the ayah opens the same
// panel, unless the reader is selecting text, pressing long or dragging (AC26, R-3). The panel is a
// modal dialog (native <dialog>, showModal: the page behind is inert), named "Options for ayah {a}",
// with the surah name and ayah as its heading, a line with S:A and the juz (no page number, D-192 A),
// and these actions in this order: Play from here (audio builds), Tafseer (Tafseer builds), Play this
// ayah (audio builds), Bookmark, Copy reference (AC27). Focus moves in and stays in (AC33); Esc,
// Close or a tap on the dimmed area closes it and focus returns to the ayah's actions button (AC34);
// the grab handle is decoration only. Opening or closing it never scrolls the reader, and the last
// reading position does not change while a panel is open (AC35: the D-062 rule in ReaderTools waits
// while html[data-panel] is set, and starts again from zero when it closes).
//
// Tafseer panel. The same TafseerView island as the Tafseer page (A2, AC39), given a host: the panel
// shows the ayah's Quran text in its own Quran section, copied from the reader's own element for that
// ayah (the D-011 text as delivered, byte for byte, AC40; no Quran text is in this script), then the
// Tafseer section. Previous and next move the reader behind it (AC43); at a surah edge the next or
// previous surah's reader page opens in place with the panel on its first or last ayah (AC44, P-8).
// Its play button plays that ayah alone and becomes pause while it plays (AC45, P-9). It has the
// language link of D-181 C (AC75): the same ayah's Tafseer in the other interface language.
// P-6 (proposal, relied on): the reader address /S/#aN;tafseer (/en/S/#aN;tafseer) opens the reader
// at ayah N with the panel open (AC48). The hash is never sent to the server. Opening the panel adds
// one history entry, so Back closes it; moving in the panel replaces that entry. Closing it returns
// focus to the actions button of the ayah last shown, which is in view (AC46, P-7).
//
// Nothing here is sent anywhere except the Tafseer request TafseerView makes to RIFQ's own
// /api/tafseer (AC42). Bookmarks stay on the device (RQ-003). The clipboard is written only after a
// tap, with S:A only, and never read (AC32).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react';
import { navigate } from 'astro:transitions/client';
import { addBookmark, getStorage, isBookmarked, load, removeBookmark } from '../../core/store.ts';
import { juzOfAyah } from '../../core/recent.ts';
import { surahPath, t, type Key, type Lang } from '../../core/strings.ts';
import { goReplace } from '../client/nav.ts';
import { revealRow } from '../client/reveal.ts';
import { useRecitation } from '../client/use-recitation.ts';
import type { Engine, Names } from '../client/recitation.ts';
import { fill, refNode } from '../client/fill.ts';
import TafseerView, { type TafseerHost } from './TafseerView.tsx';
import BidiText from './BidiText.tsx';

type Props = {
  lang: Lang; s: number; count: number; names: Names; prevCount: number; last: number;
  juz: { juz: number; s: number; a: number }[]; juzOk: boolean; tafseer: boolean; audio: boolean; dev?: boolean;
};

// P-6: the reader hash that opens the Tafseer panel on ayah N.
export const TF_HASH = /^#a(\d{1,4});tafseer$/;
type Msg = { key: Key; ref?: boolean } | null;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const playIcon = <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>;
const pauseIcon = <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>;
const closeIcon = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;

// Opening a modal dialog must not move the reader (AC35): the scroll position is put back if the
// browser moved it, and focus goes to the heading inside the dialog (AC33).
function openModal(d: HTMLDialogElement | null, focusSel: string) {
  if (!d || d.open) return;
  const x = scrollX, y = scrollY;
  try { d.showModal(); } catch { d.setAttribute('open', ''); }
  d.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
  if (scrollX !== x || scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
}
function closeModal(d: HTMLDialogElement | null) {
  if (!d?.open) return;
  const x = scrollX, y = scrollY;
  d.close();
  if (scrollX !== x || scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
}
// Tab and Shift+Tab stay inside the dialog (AC33), on every browser.
function trap(e: RKeyboardEvent<HTMLDialogElement>) {
  if (e.key !== 'Tab') return;
  const box = e.currentTarget;
  const f = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
  if (!f.length) return;
  const cur = document.activeElement as HTMLElement | null;
  const i = cur ? f.indexOf(cur) : -1;
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && (i === f.length - 1 || i === -1 && !box.contains(cur))) { e.preventDefault(); f[0].focus(); }
}

// The offline message is set at once when a play is chosen without a connection (RQ-006 AC22). The
// panel then stays open and says it, so the message is not left only at the top of the surah.
const offline = (engine: Engine) => engine.get().msg?.key === 'audioOffline' && engine.get().mode === 'idle';

export default function AyahPanels({ lang, s, count, names, prevCount, last, juz, juzOk, tafseer, audio, dev = false }: Props) {
  const { snap, engine } = useRecitation(dev);
  const [act, setAct] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);
  const [bmTick, setBmTick] = useState(0);
  const [tfA, setTfA] = useState(0);
  const [tfStart, setTfStart] = useState(0);
  const [tfKey, setTfKey] = useState(0);
  const [tfText, setTfText] = useState('');
  const [tfMsg, setTfMsg] = useState('');
  const actDlg = useRef<HTMLDialogElement>(null);
  const tfDlg = useRef<HTMLDialogElement>(null);
  const actA = useRef(0);
  const tfOpen = useRef(false);
  const tfLast = useRef(0);
  const seq = useRef(0);
  const st = useRef(typeof window === 'undefined' ? null : getStorage(window));
  const info = { count, names };
  const name = names[lang];
  const nameLang = lang === 'ar' ? 'ar' : 'en';
  const other: Lang = lang === 'ar' ? 'en' : 'ar';

  // The reader's own element for the ayah: its text is the D-011 text as delivered (AC40).
  const textOf = (n: number) => document.querySelector(`ol.ayat p.ayah[data-r="${s}:${n}"]`)?.textContent ?? '';
  const rowOf = (n: number) => document.getElementById(`a${n}`);
  const reveal = (n: number) => { const r = rowOf(n); if (r) revealRow(r); };
  const focusAct = (n: number) => rowOf(n)?.querySelector<HTMLElement>('button.ayah-act')?.focus({ preventScroll: true });
  const say = (m: Msg) => {
    const k = ++seq.current;
    setMsg(null);
    requestAnimationFrame(() => { if (k === seq.current) setMsg(m); });
  };

  // AC31 (P-11): a bookmarked ayah shows a bookmark mark after its text, with "Bookmarked" for screen
  // readers. Added to the page here (outside the Quran text element), so the static HTML has none.
  function syncMarks() {
    const { saves } = load(st.current);
    for (const row of document.querySelectorAll<HTMLElement>('ol.ayat li.ayah-row')) {
      const a = Number(row.dataset.a);
      const on = isBookmarked(saves, [s, a]);
      row.classList.toggle('is-bm', on);
      let mk = row.querySelector<HTMLElement>('[data-bm-mark]');
      if (on && !mk) {
        mk = document.createElement('span');
        mk.className = 'bm-mark';
        mk.setAttribute('data-bm-mark', '');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', 'M6 3h12v18l-6-4-6 4z'); p.setAttribute('fill', 'currentColor');
        svg.append(p);
        const txt = document.createElement('span');
        txt.className = 'sr-only';
        txt.textContent = t(lang, 'bookmarkedMark');
        mk.append(svg, txt);
        row.querySelector('.ayah-tools')?.append(mk);
      } else if (!on && mk) mk.remove();
    }
    setBmTick((x) => x + 1);
  }

  // ----- the actions panel -----
  function openAct(a: number) {
    if (a < 1 || a > count) return;
    actA.current = a;
    setMsg(null);
    setAct(a);
  }
  function closeAct(focus = true) {
    const a = actA.current;
    closeModal(actDlg.current);
    actA.current = 0;
    setAct(0);
    setMsg(null);
    if (focus && a) focusAct(a);
  }
  useEffect(() => { if (act) openModal(actDlg.current, '[data-act-title]'); }, [act]);

  function playFrom(a: number) {
    if (!engine) return;
    engine.start('surah', s, a, info);
    if (offline(engine)) { say({ key: 'audioOffline' }); return; }
    closeAct();
  }
  // As the per-ayah play button of kit v37 (audioPlayAyah, TOG-1, QA v25 FIND-E): the ayah being
  // played pauses; any other ayah starts alone.
  function playAyah(a: number, close: () => void, onOffline: () => void) {
    if (!engine) return;
    const now = engine.get();
    if (now.s === s && now.mode !== 'idle' && now.current === a && !engine.el.paused) { engine.el.pause(); close(); return; }
    engine.start('ayah', s, a, info);
    if (offline(engine)) { onOffline(); return; }
    close();
  }
  function toggleBookmark(a: number) {
    const x = st.current;
    if (isBookmarked(load(x).saves, [s, a])) say({ key: removeBookmark(x, [s, a]) === 'failed' ? 'saveFailed' : 'removed' });
    else {
      const r = addBookmark(x, [s, a]);
      say({ key: r === 'saved' || r === 'exists' ? 'saved' : r === 'limit' ? 'limit' : 'saveFailed' });
    }
    syncMarks();
  }
  function copy(a: number) {
    const ref = `${s}:${a}`;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip?.writeText) { say({ key: 'copyFailed', ref: true }); return; }
    clip.writeText(ref).then(() => say({ key: 'copied', ref: true }), () => say({ key: 'copyFailed', ref: true }));
  }

  // ----- the Tafseer panel -----
  const viaRouter = () => !!document.querySelector('meta[name="astro-view-transitions-enabled"]') && !!history.state;
  function openTf(a: number, push: boolean) {
    if (!tafseer || a < 1 || a > count) return;
    tfOpen.current = true;
    tfLast.current = a;
    setTfStart(a); setTfA(a); setTfText(textOf(a)); setTfMsg('');
    setTfKey((k) => k + 1);
    reveal(a);
    if (!push) return;
    // P-6: one history entry, marked with the page it was opened on, so Close can go Back to it.
    const url = `${location.pathname}#a${a};tafseer`;
    const base = location.pathname;
    try {
      if (viaRouter()) {
        // Through Astro's router, so its own Back and Forward handling knows the entry (it stays on
        // this page and only restores the scroll position); then the entry gets today's scroll.
        void navigate(url);
        history.replaceState({ ...history.state, rifqTfBase: base, scrollX, scrollY }, '');
      } else history.pushState({ ...(history.state ?? {}), rifqTfBase: base }, '', url);
    } catch { /* the panel still works without the history entry */ }
  }
  // Back (or Close, which goes Back to the entry before the panel) ends here (AC46, P-7).
  function finishTf() {
    const a = tfLast.current;
    tfOpen.current = false;
    closeModal(tfDlg.current);
    setTfA(0);
    setTfMsg('');
    if (a) { reveal(a); focusAct(a); }
  }
  function closeTf() {
    const state = history.state as { rifqTfBase?: string } | null;
    if (state?.rifqTfBase === location.pathname && TF_HASH.test(location.hash)) { history.back(); return; }
    // Opened from a link, or moved here across a surah edge: the entry stays, without the panel.
    try {
      const { rifqTfBase: _drop, ...keep } = (state ?? {}) as Record<string, unknown>;
      history.replaceState(state ? keep : null, '', `#a${tfLast.current}`);
    } catch { /* nothing else to undo */ }
    finishTf();
  }
  useEffect(() => { if (tfA && tfOpen.current) openModal(tfDlg.current, '[data-tfp-title]'); }, [tfA]);

  // The host given to TafseerView (one per opening).
  const host = useMemo<TafseerHost>(() => ({
    start: tfStart,
    show: (n, focus) => {
      tfLast.current = n;
      setTfA(n);
      setTfText(textOf(n));
      setTfMsg('');
      try { if (TF_HASH.test(location.hash)) history.replaceState(history.state, '', `#a${n};tafseer`); } catch { /* still works */ }
      reveal(n);
      if (focus) requestAnimationFrame(() => tfDlg.current?.querySelector<HTMLElement>('[data-tf-ref]')?.focus());
    },
    edge: (dir) => {
      const to = dir < 0 ? `${surahPath(lang, s - 1)}#a${prevCount};tafseer` : `${surahPath(lang, s + 1)}#a1;tafseer`;
      goReplace(to);
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tfKey]);

  // ----- wiring on the reader page -----
  useEffect(() => {
    const list = document.querySelector<HTMLElement>('ol.ayat');
    // The actions buttons keep their space while pending, so showing them moves no text.
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ayah-act')) { b.removeAttribute('data-pending'); b.removeAttribute('tabindex'); }
    syncMarks();
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element;
      const btn = el.closest<HTMLButtonElement>('button.ayah-act');
      if (btn) { openAct(Number(btn.dataset.act)); return; }
      const row = el.closest<HTMLElement>('li.ayah-row');
      if (!row || el.closest('a, button, input, summary, [data-bm-mark]')) return;
      // AC26: a long press, a drag or a text selection does not open the panel.
      const sel = getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      if (down && e.detail > 0 && (performance.now() - down.t > 600 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10)) return;
      openAct(Number(row.dataset.a));
    };
    list?.addEventListener('pointerdown', onDown, { passive: true });
    list?.addEventListener('click', onClick);
    const onStorage = () => syncMarks();
    window.addEventListener('storage', onStorage);
    const onPop = () => {
      const m = TF_HASH.exec(location.hash);
      // A link to another ayah's panel on this page (a hash change) shows that ayah.
      if (m) { const k = Number(m[1]); if (!tfOpen.current || k !== tfLast.current) openTf(k, false); return; }
      if (tfOpen.current) finishTf();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    // AC48: a link of the P-6 form opens the reader with the panel on that ayah.
    const m = TF_HASH.exec(location.hash);
    if (m) openTf(Number(m[1]), false);
    return () => {
      list?.removeEventListener('pointerdown', onDown);
      list?.removeEventListener('click', onClick);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
      delete document.documentElement.dataset.panel;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, count, lang]);

  // AC35, P-7: the D-062 rule waits while a panel is open.
  useEffect(() => {
    const root = document.documentElement;
    if (act || tfA) root.dataset.panel = '1'; else delete root.dataset.panel;
  }, [act, tfA]);

  const playingAyah = (a: number) => snap.s === s && snap.mode !== 'idle' && snap.current === a && snap.playing;
  const msgNode = (m: Msg, a: number): ReactNode => (m ? (m.ref ? fill(lang, m.key, { ref: refNode(s, a) }) : t(lang, m.key)) : null);

  // ----- the actions panel's content -----
  let actBody: ReactNode = null;
  if (act) {
    const a = act;
    void bmTick;
    const on = isBookmarked(load(st.current).saves, [s, a]);
    const j = juzOk ? juzOfAyah(juz, s, a) : 0;
    const pa = playingAyah(a);
    actBody = (
      <div className="sheet-in" data-a={a}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-titles">
            <h2 className="sheet-title" tabIndex={-1} data-act-title>{fill(lang, 'ayahActionsTitle', { name: <bdi lang={nameLang}>{name}</bdi>, a: <bdi dir="ltr">{a}</bdi> })}</h2>
            <p className="sheet-sub" data-act-sub>{j ? fill(lang, 'ayahActionsSub', { ref: refNode(s, a, { 'data-act-ref': '' }), j: <bdi dir="ltr">{j}</bdi> }) : refNode(s, a, { 'data-act-ref': '' })}</p>
          </div>
          <button type="button" className="btn icon-btn sheet-close" data-act-close aria-label={t(lang, 'close')} title={t(lang, 'close')} onClick={() => closeAct()}>{closeIcon}</button>
        </div>
        <div className="act-grid" data-act-list>
          {audio && <button type="button" className="act-btn act-primary" data-act-play-from disabled={!engine} onClick={() => playFrom(a)}>
            <svg width="22" height="22" viewBox="0 0 26 24" aria-hidden="true" focusable="false"><path d="M4 4.5v15l10-7.5z" fill="currentColor" /><path d="M17 6h6M17 12h6M17 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span>{t(lang, 'playFromHere')}</span></button>}
          {tafseer && <button type="button" className="act-btn act-soft" data-act-tafseer onClick={() => { closeAct(false); openTf(a, true); }}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 5h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
            <span>{t(lang, 'tafseerTitle')}</span></button>}
          {audio && <button type="button" className="act-btn" data-act-play-ayah data-state={pa ? 'playing' : 'idle'} disabled={!engine} onClick={() => playAyah(a, () => closeAct(), () => say({ key: 'audioOffline' }))}>
            {pa ? pauseIcon : playIcon}
            <span>{t(lang, pa ? 'audioPauseAyah' : 'audioPlayAyah', { a })}</span></button>}
          <button type="button" className="act-btn" data-act-bookmark aria-pressed={on} onClick={() => toggleBookmark(a)}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3h12v18l-6-4-6 4z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
            <span>{t(lang, on ? 'removeBookmarkShort' : 'addBookmark')}</span></button>
          <button type="button" className="act-btn" data-act-copy onClick={() => copy(a)}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            <span>{fill(lang, 'copyRef', { ref: refNode(s, a) })}</span></button>
        </div>
        <p className="hint sheet-note" data-act-note>{t(lang, 'bookmarkDeviceOnly')}</p>
        <p className="msg sheet-status" role="status" aria-live="polite" data-act-status>{msgNode(msg, a)}</p>
      </div>
    );
  }

  // ----- the Tafseer panel's content -----
  let tfBody: ReactNode = null;
  if (tfA) {
    const a = tfA;
    const pa = playingAyah(a);
    tfBody = (
      <div className="sheet-in" data-a={a}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="tfp-title" className="sheet-title" tabIndex={-1} data-tfp-title>{fill(lang, 'tafseerPanelTitle', { name: <bdi lang={nameLang}>{name}</bdi>, a: <bdi dir="ltr">{a}</bdi> })}</h2>
          {audio && <button type="button" className="btn icon-btn" data-tfp-play data-state={pa ? 'playing' : 'idle'} disabled={!engine}
            aria-label={t(lang, pa ? 'audioPauseAyah' : 'audioPlayAyah', { a })} title={t(lang, pa ? 'audioPauseAyah' : 'audioPlayAyah', { a })}
            onClick={() => playAyah(a, () => undefined, () => setTfMsg(t(lang, 'audioOffline')))}>{pa ? pauseIcon : playIcon}</button>}
          <button type="button" className="btn icon-btn sheet-close" data-tfp-close aria-label={t(lang, 'closeTafseer')} title={t(lang, 'closeTafseer')} onClick={closeTf}>{closeIcon}</button>
        </div>
        <div className="sheet-body">
          <p className="tfp-links"><a href={`${surahPath(other, s)}#a${a};tafseer`} lang={other} hrefLang={other} aria-label={t(lang, 'otherLangLabel')} data-tfp-lang>{t(lang, 'otherLang')}</a></p>
          <p className="msg alert tfp-status" role="status" aria-live="polite" data-tfp-status>{tfMsg}</p>
          {dev && <p className="msg" role="note" data-tafseer-dev><BidiText text={t(lang, 'tafseerDevNote')} lang={lang} /></p>}
          <section className="tf-section tf-quran" aria-labelledby="tfp-quran-h" data-tf-quran>
            <h2 id="tfp-quran-h">{t(lang, 'quranSection')}</h2>
            <ol className="tf-ayat" data-surah={s}>
              <li className="tf-row" data-a={a}>
                <p className="tf-ref" tabIndex={-1} data-tf-ref><bdi lang={nameLang}>{name}</bdi>{t(lang, 'resultRef', { s, a })}</p>
                <p className="ayah" lang="ar" dir="rtl" translate="no" data-r={`${s}:${a}`} data-tfp-ayah>{tfText}</p>
              </li>
            </ol>
          </section>
          <section className="tf-section tf-tafseer" aria-labelledby="tfp-tafseer-h" data-tf-tafseer>
            <h2 id="tfp-tafseer-h">{t(lang, 'tafseerSection')}</h2>
            <TafseerView key={tfKey} lang={lang} s={s} count={count} prevCount={prevCount} last={last} dev={dev} host={host} />
          </section>
        </div>
      </div>
    );
  }

  return (
    <>
      <dialog ref={actDlg} className="sheet" aria-modal="true" aria-label={act ? t(lang, 'ayahActions', { a: act }) : undefined} data-ayah-panel
        onCancel={(e) => { e.preventDefault(); closeAct(); }} onClose={() => { if (actA.current) closeAct(); }}
        onClick={(e) => { if (e.target === e.currentTarget) closeAct(); }} onKeyDown={trap}>{actBody}</dialog>
      {tafseer && <dialog ref={tfDlg} className="sheet sheet-tall" aria-modal="true" aria-labelledby={tfA ? 'tfp-title' : undefined} data-tf-panel
        onCancel={(e) => { e.preventDefault(); closeTf(); }} onClose={() => { if (tfOpen.current) closeTf(); }}
        onClick={(e) => { if (e.target === e.currentTarget) closeTf(); }} onKeyDown={trap}>{tfBody}</dialog>}
    </>
  );
}
