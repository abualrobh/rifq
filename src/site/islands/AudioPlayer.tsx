// RQ-006 v1.1 "Listen to the Quran" player, on reader pages only (D-113 A).
//
// One surah file per reciter with per-ayah timings (D-110 B). The browser plays the file directly
// from the approved audio host (D-112 B, AC39 media-src); RIFQ's Worker gives only the address and
// the timings (/api/audio). Nothing is requested before the reader chooses play or opens the
// reciter list (AC3); the audio element never preloads; nothing plays on its own.
//
// The per-ayah play buttons are in the static HTML (Reader.astro), hidden with their space kept
// until this island loads, so without JavaScript no broken control shows (AC48).
//
// Marking (AC6): the row whose timing covers the playback position gets the "current" mark, on the
// row only, never inside the Quran text (AC11). A single ayah stops at its end time (AC53); a surah
// plays to the end of its last ayah and stops (AC9, P-3). During surah playback the playing ayah is
// saved as the last reading position (AC50, D-117 A).
//
// iPhone (AC26 to AC29, D-115 B): the first tap calls play() on the audio element at once, inside
// the tap, before the address is fetched, so iOS lets the element play when the address arrives.
// Lock screen and system controls use the Media Session API. Whether sound continues with the
// screen locked can only be measured on the reference phone.
import { useEffect, useRef, useState } from 'react';
import { approvedAudioUrl, ayahAt } from '../../core/audio.ts';
import { getStorage, setLast } from '../../core/store.ts';
import { t, type Lang } from '../../core/strings.ts';
import { readReciter, writeReciter } from './Settings.tsx';
import BidiText from './BidiText.tsx';

type Reciter = { id: number; name: string; style: string | null; qirat: string | null };
type Meta = { url: string; duration: number; t: [number, number][] };
type Mode = 'idle' | 'ayah' | 'surah';
type Props = { lang: Lang; s: number; count: number; name: string };

export const LOADING_MS = 1000; // AC20: loading state after 1 s
export const GIVE_UP_MS = 15000; // P-5: give up after 15 s
export const SCROLL_PAUSE_MS = 5000; // P-2

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' });
    let data: Record<string, unknown> | null = null;
    try { data = await r.json(); } catch { data = null; }
    return { status: r.status, data };
  } catch { return { status: 0, data: null }; }
}

export default function AudioPlayer({ lang, s, count, name }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false);
  const [reciters, setReciters] = useState<Reciter[] | null>(null);
  const [rid, setRid] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [from, setFrom] = useState(1);
  const [msg, setMsg] = useState('');
  const [alert, setAlert] = useState(false);
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(true);
  const [dead, setDead] = useState(false);
  const [now, setNow] = useState('');
  // Mutable state read by event handlers.
  const st = useRef({ mode: 'idle' as Mode, meta: null as Meta | null, metaKey: '', current: 0, stopAt: -1, follow: true, lastUser: 0, reciters: null as Reciter[] | null, rid: null as number | null, target: 0, storage: null as ReturnType<typeof getStorage>, loadT: 0, giveT: 0, scrollT: 0 });
  const seq = useRef(0);

  const say = (text: string, isAlert = false) => {
    const n = ++seq.current;
    setMsg(''); setAlert(isAlert);
    requestAnimationFrame(() => { if (n === seq.current) setMsg(text); });
  };

  const rows = () => [...document.querySelectorAll<HTMLElement>('li.ayah-row')];
  const reciterName = () => st.current.reciters?.find((x) => x.id === st.current.rid)?.name ?? '';

  function clearTimers() { clearTimeout(st.current.loadT); clearTimeout(st.current.giveT); setLoading(false); }

  function mark(a: number) {
    const x = st.current;
    if (a === x.current) return;
    x.current = a;
    setCurrent(a);
    for (const r of rows()) r.classList.toggle('ap-current', Number(r.dataset.a) === a);
    syncButtons();
    if (!a) return;
    setNow(t(lang, 'audioNowAyah', { a })); // AC44: once per ayah, number only
    if (x.mode === 'surah') setLast(x.storage, [s, a]); // AC50
    if ('mediaSession' in navigator && navigator.mediaSession) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: t(lang, 'audioMediaTitle', { name, a }), artist: reciterName(), album: t(lang, 'siteName') }); } catch { /* not supported */ }
    }
    if (x.follow && x.mode === 'surah' && document.visibilityState === 'visible') scrollTo(a);
  }

  function scrollTo(a: number) {
    const row = document.getElementById(`a${a}`);
    if (!row) return;
    const top = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
    const bar = document.querySelector('[data-player]')?.getBoundingClientRect().top ?? innerHeight;
    const r = row.getBoundingClientRect();
    // Fully on screen already: nothing to do. An ayah taller than the space is shown from its start.
    if (r.top >= top && r.bottom <= Math.min(bar, innerHeight)) return;
    if (r.height > Math.min(bar, innerHeight) - top && Math.abs(r.top - top - 8) <= 4) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: r.top - top - 8, behavior: (reduce ? 'instant' : 'smooth') as ScrollBehavior }); // AC46
  }

  function syncButtons() {
    const x = st.current;
    const on = !!audio.current && !audio.current.paused && x.mode !== 'idle';
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ap')) {
      const a = Number(b.dataset.ap);
      const active = on && x.mode === 'ayah' && x.current === a;
      b.setAttribute('aria-pressed', String(active));
      b.setAttribute('aria-label', t(lang, active ? 'audioPauseAyah' : 'audioPlayAyah', { a }));
    }
  }

  function stop(keepMark = false) {
    const x = st.current;
    const el = audio.current;
    clearTimers();
    el?.pause();
    x.mode = 'idle'; x.stopAt = -1;
    setMode('idle'); setPlaying(false);
    document.documentElement.dataset.audioFollow = '';
    if (!keepMark) mark(0);
    syncButtons();
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'paused'; } catch { /* none */ }
  }

  function fail(text: string) {
    stop(true); // AC24: the mark stays on the ayah being played
    say(text, true);
  }

  // null: could not be fetched now; []: fetched, and no reciter is offered.
  async function loadReciters(): Promise<Reciter[] | null> {
    const x = st.current;
    if (x.reciters) return x.reciters;
    const r = await post('/api/audio/reciters', { lang });
    const list = r.status === 200 && Array.isArray(r.data?.reciters) ? (r.data!.reciters as Reciter[]) : null;
    if (!list) return null;
    if (!list.length) { setDead(true); return list; }
    x.reciters = list; setReciters(list);
    // AC15 to AC18: the stored choice, or the default; a stored reciter no longer offered is said.
    const def = typeof r.data!.default === 'number' ? (r.data!.default as number) : list[0].id;
    const stored = readReciter();
    let use = stored !== null && list.some((y) => y.id === stored) ? stored : def;
    if (stored !== null && use !== stored) {
      const nm = list.find((y) => y.id === def)?.name ?? '';
      say(t(lang, 'audioReciterGone', { name: nm }), true);
      writeReciter(def);
      use = def;
    }
    x.rid = use; setRid(use);
    return list;
  }

  async function meta(r: number): Promise<Meta | 'none' | 'error'> {
    const x = st.current;
    const k = `${r}:${s}`;
    if (x.meta && x.metaKey === k) return x.meta;
    const res = await post('/api/audio', { r, s });
    if (res.status === 404 && (res.data?.status === 'not_covered' || res.data?.status === 'not_offered')) return 'none';
    const url = approvedAudioUrl(res.data?.url); // AC56, checked again in the browser
    const tm = res.data?.t;
    if (res.status !== 200 || !url || !Array.isArray(tm) || tm.length !== count) return 'error';
    x.meta = { url, duration: Number(res.data!.duration), t: tm as [number, number][] }; x.metaKey = k;
    return x.meta;
  }

  // Starts playback of one ayah or of the surah from ayah a. Called from a tap: play() is called
  // straight away so iOS allows the element to play once the address is known (AC26).
  async function start(m: 'ayah' | 'surah', a: number) {
    const el = audio.current;
    if (!el) return;
    const x = st.current;
    if (!el.src) void el.play().catch(() => undefined);
    stop(); // AC10: never two at once
    setFrom(a);
    if (!navigator.onLine) { say(t(lang, 'audioOffline'), true); return; } // AC22
    clearTimers();
    x.loadT = window.setTimeout(() => { setLoading(true); say(t(lang, 'audioLoading')); }, LOADING_MS);
    x.giveT = window.setTimeout(() => fail(t(lang, 'audioUnavailable')), GIVE_UP_MS);
    const list = await loadReciters();
    if (!list || !list.length || x.rid === null) return fail(t(lang, 'audioUnavailable'));
    const md = await meta(x.rid);
    if (md === 'none') { setDead(true); return fail(t(lang, 'audioNoSurah')); }
    if (md === 'error') return fail(t(lang, 'audioUnavailable'));
    x.mode = m; setMode(m);
    x.stopAt = m === 'ayah' ? md.t[a - 1][1] : md.t[md.t.length - 1][1];
    document.documentElement.dataset.audioFollow = m === 'surah' ? '1' : '';
    x.follow = true; setFollow(true);
    if (el.src !== md.url) { el.src = md.url; }
    // The first seek waits for the file's metadata; a later choice (next, previous) updates the target.
    x.target = md.t[a - 1][0];
    const seek = () => { try { el.currentTime = x.target / 1000; } catch { /* set when ready */ } };
    if (el.readyState >= 1 && el.src === md.url) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
    x.current = 0;
    mark(a);
    // A play() cut short by a newer choice (AbortError) is not a failure.
    try { await el.play(); } catch (e) { if ((x.mode as Mode) !== 'idle' && (e as Error)?.name !== 'AbortError') fail(t(lang, 'audioUnavailable')); }
  }

  function seekAyah(a: number) {
    const x = st.current, el = audio.current;
    if (!el || !x.meta || a < 1 || a > count) return;
    if (x.mode === 'ayah') x.stopAt = x.meta.t[a - 1][1];
    x.target = x.meta.t[a - 1][0];
    if (el.readyState >= 1) el.currentTime = x.target / 1000;
    mark(a);
    if (el.paused) void el.play().catch(() => undefined);
  }

  function pauseOrResume() {
    const el = audio.current;
    if (!el || st.current.mode === 'idle') return;
    if (el.paused) void el.play().catch(() => fail(t(lang, 'audioUnavailable'))); else el.pause();
  }

  async function chooseReciter(id: number) {
    const x = st.current;
    if (id === x.rid) return;
    if (!writeReciter(id)) say(t(lang, 'audioNotRemembered'), true); // AC16
    const was = x.mode, at = x.current || from;
    x.rid = id; setRid(id);
    x.meta = null; x.metaKey = '';
    if (was !== 'idle') await start(was, at); // AC19: restart at the current ayah
  }

  // Position updates: timeupdate (also in the background) and a frame loop while visible.
  function onTime() {
    const x = st.current, el = audio.current;
    if (!el || !x.meta || x.mode === 'idle') return;
    const ms = el.currentTime * 1000;
    if (x.stopAt >= 0 && ms >= x.stopAt) { stop(false); return; } // AC9, AC53
    const a = ayahAt(x.meta.t, ms);
    if (a) mark(a);
  }

  useEffect(() => {
    const x = st.current;
    x.storage = getStorage(window);
    const el = audio.current!;
    let raf = 0;
    const loop = () => { onTime(); raf = el.paused ? 0 : requestAnimationFrame(loop); };
    const onPlaying = () => { clearTimers(); setMsg(''); setPlaying(true); syncButtons(); if (!raf) raf = requestAnimationFrame(loop); if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'playing'; } catch { /* none */ } };
    const onPause = () => { setPlaying(false); syncButtons(); };
    const onWaiting = () => {
      if (x.mode === 'idle') return;
      clearTimeout(x.giveT);
      x.giveT = window.setTimeout(() => fail(t(lang, 'audioUnavailable')), GIVE_UP_MS); // AC24
    };
    const onError = () => { if (x.mode !== 'idle') fail(t(lang, 'audioUnavailable')); };
    const onEnded = () => stop(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('stalled', onWaiting);
    el.addEventListener('error', onError);
    el.addEventListener('ended', onEnded);

    // Per-ayah play buttons (static HTML), shown now with their space already kept.
    const list = document.querySelector('ol.ayat');
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ap')) { b.removeAttribute('data-pending'); b.removeAttribute('tabindex'); }
    const onClick = (e: Event) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button.ap');
      if (!b) return;
      const a = Number(b.dataset.ap);
      if (x.mode === 'ayah' && x.current === a && !el.paused) { el.pause(); return; }
      void start('ayah', a);
    };
    list?.addEventListener('click', onClick);

    // P-2: the reader's own scrolling pauses automatic scrolling for 5 s.
    const onUser = (e: Event) => {
      if (x.mode !== 'surah') return;
      if (e instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) return;
      x.follow = false; setFollow(false);
      clearTimeout(x.scrollT);
      x.scrollT = window.setTimeout(() => { x.follow = true; setFollow(true); if (x.current) scrollTo(x.current); }, SCROLL_PAUSE_MS);
    };
    const userEvents = ['wheel', 'touchmove', 'keydown'] as const;
    for (const ev of userEvents) window.addEventListener(ev, onUser, { passive: true });

    // AC54: after the screen was locked or the tab hidden, catch up at once.
    const onVis = () => { if (document.visibilityState === 'visible') { onTime(); if (x.follow && x.current && x.mode === 'surah') scrollTo(x.current); } };
    document.addEventListener('visibilitychange', onVis);

    // AC28: lock-screen and system controls act as the player's own controls.
    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (ms) {
      const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch { /* not supported */ } };
      set('play', () => { if (x.mode !== 'idle') void el.play().catch(() => undefined); });
      set('pause', () => el.pause());
      set('stop', () => stop(false));
      set('nexttrack', () => seekAyah(x.current + 1));
      set('previoustrack', () => seekAyah(x.current - 1));
    }
    setReady(true);
    return () => {
      el.pause();
      cancelAnimationFrame(raf);
      for (const ev of ['timeupdate', 'playing', 'pause', 'waiting', 'stalled', 'error', 'ended']) el.removeEventListener(ev, ev === 'timeupdate' ? onTime : ev === 'playing' ? onPlaying : ev === 'pause' ? onPause : ev === 'error' ? onError : ev === 'ended' ? onEnded : onWaiting);
      list?.removeEventListener('click', onClick);
      for (const ev of userEvents) window.removeEventListener(ev, onUser);
      document.removeEventListener('visibilitychange', onVis);
      clearTimers(); clearTimeout(x.scrollT);
    };
  }, []);

  const active = mode !== 'idle';
  const reciter = reciters?.find((x) => x.id === rid) ?? null;
  const nameLang = (n: string) => (/[A-Za-z]/.test(n) ? 'en' : 'ar');
  return (
    <div className="ap-player" role="region" aria-label={t(lang, 'audioPlayerLabel')} data-audio-player data-ready={ready ? '1' : '0'} data-mode={mode} data-current={current}>
      {/* AC3: no preload; the address is set only after the reader chooses play. */}
      <audio ref={audio} preload="none" data-audio />
      <div className="ap-row">
        {!active
          ? <>
              <button type="button" className="btn ap-main" data-play-surah disabled={dead} onClick={() => void start('surah', 1)}>{t(lang, 'audioPlaySurah')}</button>
              {from > 1 && <button type="button" className="btn" data-play-from disabled={dead} onClick={() => void start('surah', from)}>{t(lang, 'audioPlayFrom', { a: from })}</button>}
            </>
          : <button type="button" className="btn ap-main" data-pause aria-pressed={playing} aria-label={playing ? t(lang, 'audioPause') : t(lang, 'audioResume')} onClick={pauseOrResume}>{playing ? t(lang, 'audioPause') : t(lang, 'audioResume')}</button>}
        <button type="button" className="btn icon-btn" data-prev-ayah aria-label={t(lang, 'prevAyah')} title={t(lang, 'prevAyah')} disabled={!active || current <= 1} onClick={() => seekAyah(st.current.current - 1)}>
          <svg className="ap-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5v14M19 5l-9 7 9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="btn icon-btn" data-next-ayah aria-label={t(lang, 'nextAyah')} title={t(lang, 'nextAyah')} disabled={!active || current >= count} onClick={() => seekAyah(st.current.current + 1)}>
          <svg className="ap-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 5v14M5 5l9 7-9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        {active && mode === 'surah' && !follow && <button type="button" className="btn" data-go-current onClick={() => { st.current.follow = true; setFollow(true); clearTimeout(st.current.scrollT); if (st.current.current) scrollTo(st.current.current); }}>{t(lang, 'audioGoCurrent')}</button>}
      </div>
      <details className="ap-more" data-audio-more onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void loadReciters(); }}>
        <summary className="ap-summary">
          <span data-audio-credit><BidiText text={t(lang, 'audioCredit')} lang={lang} /></span>
          {reciter && <> <span>{t(lang, 'audioReciter')}: <bdi lang={nameLang(reciter.name)} data-reciter-name>{reciter.name}</bdi></span></>}
        </summary>
        {reciters && (
          <fieldset className="ap-reciters" data-reciters>
            <legend>{t(lang, 'audioReciter')}</legend>
            {reciters.map((r) => (
              <label key={r.id} className="ap-choice"><input type="radio" name="reciter" value={r.id} checked={r.id === rid} onChange={() => void chooseReciter(r.id)} data-reciter={r.id} /> <bdi lang={nameLang(r.name)}>{r.name}</bdi></label>
            ))}
          </fieldset>
        )}
        {reciter && (
          <dl className="ap-source" data-audio-source aria-label={t(lang, 'audioSourceDetails')}>
            <dt>{t(lang, 'audioReciter')}</dt><dd><bdi lang={nameLang(reciter.name)}>{reciter.name}</bdi></dd>
            <dt>{t(lang, 'audioStyle')}</dt><dd>{reciter.style ?? t(lang, 'notStated')}</dd>
            <dt>{t(lang, 'audioRiwayah')}</dt><dd>{reciter.qirat ?? t(lang, 'notStated')}</dd>
            <dt><BidiText text={t(lang, 'audioReciterId')} lang={lang} /></dt><dd>{reciter.id}</dd>
            <dt>{t(lang, 'source')}</dt><dd><bdi lang="en" dir="ltr">Quran Foundation</bdi></dd>
            <dt>{t(lang, 'audioLicenceL')}</dt><dd><BidiText text={t(lang, 'audioLicence')} lang={lang} /></dd>
          </dl>
        )}
      </details>
      <p className={alert ? 'msg alert ap-status' : 'msg ap-status'} role="status" aria-live="polite" data-audio-status data-loading={loading ? '1' : '0'}>{msg}</p>
      <p className="sr-only" aria-live="polite" data-audio-now>{now}</p>
    </div>
  );
}
