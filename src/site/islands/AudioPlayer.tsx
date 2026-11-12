// RQ-006 v1.1 "Listen to the Quran" player, on reader pages only (D-113 A).
//
// One surah file per reciter with per-ayah timings (D-110 B). The browser plays the file directly
// from the approved audio host (D-112 B, AC39 media-src); RIFQ's Worker gives only the address and
// the timings (/api/audio). The audio element never preloads and nothing plays on its own.
//
// QA RISK-2 (kit v24): iOS allows play() only inside the tap, and only if the element has its
// address by then. So the reciter list and this surah's address and timings (metadata only, no
// sound) are fetched at the reader's first interaction with the page (touch, pointer, key or
// wheel), before play is tapped; the tap then sets the address and calls play() synchronously.
// This moves AC3's "nothing before play" to "nothing before the first interaction": a deviation
// for Hamzeh to approve. If the tap still comes first, the player fetches, tries play(), and on
// NotAllowedError asks for one tap on Resume; play() is never called on an element with no address.
//
// The per-ayah play buttons are in the static HTML (Reader.astro), hidden with their space kept
// until this island loads, so without JavaScript no broken control shows (AC48).
//
// Marking (AC6): the row whose timing covers the playback position gets the "current" mark, on the
// row only, never inside the Quran text (AC11). A single ayah stops at its end time (AC53); a surah
// plays to the end of its last ayah and stops (AC9, P-3). During surah playback the playing ayah is
// saved as the last reading position (AC50, D-117 A).
//
// iPhone (AC26 to AC29, D-115 B): see RISK-2 above. Lock screen and system controls use the Media Session API. Whether sound continues with the
// screen locked can only be measured on the reference phone.
import { useEffect, useRef, useState } from 'react';
import { approvedAudioUrl, AUDIO_HOST, ayahAt } from '../../core/audio.ts';
import { getStorage, setLast } from '../../core/store.ts';
import { t, type Lang } from '../../core/strings.ts';
import { readReciter, writeReciter } from './Settings.tsx';
import BidiText from './BidiText.tsx';

type Reciter = { id: number; name: string; style: string | null; qirat: string | null };
type Meta = { url: string; duration: number; t: [number, number][] };
type Mode = 'idle' | 'ayah' | 'surah';
type Props = { lang: Lang; s: number; count: number; name: string; dev?: boolean };

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

export default function AudioPlayer({ lang, s, count, name, dev = false }: Props) {
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
  // QA FIND-8: why play is disabled ('' when it is not), said next to the disabled button.
  const [dead, setDead] = useState<'' | 'reciters-empty' | 'surah-not-covered'>('');
  const [now, setNow] = useState('');
  // Why the last attempt stopped, for diagnosis only (data-reason on the status line; never shown).
  const [reason, setReason] = useState('');
  // Mutable state read by event handlers.
  const st = useRef({ mode: 'idle' as Mode, meta: null as Meta | null, metaKey: '', current: 0, stopAt: -1, follow: true, lastUser: 0, reciters: null as Reciter[] | null, rid: null as number | null, target: 0, srcSet: '', seekPending: false, storage: null as ReturnType<typeof getStorage>, loadT: 0, giveT: 0, scrollT: 0 });
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
    // An 8 px margin above, less when the ayah only just fits, so its end stays above the player.
    const margin = Math.min(8, Math.max(0, Math.min(bar, innerHeight) - top - r.height));
    window.scrollBy({ top: r.top - top - margin, behavior: (reduce ? 'instant' : 'smooth') as ScrollBehavior }); // AC46
  }

  function syncButtons() {
    const x = st.current;
    const on = !!audio.current && !audio.current.paused && x.mode !== 'idle';
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ap')) {
      const a = Number(b.dataset.ap);
      const active = on && x.mode === 'ayah' && x.current === a;
      b.dataset.state = active ? 'playing' : 'idle'; // QA FIND-5: no aria-pressed; the name changes
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

  // Development builds only: the reason code is added to the message and written to the console,
  // so a tester can say which path failed. It holds no address, ID or secret.
  function why(code: string) {
    setReason(code);
    if (dev && code) console.warn('[RIFQ audio]', code);
  }
  const coded = (text: string, code: string) => (dev && code ? `${text} [${code}]` : text);
  function fail(text: string, code: string) {
    stop(true); // AC24: the mark stays on the ayah being played
    why(code);
    say(coded(text, code), true);
  }

  // null: could not be fetched now (the reason is kept); []: fetched, and no reciter is offered.
  const recFail = useRef('');
  const recJob = useRef<Promise<Reciter[] | null> | null>(null);
  // One request at a time: the warm-up and a tap share the same request.
  function loadReciters(): Promise<Reciter[] | null> {
    if (st.current.reciters) return Promise.resolve(st.current.reciters);
    if (!recJob.current) recJob.current = fetchReciters().finally(() => { recJob.current = null; });
    return recJob.current;
  }
  async function fetchReciters(): Promise<Reciter[] | null> {
    const x = st.current;
    const r = await post('/api/audio/reciters', { lang });
    const list = r.status === 200 && Array.isArray(r.data?.reciters) ? (r.data!.reciters as Reciter[]) : null;
    if (!list) { recFail.current = `reciters-${r.status}-${String(r.data?.status ?? 'none')}`; return null; }
    if (!list.length) { setDead('reciters-empty'); why('reciters-empty'); return list; }
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

  const metaFail = useRef('');
  const metaJob = useRef<{ k: string; p: Promise<MetaResult> } | null>(null);
  type MetaResult = Meta | 'not_covered' | 'not_offered' | 'error';
  function meta(r: number): Promise<MetaResult> {
    const x = st.current;
    const k = `${r}:${s}`;
    if (x.meta && x.metaKey === k) return Promise.resolve(x.meta);
    if (metaJob.current?.k === k) return metaJob.current.p;
    const p = fetchMeta(r, k).finally(() => { if (metaJob.current?.k === k) metaJob.current = null; });
    metaJob.current = { k, p };
    return p;
  }
  async function fetchMeta(r: number, k: string): Promise<MetaResult> {
    const x = st.current;
    const res = await post('/api/audio', { r, s });
    if (res.status === 404 && (res.data?.status === 'not_covered' || res.data?.status === 'not_offered')) return res.data.status as 'not_covered' | 'not_offered';
    const url = approvedAudioUrl(res.data?.url); // AC56, checked again in the browser
    const tm = res.data?.t;
    metaFail.current = res.status !== 200 ? `meta-${res.status}-${String(res.data?.status ?? 'none')}` : !url ? 'meta-address' : !Array.isArray(tm) || tm.length !== count ? 'meta-timings' : '';
    if (metaFail.current) return 'error';
    const m: Meta = { url: url as string, duration: Number(res.data!.duration), t: tm as [number, number][] };
    // A slower answer for a reciter no longer chosen is not kept as the current one.
    if (x.rid === r) { x.meta = m; x.metaKey = k; }
    return m;
  }

  // QA RISK-2: metadata only (no sound), at the first interaction and after a reciter change, so
  // the tap on play can run synchronously. Failures here are silent; the tap reports them.
  function warm() {
    void (async () => {
      const list = await loadReciters();
      const r = st.current.rid;
      if (list?.length && r !== null && (await meta(r)) === 'not_covered') { setDead('surah-not-covered'); why('surah-not-covered'); }
    })();
  }

  // Starts playback of one ayah or of the surah from ayah a, from a tap.
  // iOS (AC26): play() must run inside the tap. When the reciter and this surah's address are
  // already known (fetched at the first interaction, RISK-2), begin() runs synchronously in the tap.
  // Otherwise they are fetched now; if iOS then refuses play(), the player asks for one tap on Resume.
  // play() is never called on an element with no address (QA RISK-2).
  function start(m: 'ayah' | 'surah', a: number, gone: number | null = null) {
    const el = audio.current;
    if (!el) return;
    const x = st.current;
    stop(); // AC10: never two at once
    setFrom(a); setReason('');
    if (!navigator.onLine) { setReason('offline'); say(t(lang, 'audioOffline'), true); return; } // AC22
    clearTimers();
    x.loadT = window.setTimeout(() => { setLoading(true); say(t(lang, 'audioLoading')); }, LOADING_MS);
    x.giveT = window.setTimeout(() => fail(t(lang, 'audioUnavailable'), 'timeout-loading'), GIVE_UP_MS);
    if (x.reciters?.length && x.rid !== null && x.meta && x.metaKey === `${x.rid}:${s}`) { begin(m, a, x.meta); return; }
    void (async () => {
      const list = await loadReciters();
      if (!list) return fail(t(lang, 'audioUnavailable'), recFail.current);
      // An empty offered list is not an outage: say so plainly.
      if (!list.length || x.rid === null) return fail(t(lang, 'audioNoReciter'), 'reciters-empty');
      // FIND-9: after a refused reciter the list moved to another one; say which (AC18 wording).
      if (gone !== null && x.rid !== gone) say(t(lang, 'audioReciterGone', { name: reciterName() }), true);
      const md = await meta(x.rid);
      if (md === 'not_covered') { setDead('surah-not-covered'); return fail(t(lang, 'audioNoSurah'), 'surah-not-covered'); }
      // QA FIND-9: the chosen reciter is no longer offered. Fetch the list again (which says so,
      // AC18, and moves to the default) and try once more; a second refusal is reported.
      if (md === 'not_offered') {
        if (gone !== null) return fail(t(lang, 'audioUnavailable'), 'meta-not-offered-again');
        const was = x.rid;
        x.reciters = null; setReciters(null); x.meta = null; x.metaKey = '';
        return start(m, a, was);
      }
      if (md === 'error') return fail(t(lang, 'audioUnavailable'), metaFail.current);
      begin(m, a, md);
    })();
  }

  // Sets the file and the position, marks the ayah and calls play(). Synchronous up to play().
  function begin(m: 'ayah' | 'surah', a: number, md: Meta) {
    const el = audio.current!;
    const x = st.current;
    x.mode = m; setMode(m);
    x.stopAt = m === 'ayah' ? md.t[a - 1][1] : md.t[md.t.length - 1][1];
    document.documentElement.dataset.audioFollow = m === 'surah' ? '1' : '';
    x.follow = true; setFollow(true);
    // Compared with the address set last, not el.src, which the browser may rewrite (normalized).
    const fresh = x.srcSet !== md.url;
    if (fresh) { el.src = md.url; x.srcSet = md.url; }
    // The first seek waits for the file's metadata; a later choice (next, previous) updates the target.
    x.target = md.t[a - 1][0];
    // Until that first seek is done the position is the file's start, which is not the ayah asked
    // for: no mark or last position is taken from it.
    const seek = () => { x.seekPending = false; try { el.currentTime = x.target / 1000; } catch { /* set when ready */ } };
    if (!fresh && el.readyState >= 1) seek(); else { x.seekPending = true; el.addEventListener('loadedmetadata', seek, { once: true }); }
    x.current = 0;
    mark(a);
    // A play() cut short by a newer choice (AbortError) is not a failure.
    el.play().catch((e) => {
      const name = (e as Error)?.name ?? 'Error';
      if ((x.mode as Mode) === 'idle' || name === 'AbortError') return;
      if (name === 'NotAllowedError') { clearTimers(); setPlaying(false); why('play-NotAllowedError'); say(coded(t(lang, 'audioTapToPlay'), 'play-NotAllowedError'), true); return; }
      fail(t(lang, 'audioUnavailable'), `play-${name}`);
    });
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
    if (el.paused) { setMsg(''); void el.play().catch((e) => fail(t(lang, 'audioUnavailable'), `resume-${(e as Error)?.name ?? 'Error'}`)); } else el.pause();
  }

  async function chooseReciter(id: number) {
    const x = st.current;
    if (id === x.rid) return;
    if (!writeReciter(id)) say(t(lang, 'audioNotRemembered'), true); // AC16
    const was = x.mode, at = x.current || from;
    x.rid = id; setRid(id);
    x.meta = null; x.metaKey = '';
    if (was !== 'idle') start(was, at); // AC19: restart at the current ayah
    else warm(); // RISK-2: the next tap on play stays synchronous
  }

  // Position updates: timeupdate (also in the background) and a frame loop while visible.
  function onTime() {
    const x = st.current, el = audio.current;
    if (!el || !x.meta || x.mode === 'idle' || x.seekPending) return;
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
    // Only the loading message goes when sound starts; a notice such as AC18's stays readable.
    const onPlaying = () => { clearTimers(); setMsg((m) => (m === t(lang, 'audioLoading') || m === coded(t(lang, 'audioTapToPlay'), 'play-NotAllowedError') ? '' : m)); setPlaying(true); syncButtons(); if (!raf) raf = requestAnimationFrame(loop); if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'playing'; } catch { /* none */ } };
    const onPause = () => { setPlaying(false); syncButtons(); };
    const onWaiting = () => {
      if (x.mode === 'idle') return;
      clearTimeout(x.giveT);
      x.giveT = window.setTimeout(() => fail(t(lang, 'audioUnavailable'), 'timeout-stalled'), GIVE_UP_MS); // AC24
    };
    // Only an error of the file now set counts; the empty element used to prime iOS on the first tap,
    // or a file being replaced, is not a failure of the recitation.
    const onError = () => { if (x.mode !== 'idle' && x.srcSet && el.currentSrc && el.error) fail(t(lang, 'audioUnavailable'), `file-error-${el.error.code}`); };
    // A policy that blocks the audio host (for example after a redirect to another host) shows here.
    const onCsp = (e: SecurityPolicyViolationEvent) => {
      if (!/^media-src/.test(e.effectiveDirective || e.violatedDirective) || x.mode === 'idle') return;
      let host = 'unknown';
      try { host = new URL(e.blockedURI).host || e.blockedURI.slice(0, 20); } catch { /* not a URL */ }
      // The browser reports the address first asked for. If that is the approved host, the block was
      // on where it redirected to.
      fail(t(lang, 'audioUnavailable'), host === AUDIO_HOST ? 'csp-media-redirect' : `csp-media-${host}`);
    };
    document.addEventListener('securitypolicyviolation', onCsp);
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
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ap, button.apf')) { b.removeAttribute('data-pending'); b.removeAttribute('tabindex'); }
    const onClick = (e: Event) => {
      // P-1 (D-121): "play from here" beside each ayah plays the surah from that ayah.
      const f = (e.target as Element).closest<HTMLButtonElement>('button.apf');
      if (f) { start('surah', Number(f.dataset.apf)); return; }
      const b = (e.target as Element).closest<HTMLButtonElement>('button.ap');
      if (!b) return;
      const a = Number(b.dataset.ap);
      if (x.mode === 'ayah' && x.current === a && !el.paused) { el.pause(); return; }
      start('ayah', a);
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

    // RISK-2: the first interaction with the page fetches the reciter list and this surah's
    // metadata (no sound), so a later tap on play can set the address and play() inside the tap.
    const firstEvents = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const;
    const onFirst = () => { for (const ev of firstEvents) window.removeEventListener(ev, onFirst, true); warm(); };
    for (const ev of firstEvents) window.addEventListener(ev, onFirst, { capture: true, passive: true });

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
      for (const ev of firstEvents) window.removeEventListener(ev, onFirst, true);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('securitypolicyviolation', onCsp);
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
              <button type="button" className="btn ap-main" data-play-surah disabled={!!dead} aria-describedby={dead ? 'ap-dead' : undefined} onClick={() => start('surah', 1)}>{t(lang, 'audioPlaySurah')}</button>
            </>
          : <button type="button" className="btn ap-main" data-pause onClick={pauseOrResume}>{playing ? t(lang, 'audioPause') : t(lang, 'audioResume')}</button>}
        <button type="button" className="btn icon-btn" data-prev-ayah aria-label={t(lang, 'prevAyah')} title={t(lang, 'prevAyah')} disabled={!active || current <= 1} onClick={() => seekAyah(st.current.current - 1)}>
          <svg className="ap-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5v14M19 5l-9 7 9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="btn icon-btn" data-next-ayah aria-label={t(lang, 'nextAyah')} title={t(lang, 'nextAyah')} disabled={!active || current >= count} onClick={() => seekAyah(st.current.current + 1)}>
          <svg className="ap-dir" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 5v14M5 5l9 7-9 7z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        {active && mode === 'surah' && !follow && <button type="button" className="btn" data-go-current onClick={() => { st.current.follow = true; setFollow(true); clearTimeout(st.current.scrollT); if (st.current.current) scrollTo(st.current.current); }}>{t(lang, 'audioGoCurrent')}</button>}
      </div>
      {/* QA FIND-8: a disabled play button says why, next to it and as its description. */}
      {dead && <p className="msg ap-dead" id="ap-dead" data-audio-dead={dead}>{coded(t(lang, dead === 'reciters-empty' ? 'audioNoReciter' : 'audioNoSurah'), dead)}</p>}
      {/* QA FIND-1: the credit is its own visible line (AC38); the disclosure is labelled and marked. */}
      <p className="ap-credit" data-audio-credit><BidiText text={t(lang, 'audioCredit')} lang={lang} /></p>
      <details className="ap-more" data-audio-more onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) warm(); }}>
        <summary className="ap-summary" aria-label={t(lang, 'audioMoreLabel')} data-audio-summary>
          <span>{t(lang, 'audioMoreLabel')}</span>
          {reciter && <span className="ap-summary-now"><bdi lang={nameLang(reciter.name)} data-reciter-name>{reciter.name}</bdi></span>}
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
            {/* QA FIND-4: Latin text inside the Arabic page is isolated. */}
            <dt>{t(lang, 'audioStyle')}</dt><dd>{reciter.style ? <bdi lang={nameLang(reciter.style)}>{reciter.style}</bdi> : t(lang, 'notStated')}</dd>
            <dt>{t(lang, 'audioRiwayah')}</dt><dd>{reciter.qirat ? <bdi lang={nameLang(reciter.qirat)}>{reciter.qirat}</bdi> : t(lang, 'notStated')}</dd>
            <dt><BidiText text={t(lang, 'audioReciterId')} lang={lang} /></dt><dd>{reciter.id}</dd>
            <dt>{t(lang, 'source')}</dt><dd><bdi lang="en" dir="ltr">Quran Foundation</bdi></dd>
            <dt>{t(lang, 'audioLicenceL')}</dt><dd><BidiText text={t(lang, 'audioLicence')} lang={lang} /></dd>
          </dl>
        )}
      </details>
      <p className={alert ? 'msg alert ap-status' : 'msg ap-status'} role="status" aria-live="polite" data-audio-status data-loading={loading ? '1' : '0'} data-reason={reason}>{msg}</p>
      <p className="sr-only" aria-live="polite" data-audio-now>{now}</p>
    </div>
  );
}
