// RQ-008 stage 4 (kit v40, D-199): first-visit tips, AC79 to AC85, P-12.
// - AC79: on a device that has never seen the tips, with storage available, the first reader page
//   shows tip 1 of 3 as a modal dialog once the page is up (this island loads when the browser is
//   idle, after the Quran text is shown, so it never delays it). Each tip has "Tip n of m", a title,
//   a short text, and Skip and Next; the last tip has Done in place of Next.
// - AC80: Skip, Done or Esc closes it and records "tips seen" (src/core/tips.ts); the tips then never
//   show again on this device, in either interface, until Show tips again (AC85, Settings).
// - AC81 (P-12): with storage blocked they never show by themselves (they would come back on every
//   visit); Settings can still open them (SettingsScreen).
// - AC82: focus moves into the dialog (to its heading, which holds "Tip n of m" and the title, so both
//   are read out), stays inside it, and returns where it was when it closes; buttons are 44 px.
// - AC83: only features this build has (tipList); interface text only, never Quran or Tafseer text.
// - AC84: while a recitation plays, another dialog is open (the ayah actions or Tafseer panel), or the
//   page was opened on the Tafseer panel, the tips wait, and show once that has ended.
// Nothing here is sent anywhere (AC87).
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import { getStorage } from '../../core/store.ts';
import { markTipsSeen, tipList, tipsSeen, type TipId } from '../../core/tips.ts';
import { t, type Key, type Lang } from '../../core/strings.ts';
import BidiText from './BidiText.tsx';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TITLE: Record<TipId, Key> = { 1: 'tip1Title', 2: 'tip2Title', 3: 'tip3Title' };
const BODY: Record<TipId, Key> = { 1: 'tip1Body', 2: 'tip2Body', 3: 'tip3Body' };
// How often a waiting tip checks again whether it may show (AC84).
export const TIPS_WAIT_MS = 500;

// The tips dialog itself. onEnd runs when it closes by Skip, Done or Esc.
export function TipsDialog({ lang, ids, onEnd }: { lang: Lang; ids: TipId[]; onEnd: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const back = useRef<Element | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    const d = dlg.current;
    if (!d || d.open) return;
    back.current = document.activeElement;
    const x = scrollX, y = scrollY;
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
    head.current?.focus({ preventScroll: true });
    if (scrollX !== x || scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
    return () => { if (d.open) d.close(); };
  }, []);
  useEffect(() => { if (i) head.current?.focus({ preventScroll: true }); }, [i]);

  function end() {
    const d = dlg.current;
    const x = scrollX, y = scrollY;
    if (d?.open) d.close();
    const to = back.current as HTMLElement | null;
    if (to && to !== document.body && to.isConnected && typeof to.focus === 'function') to.focus({ preventScroll: true });
    if (scrollX !== x || scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
    onEnd();
  }
  function trap(e: RKeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Tab') return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
    if (!f.length) return;
    const k = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && k <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (k === f.length - 1 || k === -1)) { e.preventDefault(); f[0].focus(); }
  }

  const id = ids[i];
  const lastTip = i === ids.length - 1;
  return (
    <dialog ref={dlg} className="tips-dlg" aria-modal="true" aria-labelledby="tips-h" aria-describedby="tips-body" data-tips data-tip={id}
      onCancel={(e) => { e.preventDefault(); end(); }} onKeyDown={trap}>
      <h2 id="tips-h" ref={head} tabIndex={-1} className="tips-h">
        <span className="tips-count" data-tip-count>{t(lang, 'tipOf', { n: i + 1, m: ids.length })}</span>
        <span className="tips-title" data-tip-title>{t(lang, TITLE[id])}</span>
      </h2>
      <p id="tips-body" className="tips-body" data-tip-body><BidiText text={t(lang, BODY[id])} lang={lang} /></p>
      <div className="tips-actions">
        <button type="button" className="btn" data-tip-skip onClick={end}>{t(lang, 'tipSkip')}</button>
        {lastTip
          ? <button type="button" className="btn primary" data-tip-done onClick={end}>{t(lang, 'done')}</button>
          : <button type="button" className="btn primary" data-tip-next onClick={() => setI(i + 1)}>{t(lang, 'next')}</button>}
      </div>
    </dialog>
  );
}

// AC84: something the tips must not cover.
function busy(): boolean {
  if (document.querySelector('dialog[open]') || document.documentElement.dataset.panel) return true;
  if (/;tafseer$/.test(location.hash)) return true;
  const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null;
  return !!a && !a.paused && !a.ended;
}

// On reader pages: shows the tips by themselves once (AC79 to AC84).
export default function Tips({ lang, audio, tafseer }: { lang: Lang; audio: boolean; tafseer: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const st = getStorage(window);
    const r = tipsSeen(st);
    if (!r.ok || r.seen) return; // AC81, AC80
    let timer = 0;
    const tryShow = () => {
      if (busy()) { timer = window.setTimeout(tryShow, TIPS_WAIT_MS); return; }
      // Seen meanwhile in another tab or page of this device.
      if (tipsSeen(st).seen) return;
      setShow(true);
    };
    // After the page has painted (AC79: the Quran text first).
    const raf = requestAnimationFrame(() => { timer = window.setTimeout(tryShow, 0); });
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, []);
  if (!show) return null;
  return <TipsDialog lang={lang} ids={tipList(audio, tafseer)} onEnd={() => { markTipsSeen(getStorage(window)); setShow(false); }} />;
}
