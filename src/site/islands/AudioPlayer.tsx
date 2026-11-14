// RQ-006 v1.3 "Listen to the Quran": the full player on each reader page.
//
// Since v1.3 (D-126) the recitation itself lives in the tab's engine (src/site/client/recitation.ts)
// so it keeps playing across in-place page changes. This island is a view of it for one surah page:
// - on the playing surah's own page (either language) it shows and controls the recitation, marks
//   the playing ayah, scrolls with it and announces ayah changes (AC6, AC7, AC44);
// - on another surah's page it stays idle for its own surah while the mini-player shows what plays;
//   only a play control here replaces the recitation (AC65, D-126 3A, AC10);
// - the reciter list works from any reader page and restarts what plays (AC19, A5).
// Unmounting this island (a page change) never stops the sound.
//
// The per-ayah play buttons are in the static HTML (Reader.astro), hidden with their space kept
// until this island loads, so without JavaScript no broken control shows (AC48).
import { useEffect } from 'react';
import { t, type Lang } from '../../core/strings.ts';
import type { Names } from '../client/recitation.ts';
import { useRecitation } from '../client/use-recitation.ts';
import BidiText from './BidiText.tsx';

type Props = { lang: Lang; s: number; count: number; names: Names; dev?: boolean };

export { GIVE_UP_MS, LOADING_MS, SCROLL_PAUSE_MS } from '../client/recitation.ts';

// QA v25 FIND-D: in development builds the reason code is shown after the message. It is Latin in
// brackets, so it is isolated (and kept left to right) inside Arabic text.
function Coded({ text, code, dev }: { text: string; code: string; dev: boolean }) {
  return dev && code ? <>{text} <bdi dir="ltr" lang="en" data-code>[{code}]</bdi></> : <>{text}</>;
}

export default function AudioPlayer({ lang, s, count, names, dev = false }: Props) {
  const { snap, engine } = useRecitation(dev);
  const own = snap.s === s && snap.s > 0;
  const mode = own ? snap.mode : 'idle';
  const active = mode !== 'idle';
  const info = { count, names };

  useEffect(() => {
    if (!engine) return;
    // Per-ayah play buttons (static HTML), shown now with their space already kept.
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ap, button.apf')) { b.removeAttribute('data-pending'); b.removeAttribute('tabindex'); }
    engine.paint();
    const list = document.querySelector('ol.ayat');
    const onClick = (e: Event) => {
      // P-1 (D-121): "play from here" beside each ayah plays the surah from that ayah.
      const f = (e.target as Element).closest<HTMLButtonElement>('button.apf');
      if (f) { engine.start('surah', s, Number(f.dataset.apf), info); return; }
      const b = (e.target as Element).closest<HTMLButtonElement>('button.ap');
      if (!b) return;
      const a = Number(b.dataset.ap);
      const st = engine.get();
      // TOG-1 and QA v25 FIND-E: the playing ayah's control is a pause control, in single-ayah and
      // in surah playback. AC1 still holds: every other ayah's control starts that ayah.
      if (st.s === s && st.mode !== 'idle' && st.current === a && !engine.el.paused) { engine.el.pause(); return; }
      engine.start('ayah', s, a, info);
    };
    list?.addEventListener('click', onClick);
    return () => list?.removeEventListener('click', onClick);
  }, [engine, s, count]);

  // QA v26 FIND-F (SC 2.4.11, AC43, AC67 d): the sticky player's measured height, as --player-h, so
  // an ayah control that gets keyboard focus is scrolled clear of the player (and the mini-player
  // under it; global.css). Updated whenever the player's height changes.
  useEffect(() => {
    const box = document.querySelector<HTMLElement>('[data-player]');
    if (!box) return;
    const root = document.documentElement;
    const setH = () => root.style.setProperty('--player-h', Math.ceil(box.getBoundingClientRect().height) + 'px');
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(box);
    return () => {
      ro.disconnect();
      // Another reader page's player may already have set its own height (in-place change).
      if (!box.isConnected && !document.querySelector('[data-player]')) root.style.removeProperty('--player-h');
    };
  }, []);

  const msg = snap.msg && snap.msg.at === s ? snap.msg : null;
  const msgText = msg ? t(lang, msg.key, msg.vars) : '';
  const dead = snap.dead && (snap.dead.kind === 'reciters-empty' || snap.dead.s === s) ? snap.dead.kind : '';
  const list = snap.lists[lang] ?? null;
  const reciter = (list ?? snap.lists.ar ?? snap.lists.en)?.find((x) => x.id === snap.rid) ?? null;
  const nameLang = (n: string) => (/[A-Za-z]/.test(n) ? 'en' : 'ar');
  const ready = !!engine;
  return (
    <div className="ap-player" role="region" aria-label={t(lang, 'audioPlayerLabel')} data-audio-player data-ready={ready ? '1' : '0'} data-mode={mode} data-current={own ? snap.current : 0}>
      <div className="ap-row">
        {!active
          ? <button type="button" className="btn ap-main" data-play-surah disabled={!!dead} aria-describedby={dead ? 'ap-dead' : undefined} onClick={() => engine?.start('surah', s, 1, info)}>{t(lang, 'audioPlaySurah')}</button>
          : <button type="button" className="btn ap-main" data-pause onClick={() => engine?.pauseOrResume()}>{snap.playing ? t(lang, 'audioPause') : t(lang, 'audioResume')}</button>}
        <button type="button" className="btn icon-btn" data-prev-ayah aria-label={t(lang, 'prevAyah')} title={t(lang, 'prevAyah')} disabled={!active || snap.current <= 1} onClick={() => engine?.seekAyah(engine.get().current - 1)}>
          <svg className="ap-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5v14M19 5l-9 7 9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="btn icon-btn" data-next-ayah aria-label={t(lang, 'nextAyah')} title={t(lang, 'nextAyah')} disabled={!active || snap.current >= count} onClick={() => engine?.seekAyah(engine.get().current + 1)}>
          <svg className="ap-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 5v14M5 5l9 7-9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        {active && mode === 'surah' && !snap.follow && <button type="button" className="btn" data-go-current onClick={() => engine?.setFollow(true)}>{t(lang, 'audioGoCurrent')}</button>}
      </div>
      {/* QA FIND-8: a disabled play button says why, next to it and as its description. QA v25
          FIND-C: said here only, not again in the status line; this line is itself the live region. */}
      <p className="msg ap-dead" id="ap-dead" role="status" data-audio-dead={dead || undefined} hidden={!dead}>{dead ? <Coded text={t(lang, dead === 'reciters-empty' ? 'audioNoReciter' : 'audioNoSurah')} code={dead} dev={dev} /> : null}</p>
      {/* QA FIND-1: the credit is its own visible line (AC31); the disclosure is labelled and marked. */}
      <p className="ap-credit" data-audio-credit><BidiText text={t(lang, 'audioCredit')} lang={lang} /></p>
      {/* AC66: listening continues across RIFQ, and stops on a reload or in a new tab. */}
      <p className="ap-help" data-audio-help><BidiText text={t(lang, 'audioContinueHelp')} lang={lang} /></p>
      <details className="ap-more" data-audio-more onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void engine?.loadReciters(lang); }}>
        <summary className="ap-summary" data-audio-summary>
          <span>{t(lang, 'audioMoreLabel')}</span>
          {reciter && <span className="ap-summary-now"><bdi lang={nameLang(reciter.name)} data-reciter-name>{reciter.name}</bdi></span>}
        </summary>
        {list && (
          <fieldset className="ap-reciters" data-reciters>
            <legend>{t(lang, 'audioReciter')}</legend>
            {list.map((r) => (
              <label key={r.id} className="ap-choice"><input type="radio" name="reciter" value={r.id} checked={r.id === snap.rid} onChange={() => engine?.chooseReciter(r.id)} data-reciter={r.id} /> <bdi lang={nameLang(r.name)}>{r.name}</bdi></label>
            ))}
          </fieldset>
        )}
        {reciter && (
          <dl className="ap-source" data-audio-source aria-label={t(lang, 'audioSourceDetails')}>
            <dt>{t(lang, 'audioReciter')}</dt><dd><bdi lang={nameLang(reciter.name)}>{reciter.name}</bdi></dd>
            {/* QA FIND-4: Latin text inside the Arabic page is isolated. */}
            <dt>{t(lang, 'audioStyle')}</dt><dd>{reciter.style ? <bdi lang={nameLang(reciter.style)}>{reciter.style}</bdi> : t(lang, 'notStated')}</dd>
            <dt>{t(lang, 'audioRiwayah')}</dt><dd>{reciter.qirat ? <bdi lang={nameLang(reciter.qirat)}>{reciter.qirat}</bdi> : t(lang, 'notStated')}</dd>
            <dt><BidiText text={t(lang, 'audioReciterId')} lang={lang} /></dt><dd>{reciter.id}</dd>
            <dt>{t(lang, 'source')}</dt><dd><bdi lang="en" dir="ltr">Quran Foundation</bdi></dd>
            <dt>{t(lang, 'audioLicenceL')}</dt><dd><BidiText text={t(lang, 'audioLicence')} lang={lang} /></dd>
          </dl>
        )}
      </details>
      <p className={msg?.alert ? 'msg alert ap-status' : 'msg ap-status'} role="status" aria-live="polite" data-audio-status data-loading={own && snap.loading ? '1' : '0'} data-reason={snap.reason}>{msg ? <Coded text={msgText} code={msg.code} dev={dev} /> : null}</p>
      {/* AC44: on the playing surah's page only, once per ayah, number only. */}
      <p className="sr-only" aria-live="polite" data-audio-now>{own && snap.current && snap.mode !== 'idle' ? t(lang, 'audioNowAyah', { a: snap.current }) : ''}</p>
    </div>
  );
}
