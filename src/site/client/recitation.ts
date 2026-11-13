// RQ-006 v1.3 recitation engine: one per tab, shared by the reader page player and the mini-player.
//
// Why a module and not an island (D-126 1A, AC62): pages now change in place (Astro's client
// router, see nav.ts), and every island of the old page is unmounted on each change. The recitation
// must outlive them, so its state, its timers and its listeners live here, in a module that is
// loaded once per tab and stays loaded across in-place changes. The one <audio> element is in the
// layout with transition:persist, so the router carries the same live element into every page
// (Astro never re-creates a persisted media element), and the Media Session handlers set here stay
// bound to it (AC28). Islands only read the state (subscribe) and call the actions below.
//
// Nothing here is stored or sent for continuity (A7): the playing surah, ayah, reciter and position
// are in this tab's memory only, and a full page load ends them (AC66).
//
// One surah file per reciter with per-ayah timings (D-110 B). The browser plays the file directly
// from the approved audio host (D-112 B, AC39 media-src); RIFQ's Worker gives only the address and
// the timings (/api/audio). Nothing is requested before the reader chooses play or opens the
// reciter list (AC3); the audio element never preloads; nothing plays on its own.
//
// iPhone (AC26 to AC29, D-115 B): iOS lets an element play only from inside a tap. The first tap
// calls play() at once on the element, before the address is fetched, which unlocks it (kit v24 and
// v25 worked this way on Hamzeh's iPhone). Lock screen: previous and next ayah, no 10-second skips
// (confirmed on kit v25); the handlers are set once here and again whenever sound starts, so page
// changes never drop them.
import { approvedAudioUrl, AUDIO_HOST, ayahAt, stallWatch } from '../../core/audio.ts';
import { getStorage, setLast } from '../../core/store.ts';
import { t, type Key, type Lang } from '../../core/strings.ts';
import { readReciter, writeReciter } from '../islands/Settings.tsx';
import { revealRow } from './reveal.ts';

export type Reciter = { id: number; name: string; style: string | null; qirat: string | null };
type Meta = { url: string; duration: number; t: [number, number][] };
export type Mode = 'idle' | 'ayah' | 'surah';
// none: nothing loaded (no mini-player). active: loading, playing or paused. ended / failed: the
// mini-player shows the ended or not-available state until the next page change or close (D-128).
export type Phase = 'none' | 'active' | 'ended' | 'failed';
export type DeadKind = 'reciters-empty' | 'surah-not-covered';
export type Msg = { key: Key; vars: Record<string, string | number>; code: string; alert: boolean; seq: number; at: number };
export type Names = { ar: string; en: string };
export type Snap = {
  phase: Phase; mode: Mode; s: number; count: number; names: Names; current: number; playing: boolean;
  loading: boolean; follow: boolean; rid: number | null; lists: Partial<Record<Lang, Reciter[]>>;
  dead: { s: number; kind: DeadKind } | null; msg: Msg | null; reason: string; nowSeq: number; ready: boolean;
  // The last ayah marked: where "go to the playing ayah" leads, also after an end or a failure (AC75).
  last: number;
  // The reader page on screen (0 elsewhere), refreshed on every in-place page change.
  page: number;
  // The interface language of the page on screen (the persisted mini-player reads it, AC74).
  lang: Lang;
};

export const LOADING_MS = 1000; // AC20: loading state after 1 s
export const GIVE_UP_MS = 15000; // P-5: give up after 15 s
export const SCROLL_PAUSE_MS = 5000; // P-2
const CHANNEL = 'rifq-recitation';

const IDLE: Snap = { phase: 'none', mode: 'idle', s: 0, count: 0, names: { ar: '', en: '' }, current: 0, playing: false, loading: false, follow: true, rid: null, lists: {}, dead: null, msg: null, reason: '', nowSeq: 0, ready: false, last: 0, page: 0, lang: 'ar' };

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' });
    let data: Record<string, unknown> | null = null;
    try { data = await r.json(); } catch { data = null; }
    return { status: r.status, data };
  } catch { return { status: 0, data: null }; }
}

// The interface language and the reader page on screen (0 when the page is not a reader page).
export const pageLang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'ar');
export const pageSurah = (): number => Number(document.querySelector<HTMLElement>('ol.ayat')?.dataset.surah ?? 0) || 0;

type MetaResult = Meta | 'not_covered' | 'not_offered' | 'error';

function create(el: HTMLAudioElement, dev: boolean) {
  let snap: Snap = { ...IDLE, ready: true, page: pageSurah(), lang: pageLang() };
  const subs = new Set<() => void>();
  // Mutable working state (read by event handlers).
  const x = {
    mode: 'idle' as Mode, s: 0, count: 0, names: { ar: '', en: '' } as Names, current: 0, stopAt: -1, follow: true,
    meta: null as Meta | null, metaKey: '', rid: null as number | null, ridOutage: false,
    lists: {} as Partial<Record<Lang, Reciter[]>>, target: 0, srcSet: '', seekPending: false, begun: false,
    storage: getStorage(window), loadT: 0, giveT: 0, scrollT: 0, job: 0, raf: 0,
  };
  const set = (p: Partial<Snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };
  let seq = 0;
  // Messages are kept as keys, so they show in the language of the page on screen (AC74). `at` is
  // the reader page the message belongs to: the full player shows it only there.
  const say = (key: Key, alert = false, code = '', vars: Record<string, string | number> = {}, at = x.s) => set({ msg: { key, vars, code: dev ? code : '', alert, seq: ++seq, at } });
  const why = (code: string) => { set({ reason: code }); if (dev && code) console.warn('[RIFQ audio]', code); };
  const own = () => x.s > 0 && pageSurah() === x.s;
  const reciterName = (lang: Lang = pageLang()) => (x.lists[lang] ?? x.lists.ar ?? x.lists.en)?.find((r) => r.id === x.rid)?.name ?? '';

  // ----- the page on screen: marks, per-ayah buttons, D-062 hand-over (AC6, AC43, AC50, AC65) -----
  function paint() {
    const mine = own();
    const on = !el.paused && x.mode !== 'idle';
    for (const r of document.querySelectorAll<HTMLElement>('li.ayah-row')) r.classList.toggle('ap-current', mine && Number(r.dataset.a) === x.current && x.current > 0);
    const lang = pageLang();
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.ap')) {
      const a = Number(b.dataset.ap);
      // QA v25 FIND-E: the playing ayah's control shows pause in surah playback too (TOG-1).
      const active = mine && on && x.current === a;
      b.dataset.state = active ? 'playing' : 'idle';
      b.setAttribute('aria-label', t(lang, active ? 'audioPauseAyah' : 'audioPlayAyah', { a }));
    }
    // ReaderTools (D-062) stands down only on the playing surah's own page (D-127 A, AC50).
    document.documentElement.dataset.audioFollow = mine && x.mode === 'surah' ? '1' : '';
  }

  function mark(a: number) {
    if (a === x.current) return;
    x.current = a;
    set({ current: a });
    paint();
    if (!a) return;
    set({ last: a });
    const mine = own();
    if (mine) set({ nowSeq: snap.nowSeq + 1 }); // AC44: announced on the playing surah's page only
    if (x.mode === 'surah' && mine) setLast(x.storage, [x.s, a]); // AC50, D-127 A
    media(a);
    if (x.follow && x.mode === 'surah' && mine && document.visibilityState === 'visible') scrollToAyah(a);
  }

  function scrollToAyah(a: number) {
    const row = document.getElementById(`a${a}`);
    if (row && own()) revealRow(row, true);
  }

  // AC28: the lock-screen title is the playing surah's name and ayah, in the interface language of
  // the page on screen, with the reciter; never the surah of the page on screen (D-126 3A).
  function media(a: number, force = false) {
    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (!ms || !a || x.mode === 'idle') return;
    const lang = pageLang();
    const title = t(lang, 'audioMediaTitle', { name: x.names[lang], a }), artist = reciterName(lang);
    const cur = ms.metadata;
    if (!force && cur && cur.title === title && cur.artist === artist) return;
    try { ms.metadata = new MediaMetadata({ title, artist, album: t(lang, 'siteName') }); } catch { return; }
    try {
      if (Number.isFinite(el.duration) && el.duration > 0) ms.setPositionState({ duration: el.duration, position: Math.min(Math.max(el.currentTime, 0), el.duration), playbackRate: el.playbackRate || 1 });
    } catch { /* not supported */ }
    try { ms.playbackState = el.paused ? 'paused' : 'playing'; } catch { /* none */ }
  }
  function clearMedia() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch { /* none */ }
  }

  function clearTimers() { clearTimeout(x.loadT); clearTimeout(x.giveT); set({ loading: false }); }

  function stop(keepMark = false) {
    clearTimers();
    stall.stop();
    el.pause();
    x.mode = 'idle'; x.stopAt = -1;
    set({ mode: 'idle', playing: false });
    if (!keepMark) mark(0);
    paint();
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'paused'; } catch { /* none */ }
  }

  // The end of a single ayah or of the surah (AC9, AC53): stopped, mark removed; the mini-player
  // shows the ended state until the next page change or close (AC75, D-128).
  function ended() {
    stop(false);
    if (x.begun) set({ phase: 'ended' });
    clearMedia();
  }

  function fail(key: Key, code: string) {
    const was = x.begun;
    stop(true); // AC24: the mark stays on the ayah being played
    why(code);
    set({ phase: was ? 'failed' : 'none' });
    say(key, true, code);
  }
  // A surah without audio, or no reciter at all: the disabled play button says why, once (QA FIND-C).
  function dead(kind: DeadKind) {
    stop(true);
    why(kind);
    set({ phase: x.begun ? 'failed' : 'none', dead: { s: x.s, kind }, msg: null });
  }

  // ----- reciters (AC14 to AC18) -----
  const recJob: Partial<Record<Lang, Promise<Reciter[] | null>>> = {};
  let recFail = '';
  function loadReciters(lang: Lang = pageLang()): Promise<Reciter[] | null> {
    if (x.lists[lang] && x.rid !== null && !x.ridOutage) return Promise.resolve(x.lists[lang]!);
    if (!recJob[lang]) recJob[lang] = fetchReciters(lang).finally(() => { delete recJob[lang]; });
    return recJob[lang]!;
  }
  async function fetchReciters(lang: Lang): Promise<Reciter[] | null> {
    const r = await post('/api/audio/reciters', { lang });
    const list = r.status === 200 && Array.isArray(r.data?.reciters) ? (r.data!.reciters as Reciter[]) : null;
    if (!list) { recFail = `reciters-${r.status}-${String(r.data?.status ?? 'none')}`; return null; }
    if (!list.length) { set({ dead: { s: 0, kind: 'reciters-empty' } }); why('reciters-empty'); return list; }
    x.lists = { ...x.lists, [lang]: list };
    set({ lists: x.lists });
    if (x.rid !== null && !x.ridOutage) return list; // already chosen in this tab
    // AC15 to AC18: the stored choice, or the default; a stored reciter no longer offered is said.
    const def = typeof r.data!.default === 'number' ? (r.data!.default as number) : list[0].id;
    const out = Array.isArray(r.data!.unavailable) ? (r.data!.unavailable as unknown[]).filter((v): v is number => Number.isInteger(v)) : [];
    const stored = readReciter();
    x.ridOutage = false;
    let use = stored !== null && list.some((y) => y.id === stored) ? stored : def;
    if (stored !== null && use !== stored) {
      if (out.includes(stored)) {
        // QA v25 FIND-B: the stored reciter could not be checked just now (an outage, not a refusal).
        // Its choice is kept on the device, and nothing else is played instead (AC23).
        use = stored; x.ridOutage = true;
      } else {
        say('audioReciterGone', true, '', { name: list.find((y) => y.id === def)?.name ?? '' });
        writeReciter(def);
        use = def;
      }
    }
    x.rid = use;
    set({ rid: use });
    return list;
  }

  let metaJob: { k: string; p: Promise<MetaResult> } | null = null;
  let metaFail = '';
  function meta(r: number): Promise<MetaResult> {
    const k = `${r}:${x.s}`;
    if (x.meta && x.metaKey === k) return Promise.resolve(x.meta);
    if (metaJob?.k === k) return metaJob.p;
    const p = fetchMeta(r, x.s, x.count, k).finally(() => { if (metaJob?.k === k) metaJob = null; });
    metaJob = { k, p };
    return p;
  }
  async function fetchMeta(r: number, s: number, count: number, k: string): Promise<MetaResult> {
    const res = await post('/api/audio', { r, s });
    if (res.status === 404 && (res.data?.status === 'not_covered' || res.data?.status === 'not_offered')) return res.data.status as 'not_covered' | 'not_offered';
    const url = approvedAudioUrl(res.data?.url); // AC56, checked again in the browser
    const tm = res.data?.t;
    metaFail = res.status !== 200 ? `meta-${res.status}-${String(res.data?.status ?? 'none')}` : !url ? 'meta-address' : !Array.isArray(tm) || tm.length !== count ? 'meta-timings' : '';
    if (metaFail) return 'error';
    const m: Meta = { url: url as string, duration: Number(res.data!.duration), t: tm as [number, number][] };
    // A slower answer for a reciter or surah no longer chosen is not kept as the current one.
    if (x.rid === r && x.s === s) { x.meta = m; x.metaKey = k; }
    return m;
  }

  // ----- actions -----
  // Starts one ayah or the surah from ayah a of surah s, from a tap on a reader page. Stops whatever
  // played before (AC10), on this or any page. Synchronous up to play() when everything is known.
  function start(m: 'ayah' | 'surah', s: number, a: number, info: { count: number; names: Names }, gone: number | null = null) {
    if (!x.srcSet) void el.play().catch(() => undefined); // iOS: unlock inside the first tap
    stop();
    const job = ++x.job;
    if (x.s !== s) { x.meta = null; x.metaKey = ''; }
    x.s = s; x.count = info.count; x.names = info.names; x.begun = false;
    set({ s, count: info.count, names: info.names, phase: 'active', reason: '', msg: null, current: 0, last: a });
    if (!navigator.onLine) { why('offline'); set({ phase: 'none' }); say('audioOffline', true); return; } // AC22
    clearTimers();
    x.loadT = window.setTimeout(() => { set({ loading: true }); say('audioLoading'); }, LOADING_MS);
    x.giveT = window.setTimeout(() => fail('audioUnavailable', 'timeout-loading'), GIVE_UP_MS);
    const lang = pageLang();
    if (x.lists[lang]?.length && x.rid !== null && !x.ridOutage && x.meta && x.metaKey === `${x.rid}:${s}`) { begin(m, a, x.meta); return; }
    void (async () => {
      const list = await loadReciters(lang);
      if (job !== x.job) return;
      if (!list) return fail('audioUnavailable', recFail);
      if (!list.length || x.rid === null) { clearTimers(); return dead('reciters-empty'); }
      if (x.ridOutage) return fail('audioUnavailable', 'reciter-outage'); // FIND-B
      // FIND-9: after a refused reciter the list moved to another one; say which (AC18 wording).
      if (gone !== null && x.rid !== gone) say('audioReciterGone', true, '', { name: reciterName(lang) });
      const md = await meta(x.rid);
      if (job !== x.job) return;
      if (md === 'not_covered') { clearTimers(); return dead('surah-not-covered'); }
      // FIND-9: the chosen reciter is no longer offered. Fetch the list again (which says so, AC18,
      // and moves to the default) and try once more; a second refusal is reported.
      if (md === 'not_offered') {
        if (gone !== null) return fail('audioUnavailable', 'meta-not-offered-again');
        const was = x.rid;
        x.lists = {}; x.rid = null; x.meta = null; x.metaKey = '';
        set({ lists: {}, rid: null });
        return start(m, s, a, info, was);
      }
      if (md === 'error') return fail('audioUnavailable', metaFail);
      begin(m, a, md);
    })();
  }

  function begin(m: 'ayah' | 'surah', a: number, md: Meta) {
    x.mode = m; x.begun = true;
    x.stopAt = m === 'ayah' ? md.t[a - 1][1] : md.t[md.t.length - 1][1];
    x.follow = true;
    set({ mode: m, follow: true, phase: 'active', dead: snap.dead?.kind === 'surah-not-covered' && snap.dead.s === x.s ? null : snap.dead });
    // Compared with the address set last, not el.src, which the browser may rewrite (normalized).
    const fresh = x.srcSet !== md.url;
    if (fresh) { el.src = md.url; x.srcSet = md.url; }
    // The first seek waits for the file's metadata; a later choice (next, previous) updates the target.
    // The target is the ayah's own start, which need not be 0 for ayah 1 (recorded pre-live data:
    // reciter 97, surah 2 starts at 3151 ms); nothing before it is marked (AC13).
    x.target = md.t[a - 1][0];
    const seek = () => { x.seekPending = false; try { el.currentTime = x.target / 1000; } catch { /* set when ready */ } };
    if (!fresh && el.readyState >= 1) seek(); else { x.seekPending = true; el.addEventListener('loadedmetadata', seek, { once: true }); }
    x.current = 0;
    mark(a);
    el.play().catch((e) => {
      const name = (e as Error)?.name ?? 'Error';
      if ((x.mode as Mode) === 'idle' || name === 'AbortError') return;
      if (name === 'NotAllowedError') { clearTimers(); set({ playing: false }); why('play-NotAllowedError'); say('audioTapToPlay', true, 'play-NotAllowedError'); return; }
      fail('audioUnavailable', `play-${name}`);
    });
  }

  function seekAyah(a: number) {
    // Only while an ayah or the surah is playing or paused: after a stop (or from the lock screen
    // when nothing is playing) next and previous do nothing, so no sound starts without a mark.
    if (!x.meta || x.mode === 'idle' || a < 1 || a > x.count) return;
    if (x.mode === 'ayah') x.stopAt = x.meta.t[a - 1][1];
    x.target = x.meta.t[a - 1][0];
    if (el.readyState >= 1) el.currentTime = x.target / 1000;
    mark(a);
    if (el.paused) void el.play().catch(() => undefined);
  }

  function pauseOrResume() {
    if (x.mode === 'idle') return;
    if (el.paused) { set({ msg: null }); void el.play().catch((e) => fail('audioUnavailable', `resume-${(e as Error)?.name ?? 'Error'}`)); } else el.pause();
  }

  // AC19, A5: from any reader page; restarts the playing recitation at its current ayah.
  function chooseReciter(id: number) {
    if (id === x.rid && !x.ridOutage) return;
    const at = x.s;
    if (!writeReciter(id)) say('audioNotRemembered', true, '', {}, pageSurah() || x.s); // AC16, said where it was chosen
    x.rid = id; x.ridOutage = false; x.meta = null; x.metaKey = '';
    set({ rid: id });
    if (x.mode !== 'idle') start(x.mode, at, x.current || 1, { count: x.count, names: x.names });
  }

  // D-128 B: the close control stops the recitation and hides the mini-player.
  function close() {
    stop(false);
    x.begun = false;
    set({ phase: 'none', msg: null, reason: '' });
    clearMedia();
  }

  function setFollow(on: boolean) {
    x.follow = on; set({ follow: on });
    clearTimeout(x.scrollT);
    if (on && x.current) scrollToAyah(x.current);
  }

  // ----- the element's events -----
  const stall = stallWatch({ ms: GIVE_UP_MS, pos: () => el.currentTime, live: () => x.mode !== 'idle' && !el.paused, giveUp: () => fail('audioUnavailable', 'timeout-stalled') });
  function onTime() {
    if (!x.meta || x.mode === 'idle' || x.seekPending) return;
    stall.progress(); // any movement restarts the 15 s stall clock (AC24)
    const ms = el.currentTime * 1000;
    if (x.stopAt >= 0 && ms >= x.stopAt) { ended(); return; } // AC9, AC53
    const a = ayahAt(x.meta.t, ms);
    if (a) mark(a);
    if (x.current) media(x.current); // AC28: no-op unless the lock-screen title is out of date
  }
  const loop = () => { onTime(); x.raf = el.paused ? 0 : requestAnimationFrame(loop); };
  // D-129 A, AC76: starting sound here pauses any recitation in another RIFQ tab on this device.
  // Only this message goes between tabs; nothing is stored or sent anywhere.
  let bc: BroadcastChannel | null = null;
  const tab = Math.random().toString(36).slice(2);
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => { const d = e.data as { t?: string; id?: string }; if (d?.t === 'playing' && d.id !== tab && !el.paused) el.pause(); };
  } catch { bc = null; }
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('playing', () => {
    clearTimers(); stall.watch();
    if (snap.msg && (snap.msg.key === 'audioLoading' || snap.msg.key === 'audioTapToPlay')) set({ msg: null });
    set({ playing: true }); paint();
    if (!x.raf) x.raf = requestAnimationFrame(loop);
    setHandlers();
    if (x.current) media(x.current, true);
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'playing'; } catch { /* none */ }
    try { bc?.postMessage({ t: 'playing', id: tab }); } catch { /* none */ }
  });
  el.addEventListener('pause', () => { stall.stop(); set({ playing: false }); paint(); if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'paused'; } catch { /* none */ } });
  const onWaiting = () => { if (x.mode !== 'idle') stall.watch(); };
  el.addEventListener('waiting', onWaiting);
  el.addEventListener('stalled', onWaiting);
  // Only an error of the file now set counts; the empty element used to prime iOS on the first tap,
  // or a file being replaced, is not a failure of the recitation.
  el.addEventListener('error', () => { if (x.mode !== 'idle' && x.srcSet && el.currentSrc && el.error) fail('audioUnavailable', `file-error-${el.error.code}`); });
  el.addEventListener('ended', () => ended());
  // A policy that blocks the audio host (for example after a redirect to another host) shows here.
  document.addEventListener('securitypolicyviolation', (e) => {
    if (!/^media-src/.test(e.effectiveDirective || e.violatedDirective) || x.mode === 'idle') return;
    let host = 'unknown';
    try { host = new URL(e.blockedURI).host || e.blockedURI.slice(0, 20); } catch { /* not a URL */ }
    fail('audioUnavailable', host === AUDIO_HOST ? 'csp-media-redirect' : `csp-media-${host}`);
  });
  // P-2: the reader's own scrolling pauses automatic scrolling for 5 s (on the playing surah's page).
  const onUser = (e: Event) => {
    if (x.mode !== 'surah' || !own()) return;
    if (e instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) return;
    x.follow = false; set({ follow: false });
    clearTimeout(x.scrollT);
    x.scrollT = window.setTimeout(() => { x.follow = true; set({ follow: true }); if (x.current) scrollToAyah(x.current); }, SCROLL_PAUSE_MS);
  };
  for (const ev of ['wheel', 'touchmove', 'keydown']) window.addEventListener(ev, onUser, { passive: true });
  // AC54: after the screen was locked or the tab hidden, catch up at once.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { onTime(); if (x.follow && x.current && x.mode === 'surah') scrollToAyah(x.current); } });

  function setHandlers() {
    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    if (!ms) return;
    const h = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, f); } catch { /* not supported */ } };
    h('play', () => { if (x.mode !== 'idle') void el.play().catch(() => undefined); });
    h('pause', () => el.pause());
    h('stop', () => close());
    h('previoustrack', () => seekAyah(x.current - 1));
    h('nexttrack', () => seekAyah(x.current + 1));
    h('seekbackward', null);
    h('seekforward', null);
  }
  setHandlers();

  // ----- in-place page changes (nav.ts, Astro's client router) -----
  let navType = 'push';
  document.addEventListener('astro:before-preparation', (e) => { navType = (e as Event & { navigationType?: string }).navigationType ?? 'push'; });
  document.addEventListener('astro:after-swap', () => {
    // P-2 with AC69: a follow-up timer from the page left behind does not scroll the new one. Coming
    // back to the playing surah's page with Back or Forward keeps the restored position: automatic
    // scrolling stays off until 5 s pass with no scrolling there (as after the reader's own scroll).
    clearTimeout(x.scrollT);
    if (x.mode === 'surah' && own() && navType === 'traverse') {
      x.follow = false; set({ follow: false });
      x.scrollT = window.setTimeout(() => { x.follow = true; set({ follow: true }); if (x.current) scrollToAyah(x.current); }, SCROLL_PAUSE_MS);
    }
    // D-128: an ended or not-available mini-player goes once the reader moves to another page.
    if (snap.phase === 'ended' || snap.phase === 'failed') { x.begun = false; set({ phase: 'none' }); }
    set({ page: pageSurah(), lang: pageLang() });
    paint();
    if (x.mode !== 'idle' && x.current) media(x.current, true); // AC74: title in the new language
    // AC74: the reciter's name as QF gives it for the new interface language.
    const lang = pageLang();
    if (snap.phase === 'active' && !x.lists[lang]) void fetchReciters(lang).catch(() => undefined);
  });

  return {
    get: () => snap,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    paint, start, seekAyah, pauseOrResume, chooseReciter, close, setFollow, loadReciters,
    // AC64: "go to the playing ayah" turns automatic scrolling back on.
    goPlaying() { x.follow = true; set({ follow: true }); clearTimeout(x.scrollT); },
    reveal() { if (x.current && own()) scrollToAyah(x.current); },
    el,
  };
}

export type Engine = ReturnType<typeof create>;
let engine: Engine | null = null;
// The engine of this tab, made on first use from the layout's persisted <audio data-audio>.
// Null where audio is off (no element) and on the server.
export function getEngine(dev = false): Engine | null {
  if (engine) return engine;
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLAudioElement>('audio[data-audio]');
  if (!el) return null;
  engine = create(el, dev);
  return engine;
}
export const idleSnap = (): Snap => IDLE;
