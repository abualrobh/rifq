// RQ-006 v1.3 "Listen to the Quran" on a reader page: since kit v38 (RQ-008 AC51 to AC55, D-188 A,
// D-203 A) the Play surah row at the top of the surah, below its title. It scrolls with the page;
// nothing of it is fixed on screen. The mini-player above the tab bar is the only player (AC55).
//
// The recitation itself lives in the tab's engine (src/site/client/recitation.ts) so it keeps
// playing across in-place page changes (D-126). This island is a view of it for one surah page:
// - Play surah starts surah playback from ayah 1 exactly as before (RQ-006); while this surah is
//   loaded the same button pauses and resumes it, as the full player's main button did;
// - the reciter button (AC51) shows the chosen reciter's name as Quran Foundation gives it, once the
//   list has been loaded in this tab (it is never requested before play or before the list is
//   opened, RQ-006 AC3); it opens today's reciter list under today's rules (D-111, D-119, D-122),
//   with the recitation source details and the credit (AC52, audioSourceDetails; since kit v41 the
//   credit names the reciter, audioCreditBy, D-254);
// - on the playing surah's own page it marks the playing ayah, scrolls with it and announces each
//   new ayah (AC6, AC7, AC44; the engine does the marking and scrolling, AC53, AC54);
// - on another surah's page it stays idle for its own surah while the mini-player shows what plays;
//   only Play surah here (or an ayah's actions panel) replaces the recitation (AC65, D-126 3A).
// Unmounting this island (a page change) never stops the sound.
//
// Removed in kit v38 with the fixed full player (D-203 A): its previous and next ayah buttons
// (the lock screen keeps previous and next, AC28), its "go to the playing ayah" button (the
// mini-player has it, AC64, AC55) and the "Listening continues..." note. The per-ayah play and
// play-from buttons moved into the ayah actions panel (D-187 A, islands/AyahPanels.tsx).
import { useEffect, useState } from 'react';
import { t, type Lang } from '../../core/strings.ts';
import type { Names } from '../client/recitation.ts';
import { useRecitation } from '../client/use-recitation.ts';
import SourceDetails from './SourceDetails.tsx';
import { creditNode } from '../client/credit.ts';
import { fill } from '../client/fill.ts';

type Props = { lang: Lang; s: number; count: number; names: Names; dev?: boolean };

export { GIVE_UP_MS, LOADING_MS, SCROLL_PAUSE_MS } from '../client/recitation.ts';

// QA v25 FIND-D: in development builds the reason code is shown after the message. It is Latin in
// brackets, so it is isolated (and kept left to right) inside Arabic text.
function Coded({ text, code, dev }: { text: string; code: string; dev: boolean }) {
  return dev && code ? <>{text} <bdi dir="ltr" lang="en" data-code>[{code}]</bdi></> : <>{text}</>;
}

// A name with Latin letters is English, otherwise Arabic (as before).
export const nameLang = (n: string) => (/[A-Za-z]/.test(n) ? 'en' : 'ar');

export default function AudioPlayer({ lang, s, count, names, dev = false }: Props) {
  const { snap, engine } = useRecitation(dev);
  const [open, setOpen] = useState(false);
  const own = snap.s === s && snap.s > 0;
  const mode = own ? snap.mode : 'idle';
  const active = mode !== 'idle';
  const info = { count, names };

  useEffect(() => { engine?.paint(); }, [engine]);
  // The reciter list is loaded when it is opened (RQ-006 AC3), as the full player's list was. (D-206 A:
  // the Settings screen, not this page, also asks for it when it opens.)
  useEffect(() => { if (open) void engine?.loadReciters(lang); }, [open, engine, lang]);

  const msg = snap.msg && snap.msg.at === s ? snap.msg : null;
  const msgText = msg ? t(lang, msg.key, msg.vars) : '';
  const dead = snap.dead && (snap.dead.kind === 'reciters-empty' || snap.dead.s === s) ? snap.dead.kind : '';
  const list = snap.lists[lang] ?? null;
  const reciter = (list ?? snap.lists.ar ?? snap.lists.en)?.find((x) => x.id === snap.rid) ?? null;
  const ready = !!engine;
  return (
    <div className="ap-player" role="region" aria-label={t(lang, 'audioPlayerLabel')} data-audio-player data-ready={ready ? '1' : '0'} data-mode={mode} data-current={own ? snap.current : 0}>
      <div className="ap-row">
        {!active
          ? <button type="button" className="btn ap-main" data-play-surah disabled={!!dead} aria-describedby={dead ? 'ap-dead' : undefined} onClick={() => engine?.start('surah', s, 1, info)}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
              <span>{t(lang, 'audioPlaySurah')}</span>
            </button>
          : <button type="button" className="btn ap-main" data-pause onClick={() => engine?.pauseOrResume()}>{snap.playing ? t(lang, 'audioPause') : t(lang, 'audioResume')}</button>}
        {/* AC51, AC52: the reciter button. A disclosure: its list, source details and credit show
            below the row while it is open. */}
        <button type="button" className="btn ap-chip" data-reciter-btn aria-expanded={open} aria-controls="ap-more" onClick={() => setOpen(!open)}>
          {reciter
            ? <span data-reciter-chip>{fill(lang, 'reciterChip', { name: <bdi lang={nameLang(reciter.name)} data-reciter-name>{reciter.name}</bdi> })}</span>
            : <span data-reciter-chip>{t(lang, 'audioReciter')}</span>}
        </button>
      </div>
      {/* QA FIND-8: a disabled play button says why, next to it and as its description. QA v25
          FIND-C: said here only, not again in the status line; this line is itself the live region. */}
      <p className="msg ap-dead" id="ap-dead" role="status" data-audio-dead={dead || undefined} hidden={!dead}>{dead ? <Coded text={t(lang, dead === 'reciters-empty' ? 'audioNoReciter' : 'audioNoSurah')} code={dead} dev={dev} /> : null}</p>
      <div id="ap-more" className="ap-more" data-audio-more hidden={!open}>
        {list && (
          <fieldset className="ap-reciters" data-reciters>
            <legend>{t(lang, 'audioReciter')}</legend>
            {list.map((r) => (
              <label key={r.id} className="ap-choice"><input type="radio" name="reciter" value={r.id} checked={r.id === snap.rid} onChange={() => engine?.chooseReciter(r.id)} data-reciter={r.id} /> <bdi lang={nameLang(r.name)}>{r.name}</bdi></label>
            ))}
          </fieldset>
        )}
        {reciter && <SourceDetails lang={lang} reciter={reciter} idBase="ap" />}
        {/* AC52 (D-188 A): the credit is behind the reciter button; while a recitation is loaded the
            mini-player also names the reciter and Quran Foundation on every page. Kit v41 (D-254):
            the credit names the reciter. */}
        <p className="ap-credit" data-audio-credit data-credit-named={reciter ? '1' : '0'}>{creditNode(lang, reciter?.name)}</p>
      </div>
      <p className={msg?.alert ? 'msg alert ap-status' : 'msg ap-status'} role="status" aria-live="polite" data-audio-status data-loading={own && snap.loading ? '1' : '0'} data-reason={snap.reason}>{msg ? <Coded text={msgText} code={msg.code} dev={dev} /> : null}</p>
      {/* AC44: on the playing surah's page only, once per ayah, number only. */}
      <p className="sr-only" aria-live="polite" data-audio-now>{own && snap.current && snap.mode !== 'idle' ? t(lang, 'audioNowAyah', { a: snap.current }) : ''}</p>
    </div>
  );
}
