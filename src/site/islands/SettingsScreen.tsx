// RQ-008 Settings screen (AC70 to AC78, kit v37). Everything here is kept on this device only and is
// never sent anywhere (rifq.settings, rifq.saves, rifq.recent).
// - Appearance: the light/dark switch (AC71, D-102): one control, role="switch" with aria-checked,
//   visible label night. It applies at once and is stored in rifq.settings as before; the layout's
//   early script still applies the stored theme before paint (AC72).
// - Text size: the 5 sizes of D-065, "Text size: n of 5" (AC70, AC73).
// - Interface language (D-181 C, AC75): Arabic and English; choosing one opens this screen in that
//   language. The reading place is kept by the last reading position (the Read tab).
// - Reciter (audio builds only): today's list and stored choice (RQ-006 AC15, AC16), from RIFQ's own
//   /api/audio/reciters, as the reader page does. Kit v38 (Hamzeh, v37 test): the row shows the
//   chosen reciter's name as Quran Foundation gives it, in the Arabic and the English interface
//   alike. So the list (a POST of {lang} only) is asked for when this screen opens; this screen is
//   where the reciter list lives. The name line keeps its space, so it moves nothing when it fills.
//   D-206 A (2026-11-23, QA v38 FIND-BY): this request when Settings opens is an approved change to
//   RQ-006 AC3; the reader page itself still requests nothing before play or opening the list.
// - Data on this device: clear last reading position (RQ-003 v1.3 behaviour, D-184 A), clear recently
//   read (D-183 A, AC74), and a link to the Saved screen for bookmarks.
// - A link to the privacy page.
// AC76: when a setting cannot be stored it still applies to this page, and settingsNotRemembered says
// it will not be remembered.
// - Tips (kit v40, RQ-008 stage 4, AC85): Show tips again clears "tips seen", so tip 1 shows the next
//   time a reader page opens, and tipsAgainDone says so. With storage blocked nothing can be cleared
//   or remembered, so the tips open here at once instead (AC81: "they can still be opened from
//   Settings").
import { currentView, pagesOn, writeView, type View } from '../client/view.ts';
import { useEffect, useRef, useState } from 'react';
import { clearLast, getStorage, load, refExists, type Saves, type StorageLike } from '../../core/store.ts';
import { clearRecent, loadRecent } from '../../core/recent.ts';
import { privacyPath, savedPath, settingsPath, t, type Lang } from '../../core/strings.ts';
import { apply, read, SIZES, type SettingsValue } from './Settings.tsx';
import { useRecitation } from '../client/use-recitation.ts';
import { creditNode } from '../client/credit.ts';
import { fill } from '../client/fill.ts';
import { onDeviceChange } from '../client/device-events.ts';
import { clearTipsSeen, tipList } from '../../core/tips.ts';
import { TipsDialog } from './Tips.tsx';

type Props = { lang: Lang; counts: number[]; names: [string, string][]; audio: boolean; tafseer?: boolean; dev: boolean };

// As the reader page player (AudioPlayer): a name with Latin letters is English, otherwise Arabic.
const nameLang = (n: string) => (/[A-Za-z]/.test(n) ? 'en' : 'ar');

export default function SettingsScreen({ lang, counts, names, audio, tafseer = false, dev }: Props) {
  const [tipsMsg, setTipsMsg] = useState('');
  const [tipsOpen, setTipsOpen] = useState(false);
  // AC85; AC81 with storage blocked.
  function tipsAgain() {
    if (clearTipsSeen(getStorage(window))) { setTipsMsg(''); requestAnimationFrame(() => setTipsMsg(t(lang, 'tipsAgainDone'))); }
    else setTipsOpen(true);
  }
  const [ready, setReady] = useState(false);
  const [s, setS] = useState<SettingsValue>({ size: 1.5, dark: false });
  const [setMsg, setSetMsg] = useState('');
  // Kit v43 (RQ-009 AC1, AC4, AC119): the reading view, on the device only; page mode builds only.
  const [view, setViewState] = useState<View>('scroll');
  const [viewMsg, setViewMsg] = useState('');
  useEffect(() => { setViewState(currentView()); }, []);
  const chooseView = (v: View) => {
    setViewState(v);
    const okV = writeView(v);
    setViewMsg('');
    if (!okV) requestAnimationFrame(() => setViewMsg(t(lang, 'settingsNotRemembered')));
  };
  const [st, setSt] = useState<StorageLike | null>(null);
  const [ok, setOk] = useState(true);
  const [saves, setSaves] = useState<Saves>({ v: 1, b: [], l: null });
  const [recent, setRecent] = useState<number[]>([]);
  const [confirmLast, setConfirmLast] = useState(false);
  const [confirmRecent, setConfirmRecent] = useState(false);
  const [dataMsg, setDataMsg] = useState('');
  const [focusTo, setFocusTo] = useState<'' | 'last-confirm' | 'last-button' | 'recent-confirm' | 'recent-button' | 'heading'>('');
  const lastBtn = useRef<HTMLButtonElement>(null);
  const lastConfirmBtn = useRef<HTMLButtonElement>(null);
  const recentBtn = useRef<HTMLButtonElement>(null);
  const recentConfirmBtn = useRef<HTMLButtonElement>(null);
  const dataHeading = useRef<HTMLHeadingElement>(null);

  const refresh = (x: StorageLike | null) => {
    const r = load(x); setOk(r.ok); setSaves(r.saves);
    setRecent(loadRecent(x).list);
  };
  useEffect(() => {
    setS(read());
    const x = getStorage(window);
    setSt(x); refresh(x); setReady(true);
    return onDeviceChange(() => { refresh(x); setS(read()); });
  }, []);
  useEffect(() => {
    if (!focusTo) return;
    const el = { 'last-confirm': lastConfirmBtn, 'last-button': lastBtn, 'recent-confirm': recentConfirmBtn, 'recent-button': recentBtn, heading: dataHeading }[focusTo].current;
    el?.focus({ preventScroll: true });
    setFocusTo('');
  }, [focusTo]);

  const change = (n: SettingsValue) => {
    const stored = apply(n);
    setS(n);
    // P-16 (proposal): the message shows once and stays for the rest of this page.
    if (!stored) setSetMsg(t(lang, 'settingsNotRemembered'));
  };
  const i = SIZES.indexOf(s.size);

  const name = (n: number) => names[n - 1]?.[lang === 'ar' ? 0 : 1] ?? '';
  const last = saves.l;
  const lastOk = last ? refExists(counts, last) : false;
  useEffect(() => { if (!last) setConfirmLast(false); }, [last]);
  useEffect(() => { if (!recent.length) setConfirmRecent(false); }, [recent.length]);

  // RQ-003 v1.3 AC16 to AC20, as on the Saved screen: only the last position is removed.
  function removeLast() {
    const r = clearLast(st);
    setDataMsg(r === 'failed' ? t(lang, 'clearLastFailed') : t(lang, 'clearLastDone'));
    setConfirmLast(false);
    refresh(st);
    setFocusTo(r === 'failed' ? 'last-button' : 'heading');
  }
  // AC74: only recently read is removed; bookmarks, last position and settings stay.
  function removeRecent() {
    const r = clearRecent(st);
    setDataMsg(r === 'failed' ? t(lang, 'clearRecentFailed') : t(lang, 'clearRecentDone'));
    setConfirmRecent(false);
    refresh(st);
    setFocusTo(r === 'failed' ? 'recent-button' : 'heading');
  }

  const { snap, engine } = useRecitation(dev);
  // D-206 A (RQ-006 AC3 as changed): the list is asked for when Settings opens, once per language
  // per tab, shared with the engine's own request after a language switch (FIND-BV).
  useEffect(() => { if (audio && engine) void engine.loadReciters(lang); }, [audio, engine, lang]);
  const list = snap.lists[lang] ?? null;
  // The name in this interface language once its list is in; until then, as the reader page does,
  // the name from the list of the other language, if that one is already in this tab.
  const reciter = (list ?? snap.lists.ar ?? snap.lists.en)?.find((r) => r.id === snap.rid) ?? null;
  const recMsg = snap.msg && (snap.msg.key === 'audioNotRemembered' || snap.msg.key === 'audioReciterGone') ? t(lang, snap.msg.key, snap.msg.vars) : '';

  return (
    <div className="settings-screen" data-settings-screen>
      <section className="set-sec" aria-labelledby="set-appearance-h">
        <h2 id="set-appearance-h">{t(lang, 'appearance')}</h2>
        {/* The track follows the html .dark class (set before paint by the layout's early script),
            so it shows the right state before this island loads; aria-checked follows once loaded. */}
        <button type="button" role="switch" className="switch" aria-checked={s.dark} data-night-switch
          disabled={!ready} onClick={() => change({ ...s, dark: !s.dark })}>
          <span className="switch-label">{t(lang, 'night')}</span>
          <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        </button>
      </section>
      <section className="set-sec" aria-labelledby="set-size-h">
        <h2 id="set-size-h">{t(lang, 'textSize')}</h2>
        <div className="set-size" role="group" aria-labelledby="set-size-h">
          <button type="button" className="btn" data-set-smaller aria-label={t(lang, 'smaller')} disabled={!ready || i <= 0} onClick={() => change({ ...s, size: SIZES[Math.max(0, i - 1)] })}><bdi dir="ltr">A-</bdi></button>
          <span className="size-label" data-set-size-label>{t(lang, 'fontSize', { n: i + 1, m: SIZES.length })}</span>
          <button type="button" className="btn" data-set-larger aria-label={t(lang, 'larger')} disabled={!ready || i >= SIZES.length - 1} onClick={() => change({ ...s, size: SIZES[Math.min(SIZES.length - 1, i + 1)] })}><bdi dir="ltr">A+</bdi></button>
        </div>
        <p className="msg alert" role="status" aria-live="polite" data-settings-status>{setMsg}</p>
      </section>
      {pagesOn() && (
        <section className="set-sec" aria-labelledby="set-view-h" data-set-view>
          <h2 id="set-view-h">{t(lang, 'readingView')}</h2>
          <div className="set-choices set-radios" role="radiogroup" aria-labelledby="set-view-h" aria-describedby="set-view-help">
            {(['scroll', 'pages'] as const).map((v) => (
              <label key={v} className="ap-choice set-radio"><input type="radio" name="set-view" value={v} checked={view === v} onChange={() => chooseView(v)} data-set-view-opt={v} /> {t(lang, v === 'scroll' ? 'viewScroll' : 'viewPages')}</label>
            ))}
          </div>
          <p className="hint" id="set-view-help" data-set-view-help>{t(lang, 'readingViewHelp')}</p>
          <p className="msg alert" role="status" aria-live="polite" data-set-view-status>{viewMsg}</p>
        </section>
      )}
      <section className="set-sec" aria-labelledby="set-lang-h">
        <h2 id="set-lang-h">{t(lang, 'interfaceLanguage')}</h2>
        <ul className="set-choices" data-set-lang>
          {(['ar', 'en'] as const).map((l) => (
            <li key={l}>
              <a href={settingsPath(l)} hrefLang={l} data-set-lang-link={l} aria-current={l === lang ? 'true' : undefined}>
                <span className="set-check" aria-hidden="true">{l === lang ? '✓' : ''}</span>
                {t(lang, l === 'ar' ? 'langArabic' : 'langEnglish')}
              </a>
            </li>
          ))}
        </ul>
      </section>
      {audio && (
        <section className="set-sec" aria-labelledby="set-reciter-h" data-set-reciter>
          <h2 id="set-reciter-h">{t(lang, 'audioReciter')}</h2>
          <p className="set-reciter-now" data-set-reciter-now>{reciter ? fill(lang, 'reciterChip', { name: <bdi lang={nameLang(reciter.name)} data-set-reciter-name>{reciter.name}</bdi> }) : null}</p>
          <details className="ap-more" data-set-reciter-more onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void engine?.loadReciters(lang); }}>
            <summary className="ap-summary">
              <span>{t(lang, 'audioMoreLabel')}</span>
            </summary>
            {list && (
              <fieldset className="ap-reciters" data-set-reciters>
                <legend>{t(lang, 'audioReciter')}</legend>
                {list.map((r) => (
                  <label key={r.id} className="ap-choice"><input type="radio" name="set-reciter" value={r.id} checked={r.id === snap.rid} onChange={() => engine?.chooseReciter(r.id)} data-set-reciter-id={r.id} /> <bdi lang={nameLang(r.name)}>{r.name}</bdi></label>
                ))}
              </fieldset>
            )}
          </details>
          {/* Kit v41 (D-254): the credit names the reciter and Quran Foundation. */}
          <p className="ap-credit" data-set-credit data-credit-named={reciter ? '1' : '0'}>{creditNode(lang, reciter?.name)}</p>
          <p className="msg alert" role="status" aria-live="polite" data-set-reciter-status>{recMsg}</p>
        </section>
      )}
      {/* RQ-008's table has no "Tips" heading string, so this part has the button only. */}
      <section className="set-sec" data-set-tips>
        <p><button type="button" className="btn" data-set-tips-again disabled={!ready} onClick={tipsAgain}>{t(lang, 'tipsAgain')}</button></p>
        <p role="status" aria-live="polite" className="msg" data-set-tips-status>{tipsMsg}</p>
        {tipsOpen && <TipsDialog lang={lang} ids={tipList(audio, tafseer)} onEnd={() => setTipsOpen(false)} />}
      </section>
      <section className="set-sec" aria-labelledby="set-data-h" data-set-data>
        <h2 id="set-data-h" ref={dataHeading} tabIndex={-1}>{t(lang, 'deviceData')}</h2>
        <p className="hint">{t(lang, 'bookmarksNote')}</p>
        {ready && !ok && <p className="msg alert" data-storage-blocked>{t(lang, 'storageBlocked')}</p>}
        {ready && ok && last && (!confirmLast
          ? <p><button type="button" className="btn" data-set-clear-last ref={lastBtn}
              aria-label={lastOk ? t(lang, 'clearLastName', { name: name(last[0]), a: last[1] }) : undefined}
              onClick={() => { setConfirmLast(true); setFocusTo('last-confirm'); }}>{t(lang, 'clearLast')}</button></p>
          : <div className="confirm-step" data-set-clear-last-step>
              <p className="hint">{t(lang, 'clearLastNote')}</p>
              <p className="confirm">
                <button type="button" className="btn danger" data-set-clear-last-confirm ref={lastConfirmBtn} onClick={removeLast}>{t(lang, 'clearLastConfirm')}</button>
                <button type="button" className="btn" data-set-clear-last-cancel onClick={() => { setConfirmLast(false); setFocusTo('last-button'); }}>{t(lang, 'cancel')}</button>
              </p>
            </div>)}
        {ready && ok && recent.length > 0 && (!confirmRecent
          ? <p><button type="button" className="btn" data-set-clear-recent ref={recentBtn}
              onClick={() => { setConfirmRecent(true); setFocusTo('recent-confirm'); }}>{t(lang, 'clearRecent')}</button></p>
          : <div className="confirm-step" data-set-clear-recent-step>
              <p className="confirm">
                <button type="button" className="btn danger" data-set-clear-recent-confirm ref={recentConfirmBtn} onClick={removeRecent}>{t(lang, 'clearRecentConfirm')}</button>
                <button type="button" className="btn" data-set-clear-recent-cancel onClick={() => { setConfirmRecent(false); setFocusTo('recent-button'); }}>{t(lang, 'cancel')}</button>
              </p>
            </div>)}
        <p><a className="set-link" href={savedPath(lang)} data-set-saved-link>{t(lang, 'bookmarks')}</a></p>
        <p role="status" aria-live="polite" className="msg" data-set-data-status>{dataMsg}</p>
      </section>
      <p><a className="set-link" href={privacyPath(lang)} data-set-privacy-link>{t(lang, 'privacyLink')}</a></p>
    </div>
  );
}
