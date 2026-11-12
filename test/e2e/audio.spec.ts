// RQ-006 v1.1 "Listen to the Quran" in the browser, against the local Worker and the mock Quran
// Foundation API. The mock returns addresses on the approved audio host; this spec answers those
// requests itself with a made-up silent WAV file of the right length (Range supported), so no
// request leaves the machine. No recitation audio is used anywhere. Reciter names are the mock's.
// Not provable here (Chromium, no phone): AC26, AC27, AC29 and AC57 on the reference phone, and the
// lock screen part of AC28 and AC54. Those need Hamzeh's iPhone test.
import type { Page, Route } from '@playwright/test';
import { test, expect, src, surahs, MOBILE, hydrated, noOverflow } from './helpers.ts';
import { t } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { AR_WORD, MOCK_RECITER_NAMES } from '../mock/qf-mock.ts';

test.use({ allowHosts: [AUDIO_HOST, 'redirect-target.invalid'] });
test.describe.configure({ mode: 'serial' });

// Development builds add a short reason code to failure messages (diagnosis); tests expect it.
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STEP = 5000; // the mock's timing: ayah i runs from (i-1)*5000 to (i-1)*5000+4900 ms
const n = (s: number) => surahs[s - 1].items.length;
const wavs = new Map<number, Buffer>();
// A silent WAV (8-bit, 4000 Hz, mono) as long as the mock says the surah file is.
function wav(s: number): Buffer {
  let b = wavs.get(s);
  if (b) return b;
  const rate = 4000, len = Math.ceil((n(s) * STEP) / 1000) * rate + rate;
  b = Buffer.alloc(44 + len, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + len, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(len, 40);
  wavs.set(s, b);
  return b;
}
type Hit = { url: string; headers: Record<string, string> };
async function serveAudio(page: Page, hits: Hit[] = [], fail = false) {
  await page.context().route(`https://${AUDIO_HOST}/**`, async (route: Route) => {
    const req = route.request();
    hits.push({ url: req.url(), headers: await req.allHeaders() });
    if (fail) return route.fulfill({ status: 404, body: 'not found' });
    const s = Number(/\/(\d+)\.mp3/.exec(new URL(req.url()).pathname)?.[1] ?? 1);
    const body = wav(s);
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
    if (!m) return route.fulfill({ status: 200, body, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' } });
    const a = Number(m[1]), z = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: 206, body: body.subarray(a, z + 1), headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${z}/${body.length}` } });
  });
}
const marked = (page: Page) => page.$$eval('li.ayah-row.ap-current', (ls) => ls.map((l) => Number((l as HTMLElement).dataset.a)));
const seekTo = (page: Page, ms: number) => page.evaluate((x) => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = x / 1000; }, ms);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? 'null'));
const audioState = (page: Page) => page.evaluate(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement; return { paused: a.paused, ready: a.readyState, t: a.currentTime * 1000, src: a.currentSrc || a.getAttribute('src') || '' }; });
async function playSurah(page: Page) {
  await page.click('[data-play-surah]');
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
  // Playing for real: the file's data is there, so a seek now is not undone by the first seek.
  await expect.poll(async () => { const a = await audioState(page); return !a.paused && a.ready >= 3; }).toBe(true);
}

test('AU-01 (AC3, AC48, AC58): nothing is requested before play; no player off the reader page; without JavaScript only a note', async ({ page, seen, browser }) => {
  await page.goto('/1/');
  await hydrated(page);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('button.ap')).toHaveCount(n(1));
  await expect(page.locator('button.ap').first()).toBeVisible();
  const a = await page.$eval('audio[data-audio]', (e) => ({ preload: (e as HTMLAudioElement).preload, src: e.getAttribute('src'), paused: (e as HTMLAudioElement).paused }));
  expect(a).toEqual({ preload: 'none', src: null, paused: true });
  expect(seen.filter((x) => x.url.includes('/api/audio') || x.url.includes(AUDIO_HOST))).toEqual([]);
  for (const p of ['/', '/en/', '/surahs/', '/tafseer/1/', '/privacy/', '/en/privacy/']) {
    await page.goto(p);
    await expect(page.locator('[data-audio-player], button.ap'), p).toHaveCount(0);
  }
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE });
  const nj = await ctx.newPage();
  await nj.goto('/2/');
  await expect(nj.locator('[data-audio-noscript]')).toHaveText(t('ar', 'audioNoScript'));
  await expect(nj.locator('button.ap').first()).toBeHidden();
  await expect(nj.locator('[data-play-surah]')).toBeHidden();
  await ctx.close();
});

test('AU-02 (AC5, AC6, AC9, AC14, AC17, AC31, AC44, AC50): surah 1 plays, every ayah is marked by its timing, and playback stops at the end', async ({ page }) => {
  await serveAudio(page);
  await page.goto('/1/');
  await hydrated(page);
  await playSurah(page);
  // Default reciter (AC17) named, with the credit (AC31), before or as playback starts.
  await expect(page.locator('[data-reciter-name]')).toHaveText(AR_WORD(7));
  await expect(page.locator('[data-audio-credit]')).toHaveText(t('ar', 'audioCredit'));
  expect((await audioState(page)).src).toBe(`https://${AUDIO_HOST}/mock-rifq-test/7/1.mp3`);
  for (let a = 1; a <= n(1); a++) {
    await seekTo(page, (a - 1) * STEP + 2500);
    await expect.poll(() => marked(page), { timeout: 2000 }).toEqual([a]);
    await expect(page.locator('[data-audio-now]')).toHaveText(t('ar', 'audioNowAyah', { a }));
    expect((await stored(page))?.l, 'AC50: the playing ayah is the last position').toEqual([1, a]);
  }
  // AC9: at the end of the last ayah playback stops and the mark goes.
  await seekTo(page, (n(1) - 1) * STEP + 4400);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle', { timeout: 3000 });
  expect(await marked(page)).toEqual([]);
  expect((await audioState(page)).paused).toBe(true);
  // AC11: the Quran text is unchanged by marking.
  const texts = await page.$$eval('p.ayah[data-r]', (ps) => ps.map((p) => p.textContent));
  texts.forEach((x, i) => expect(Buffer.from(x!).equals(Buffer.from(surahs[0].items[i].aya_text))).toBe(true));
});

test('AU-03 (AC1, AC2, AC10, AC43, AC53): a single ayah plays from its start and stops at its end; pause resumes', async ({ page }) => {
  await serveAudio(page);
  await page.goto('/2/');
  await hydrated(page);
  const before = await stored(page);
  const b = page.locator('button.ap[data-ap="3"]');
  await expect(b).toHaveAttribute('aria-label', t('ar', 'audioPlayAyah', { a: 3 }));
  await b.click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await expect(b).toHaveAttribute('data-state', 'playing');
  await expect(b).toHaveAttribute('aria-label', t('ar', 'audioPauseAyah', { a: 3 }));
  const st = await audioState(page);
  expect(st.t).toBeGreaterThanOrEqual(2 * STEP - 50);
  expect(st.t).toBeLessThan(2 * STEP + 1500);
  expect(await marked(page)).toEqual([3]);
  // Pause and resume from the same point (AC2).
  await page.click('[data-pause]');
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  const at = (await audioState(page)).t;
  await page.click('[data-pause]');
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  expect(Math.abs((await audioState(page)).t - at)).toBeLessThan(600);
  // Near its end it stops by itself within 0.5 s of timestamp_to (AC53).
  await seekTo(page, 2 * STEP + 4900 - 600);
  await expect.poll(async () => (await audioState(page)).paused, { timeout: 3000 }).toBe(true);
  const end = (await audioState(page)).t;
  expect(end).toBeLessThanOrEqual(2 * STEP + 4900 + 500);
  expect(await marked(page)).toEqual([]);
  expect(await stored(page), 'AC50: a single ayah does not move the last position').toEqual(before);
  // AC10: another ayah's control stops the first and starts the new one.
  await page.click('button.ap[data-ap="5"]');
  await expect.poll(() => marked(page)).toEqual([5]);
  await page.click('button.ap[data-ap="7"]');
  await expect.poll(() => marked(page)).toEqual([7]);
  expect((await audioState(page)).t).toBeGreaterThanOrEqual(6 * STEP - 50);
  await expect(page.locator('button.ap[data-state="playing"]')).toHaveCount(1);
});

test('AU-04 (AC14, AC15, AC19, AC30): reciter list from the data; changing reciter restarts the current ayah; the choice is kept', async ({ page }) => {
  const hits: Hit[] = [];
  await serveAudio(page, hits);
  await page.goto('/en/2/');
  await hydrated(page);
  await playSurah(page);
  await seekTo(page, 3 * STEP + 1000);
  await expect.poll(() => marked(page)).toEqual([4]);
  await page.locator('[data-audio-more] summary').click();
  await expect(page.locator('[data-reciter]')).toHaveCount(2); // 7 and 97 pass on the mock data
  expect(await page.$$eval('[data-reciter]', (r) => r.map((x) => (x as HTMLInputElement).value))).toEqual(['7', '97']);
  const dl = page.locator('[data-audio-source]');
  await expect(dl).toContainText(MOCK_RECITER_NAMES[7]);
  await expect(dl).toContainText('Murattal');
  await expect(dl).toContainText('Hafs');
  await expect(dl).toContainText(t('en', 'audioLicence'));
  await page.check('[data-reciter="97"]');
  await expect.poll(async () => (await audioState(page)).src).toContain('/97/2.mp3?token=MOCK_SIGNATURE&expires=1');
  await expect.poll(async () => { const a = await audioState(page); return !a.paused && a.ready >= 1 && a.t > 0; }).toBe(true);
  // While the new file loads, the mark stays on ayah 4 (no jump to ayah 1 from the file's start).
  expect(await marked(page)).toEqual([4]);
  const tt = (await audioState(page)).t;
  expect(tt).toBeGreaterThanOrEqual(3 * STEP - 50);
  expect(tt).toBeLessThan(3 * STEP + 1500);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.settings')!).reciter)).toBe(97);
  // The text size and night setting keep the reciter, and the reciter keeps them.
  await page.click('[data-night]');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.settings')!))).toMatchObject({ dark: true, reciter: 97 });
  await page.reload();
  await hydrated(page);
  await page.locator('[data-audio-more] summary').click();
  await expect(page.locator('[data-reciter="97"]')).toBeChecked();
  // AC55: no cookies, no Referer, the address exactly as given.
  for (const h of hits) { expect(h.headers.cookie).toBeUndefined(); expect(h.headers.referer).toBeUndefined(); expect(h.url.startsWith(`https://${AUDIO_HOST}/`)).toBe(true); }
});

test('AU-05 (AC16, AC18, AC22, AC23): reciter no longer offered, storage blocked, offline, surah without audio, file failure', async ({ page, context }) => {
  // AC18: a stored reciter that is not offered.
  await page.addInitScript(() => { if (!sessionStorage.getItem('s')) { localStorage.setItem('rifq.settings', '{"reciter":2}'); sessionStorage.setItem('s', '1'); } });
  const hits: Hit[] = [];
  await serveAudio(page, hits);
  await page.goto('/en/1/');
  await hydrated(page);
  await page.click('[data-play-surah]');
  await expect(page.locator('[data-audio-status]')).toHaveText(t('en', 'audioReciterGone', { name: MOCK_RECITER_NAMES[7] }));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.settings')!).reciter)).toBe(7);
  // AC23: a surah the environment has no audio for: the not-available state, nothing fetched.
  await page.goto('/en/3/');
  await hydrated(page);
  await page.click('[data-play-surah]');
  // The first interaction or the tap finds it (whichever answers first); either way the disabled
  // button says why, next to it and as its description (QA FIND-8).
  await expect(page.locator('[data-audio-dead]')).toHaveText(`${t('en', 'audioNoSurah')} [surah-not-covered]`);
  await expect(page.locator('[data-play-surah]')).toBeDisabled();
  await expect(page.locator('[data-play-surah]')).toHaveAttribute('aria-describedby', 'ap-dead');
  expect(hits.filter((h) => /\/3\.mp3/.test(h.url))).toEqual([]);
  // AC22: offline.
  await page.goto('/en/1/');
  await hydrated(page);
  await context.setOffline(true);
  await page.click('[data-play-surah]');
  await expect(page.locator('[data-audio-status]')).toHaveText(t('en', 'audioOffline'));
  await context.setOffline(false);
  expect(await page.locator('p.ayah[data-r]').count()).toBe(n(1));
});

test('AU-06 (AC16, AC24): storage blocked keeps the choice for the visit only; a failing file stops with the message and keeps the mark', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  await serveAudio(page, [], true);
  await page.goto('/1/');
  await hydrated(page);
  await page.click('button.ap[data-ap="2"]');
  await expect(page.locator('[data-audio-status]')).toHaveText(new RegExp(`^${esc(t('ar', 'audioUnavailable'))} \\[(file-error-\\d|play-\\w+)\\]$`), { timeout: 10000 });
  expect(await marked(page)).toEqual([2]);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  await page.locator('[data-audio-more] summary').click();
  await page.check('[data-reciter="97"]');
  await expect(page.locator('[data-audio-status]')).toHaveText(t('ar', 'audioNotRemembered'));
});

test('AU-07 (AC7, AC8, P-2, AC46): automatic scrolling follows the ayah, pauses when the reader scrolls, and "go to current ayah" brings it back', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serveAudio(page);
  await page.goto('/2/');
  await hydrated(page);
  await playSurah(page);
  const inView = (a: number) => page.evaluate((x) => {
    const r = document.getElementById(`a${x}`)!.getBoundingClientRect();
    const top = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
    const bar = document.querySelector('[data-player]')!.getBoundingClientRect().top;
    // Fully on screen; an ayah taller than the space left shows from its start under the header.
    const room = Math.min(bar, innerHeight) - top;
    return r.height > room ? Math.abs(r.top - top) <= 12 : r.top >= top - 1 && r.bottom <= Math.min(bar, innerHeight) + 1;
  }, a);
  await seekTo(page, 40 * STEP + 1000);
  await expect.poll(() => marked(page)).toEqual([41]);
  await expect.poll(() => inView(41)).toBe(true);
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, -1500);
  await expect(page.locator('[data-go-current]')).toBeVisible();
  await seekTo(page, 60 * STEP + 1000);
  await expect.poll(() => marked(page)).toEqual([61]);
  expect(await inView(61)).toBe(false);
  const go = page.locator('[data-go-current]');
  expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await go.click();
  await expect.poll(() => inView(61)).toBe(true);
  await expect(go).toHaveCount(0);
  await noOverflow(page);
});

test('AU-08 (AC28, kit v24 report): the lock-screen title follows every ayah, also from timeupdate alone; the controls are previous and next ayah, not 10-second skips', async ({ page }) => {
  // Records the handlers the page sets, so the lock-screen buttons can be pressed from the test.
  await page.addInitScript(() => {
    const w = window as unknown as { __h: Record<string, ((d: unknown) => void) | null> };
    w.__h = {};
    const orig = MediaSession.prototype.setActionHandler;
    MediaSession.prototype.setActionHandler = function (this: MediaSession, a: MediaSessionAction, h: MediaSessionActionHandler | null) { w.__h[a] = h as never; return orig.call(this, a, h); };
  });
  await serveAudio(page);
  await page.goto('/en/2/');
  await hydrated(page);
  await playSurah(page);
  const md = () => page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist }));
  const want = (a: number) => ({ title: t('en', 'audioMediaTitle', { name: surahs[1].en, a }), artist: MOCK_RECITER_NAMES[7] });
  // Every ayah change updates the title (Hamzeh saw "ayah 2" stay on the lock screen).
  for (const a of [2, 3, 5, 10]) {
    await seekTo(page, (a - 1) * STEP + 1000);
    await expect.poll(md, { timeout: 3000 }).toEqual(want(a));
  }
  // A title that was lost or replaced is put back by the next timeupdate (as with the screen locked).
  await page.evaluate(() => { navigator.mediaSession.metadata = new MediaMetadata({ title: 'stale', artist: 'stale' }); });
  await expect.poll(md, { timeout: 3000 }).toEqual(want(10));
  // AC28: previous and next ayah are set; the 10-second skip handlers are cleared.
  const kinds = await page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as { __h: Record<string, unknown> }).__h).map(([k, v]) => [k, v === null ? 'null' : typeof v])));
  expect(kinds).toMatchObject({ previoustrack: 'function', nexttrack: 'function', seekbackward: 'null', seekforward: 'null', play: 'function', pause: 'function' });
  const press = (a: string) => page.evaluate((x) => (window as unknown as { __h: Record<string, (d: unknown) => void> }).__h[x]({ action: x }), a);
  await press('nexttrack');
  await expect.poll(() => marked(page)).toEqual([11]);
  await expect.poll(md).toEqual(want(11));
  await press('previoustrack');
  await press('previoustrack');
  await expect.poll(() => marked(page)).toEqual([9]);
  await expect.poll(md).toEqual(want(9));
  expect((await audioState(page)).t).toBeLessThan(8 * STEP + 1500);
  // The player's own buttons do the same.
  await page.click('[data-next-ayah]');
  await expect.poll(() => marked(page)).toEqual([10]);
  // After a stop, the lock-screen next button starts nothing.
  await page.evaluate(() => (window as unknown as { __h: Record<string, (d: unknown) => void> }).__h.stop({ action: 'stop' }));
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  await press('nexttrack');
  await page.waitForTimeout(500);
  expect((await audioState(page)).paused).toBe(true);
  expect(await marked(page)).toEqual([]);
});

test('AU-09 (AC39, AC41, AC42, AC45): policy on reader pages only; 44 px targets 8 px apart; mark not by colour alone; RTL icons', async ({ page, request }) => {
  const csp = (p: string) => request.get(p).then((r) => r.headers()['content-security-policy']);
  for (const p of ['/1/', '/en/114/']) expect(await csp(p)).toContain(`media-src https://${AUDIO_HOST}`);
  for (const p of ['/', '/surahs/', '/privacy/', '/en/privacy/', '/tafseer/1/']) expect(await csp(p)).not.toContain('media-src');
  const reader = await csp('/1/');
  expect(reader).toContain("default-src 'none'");
  expect(reader).toContain("connect-src 'self'");
  expect(reader).not.toMatch(/media-src[^;]*('self'|\*)/);
  await page.setViewportSize(MOBILE);
  await serveAudio(page);
  await page.goto('/2/');
  await hydrated(page);
  // The four per-ayah controls (play, play from here, bookmark, Tafseer): 44 px each, at least
  // 8 px apart on one axis, none over the Quran text.
  for (const id of ['#a3', `#a${n(2)}`]) {
    const row = await page.$eval(id, (r) => {
      const tx = r.querySelector('p.ayah')!.getBoundingClientRect();
      const bs = ['button.ap', 'button.apf', 'button.bm', 'a.tf-link'].map((s) => r.querySelector(s)!.getBoundingClientRect());
      let gap = Infinity;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        gap = Math.min(gap, Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom));
      }
      return { sizes: bs.map((b) => [b.width, b.height]), gap, overText: bs.some((b) => !(b.right <= tx.left || b.left >= tx.right)) };
    });
    for (const [w, h] of row.sizes) { expect(w, id).toBeGreaterThanOrEqual(44); expect(h, id).toBeGreaterThanOrEqual(44); }
    expect(row.gap, id).toBeGreaterThanOrEqual(8);
    expect(row.overText, id).toBe(false);
  }
  for (const sel of ['[data-play-surah]', '[data-prev-ayah]', '[data-next-ayah]', '[data-audio-more] summary']) {
    const b = (await page.locator(sel).boundingBox())!;
    expect(b.height, sel).toBeGreaterThanOrEqual(44);
  }
  expect(await page.$eval('[data-prev-ayah] svg', (s) => getComputedStyle(s).transform)).not.toBe('none');
  await playSurah(page);
  await seekTo(page, 2 * STEP + 1000);
  await expect.poll(() => marked(page)).toEqual([3]);
  for (const mode of ['light', 'dark']) {
    if (mode === 'dark') await page.click('[data-night]');
    const r = await page.$eval('#a3', (el) => {
      const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bar = getComputedStyle(el, '::before');
      const page = getComputedStyle(document.body).backgroundColor;
      return { bar: ratio(bar.backgroundColor, page), width: parseFloat(bar.width), text: ratio(getComputedStyle(el.querySelector('p.ayah')!).color, getComputedStyle(el).backgroundColor) };
    });
    expect(r.width, `${mode}: a bar, not colour alone`).toBeGreaterThanOrEqual(3);
    expect(r.bar, `${mode}: bar 3:1`).toBeGreaterThanOrEqual(3);
    expect(r.text, `${mode}: ayah text AA`).toBeGreaterThanOrEqual(4.5);
  }
});

test('AU-10 (AC47, AC51, AC49): text size changes keep playing; bookmark and play do not trigger each other; no layout shift when the player loads', async ({ page }) => {
  await serveAudio(page);
  await page.goto('/2/#a20');
  const top0 = await page.$eval('#a20', (e) => e.getBoundingClientRect().top);
  await hydrated(page);
  await page.waitForTimeout(300);
  expect(Math.abs((await page.$eval('#a20', (e) => e.getBoundingClientRect().top)) - top0)).toBeLessThanOrEqual(1);
  await page.click('button.bm[data-a="20"]');
  await expect(page.locator('button.bm[data-a="20"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await audioState(page)).paused).toBe(true);
  await page.click('button.ap[data-ap="20"]');
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await expect(page.locator('button.bm[data-a="20"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-larger]');
  await page.waitForTimeout(300);
  expect((await audioState(page)).paused).toBe(false);
  expect(src.list.length).toBeGreaterThan(0);
});

test('AU-11 (kit v22 report): the Arabic interface lists the reciters and plays surah 2; an empty list says no reciter is available', async ({ page }) => {
  await serveAudio(page);
  await page.goto('/2/');
  await hydrated(page);
  await playSurah(page);
  await expect(page.locator('[data-audio-status]')).toHaveAttribute('data-reason', '');
  await page.locator('[data-audio-more] summary').click();
  expect(await page.$$eval('[data-reciter]', (r) => r.map((x) => (x as HTMLInputElement).value))).toEqual(['7', '97']);
  await expect(page.locator('[data-audio-source]')).toContainText('Murattal');
  // When the Worker offers no reciter, the player says so (not the generic outage message).
  const p2 = await page.context().newPage();
  await p2.route('**/api/audio/reciters', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","reciters":[],"default":null}' }));
  await p2.goto('/2/');
  await hydrated(p2);
  // QA FIND-8: opening the details first (no play tap) still says why play is disabled.
  await p2.locator('[data-audio-more] summary').click();
  await expect(p2.locator('[data-audio-dead]')).toHaveText(`${t('ar', 'audioNoReciter')} [reciters-empty]`);
  await expect(p2.locator('[data-play-surah]')).toBeDisabled();
  await expect(p2.locator('[data-audio-status]')).toHaveAttribute('data-reason', 'reciters-empty');
  // An outage keeps the generic message, with its reason for diagnosis.
  const p3 = await page.context().newPage();
  await p3.route('**/api/audio/reciters', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"unavailable"}' }));
  await p3.goto('/en/2/');
  await hydrated(p3);
  await p3.click('[data-play-surah]');
  await expect(p3.locator('[data-audio-status]')).toHaveText(`${t('en', 'audioUnavailable')} [reciters-503-unavailable]`);
  await expect(p3.locator('[data-audio-status]')).toHaveAttribute('data-reason', 'reciters-503-unavailable');
});

test('AU-12 (diagnosis): a file that redirects to another host is blocked by the reader policy, and the code says so', async ({ page }) => {
  await page.context().route(`https://${AUDIO_HOST}/**`, (r) => r.fulfill({ status: 302, headers: { location: 'https://redirect-target.invalid/x.mp3' } }));
  await page.goto('/en/1/');
  await hydrated(page);
  await page.click('button.ap[data-ap="1"]');
  await expect(page.locator('[data-audio-status]')).toHaveText(`${t('en', 'audioUnavailable')} [csp-media-redirect]`, { timeout: 10000 });
  await expect(page.locator('[data-audio-status]')).toHaveAttribute('data-reason', 'csp-media-redirect');
  // The violation is the point of this test; clear it so the shared CSP guard does not fail.
  await page.evaluate(() => { (window as unknown as { __csp: string[] }).__csp = []; });
});

test('AU-13 (P-1, D-121): "play from here" beside each ayah plays the surah from that ayah, in both languages', async ({ page }) => {
  await serveAudio(page);
  for (const lang of ['en', 'ar'] as const) {
    await page.goto(lang === 'en' ? '/en/2/' : '/2/');
    await hydrated(page);
    await expect(page.locator('button.apf')).toHaveCount(n(2));
    await expect(page.locator('[data-play-from]')).toHaveCount(0); // the bar no longer has its own
    const f = page.locator('button.apf[data-apf="5"]');
    await expect(f).toHaveAttribute('aria-label', t(lang, 'audioPlayFrom', { a: 5 }));
    await f.click();
    await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
    await expect.poll(async () => { const a = await audioState(page); return !a.paused && a.ready >= 3; }).toBe(true);
    expect(await marked(page)).toEqual([5]);
    const at = (await audioState(page)).t;
    expect(at).toBeGreaterThanOrEqual(4 * STEP - 50);
    expect(at).toBeLessThan(4 * STEP + 1500);
    // Surah mode carries on into the next ayah (not a single-ayah stop).
    await seekTo(page, 5 * STEP + 1000);
    await expect.poll(() => marked(page)).toEqual([6]);
    expect((await audioState(page)).paused).toBe(false);
    await page.click('[data-pause]');
  }
});

test('AU-14 (TOG-1, QA FIND-5, FIND-6): the per-ayah icon and name swap between play and pause in English and Arabic; no aria-pressed', async ({ page }) => {
  await serveAudio(page);
  for (const lang of ['en', 'ar'] as const) {
    await page.goto(lang === 'en' ? '/en/2/' : '/2/');
    await hydrated(page);
    const b = page.locator('button.ap[data-ap="4"]');
    // Shown or not (a flex item's display is blockified, so only 'none' matters).
    const icon = () => b.evaluate((x) => ({ play: getComputedStyle(x.querySelector('.ap-play')!).display !== 'none', pause: getComputedStyle(x.querySelector('.ap-pause')!).display !== 'none' }));
    await expect(b).toHaveAttribute('aria-label', t(lang, 'audioPlayAyah', { a: 4 }));
    expect(await icon()).toEqual({ play: true, pause: false });
    await b.click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(b).toHaveAttribute('aria-label', t(lang, 'audioPauseAyah', { a: 4 }));
    await expect.poll(icon).toEqual({ play: false, pause: true });
    // The main control: its visible label is its name and changes; neither control has aria-pressed.
    await expect(page.locator('[data-pause]')).toHaveText(t(lang, 'audioPause'));
    expect(await page.$$eval('button.ap[aria-pressed], button.apf[aria-pressed], [data-pause][aria-pressed]', (x) => x.length)).toBe(0);
    await b.click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(true);
    await expect(b).toHaveAttribute('aria-label', t(lang, 'audioPlayAyah', { a: 4 }));
    await expect.poll(icon).toEqual({ play: true, pause: false });
    await expect(page.locator('[data-pause]')).toHaveText(t(lang, 'audioResume'));
  }
});

test('AU-15 (QA FIND-1, FIND-4): the reciter and source disclosure is named and marked; the credit is always visible; Latin text is isolated', async ({ page }) => {
  await serveAudio(page);
  for (const lang of ['ar', 'en'] as const) {
    await page.goto(lang === 'en' ? '/en/2/' : '/2/');
    await hydrated(page);
    const sum = page.locator('[data-audio-more] summary');
    // Named by its visible text (no aria-label hiding the reciter's name), starting with the label.
    expect(await sum.getAttribute('aria-label')).toBeNull();
    await expect(sum).toHaveAccessibleName(new RegExp(`^${esc(t(lang, 'audioMoreLabel'))}`));
    const marker = () => sum.evaluate((x) => { const m = getComputedStyle(x, '::before'); return { w: parseFloat(m.width), t: m.transform }; });
    const closed = await marker();
    expect(closed.w).toBeGreaterThan(0);
    // The credit is outside the disclosure, visible while it is closed (AC31).
    await expect(page.locator('[data-audio-credit]')).toBeVisible();
    await expect(page.locator('[data-audio-credit]')).toHaveText(t(lang, 'audioCredit'));
    await sum.click();
    await expect(page.locator('[data-reciter]')).toHaveCount(2);
    expect((await marker()).t).not.toBe(closed.t); // the marker turns when open
    if (lang === 'ar') {
      const dd = await page.$$eval('[data-audio-source] dd bdi', (b) => b.map((x) => [x.textContent, x.getAttribute('lang')]));
      expect(dd).toContainEqual(['Murattal', 'en']);
      expect(dd).toContainEqual(['Hafs', 'en']);
    }
  }
});

test('AU-16 (AC3, AC26, QA RISK-2): keys and scrolling request nothing; the first tap unlocks the element inside the tap; later taps play inside the tap', async ({ page, seen }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: { src: string | null; ev: string }[] };
    w.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { w.__plays.push({ src: this.getAttribute('src'), ev: (window.event as Event | undefined)?.type ?? '' }); return orig.call(this); };
  });
  const hits: Hit[] = [];
  await serveAudio(page, hits);
  await page.goto('/en/2/');
  await hydrated(page);
  // AC3: reading, key presses, pointer presses and scrolling request no audio metadata and no file.
  await page.keyboard.press('Shift');
  await page.locator('p.ayah[data-r="2:1"]').click(); // a press on the Quran text, not a control
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  expect(seen.filter((x) => x.url.includes('/api/audio'))).toEqual([]);
  expect(hits).toEqual([]);
  const plays = () => page.evaluate(() => (window as unknown as { __plays: { src: string | null; ev: string }[] }).__plays);
  // First tap: play() is called inside the tap at once, before the address is known (the iOS
  // unlock that worked on Hamzeh's iPhone with kit v24); then the file plays.
  await page.click('button.ap[data-ap="3"]');
  await expect.poll(async () => { const a = await audioState(page); return !a.paused && a.ready >= 3; }).toBe(true);
  const first = await plays();
  expect(first[0], 'the first play() runs inside the tap').toEqual({ src: null, ev: 'click' });
  expect(first.some((p) => !!p.src)).toBe(true);
  // A later tap: the address is known, so play() with the address runs inside the tap, and no
  // second unlock call is made.
  const n0 = first.length;
  await page.click('button.ap[data-ap="6"]');
  await expect.poll(() => marked(page)).toEqual([6]);
  const later = (await plays()).slice(n0);
  expect(later.length).toBeGreaterThan(0);
  expect(later[0].ev, 'later play() runs inside the tap').toBe('click');
  expect(later.every((p) => !!p.src), 'no unlock call once the address is set').toBe(true);
  // One reciter list and one address request in all.
  expect(seen.filter((x) => /\/api\/audio$/.test(new URL(x.url).pathname)).length).toBe(1);
  expect(seen.filter((x) => x.url.includes('/api/audio/reciters')).length).toBe(1);
});

test('AU-17 (QA FIND-9): a reciter refused by /api/audio refreshes the list, says which reciter is used now, and plays', async ({ page }) => {
  await serveAudio(page);
  let lists = 0;
  await page.route('**/api/audio/reciters', async (r) => {
    lists++;
    const res = await r.fetch();
    const j = await res.json();
    if (lists > 1) { j.reciters = j.reciters.filter((x: { id: number }) => x.id !== 7); j.default = 97; }
    await r.fulfill({ response: res, json: j });
  });
  await page.route('**/api/audio', async (r) => {
    if (JSON.parse(r.request().postData() ?? '{}').r === 7) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":"not_offered"}' });
    return r.fallback();
  });
  await page.goto('/en/2/');
  await hydrated(page);
  await page.click('[data-play-surah]');
  await expect(page.locator('[data-audio-status]')).toHaveText(t('en', 'audioReciterGone', { name: MOCK_RECITER_NAMES[97] }));
  await expect.poll(async () => (await audioState(page)).src).toContain('/97/2.mp3');
  await expect(page.locator('[data-play-surah], [data-audio-dead]')).toHaveCount(0);
  await expect(page.locator('[data-audio-status]')).not.toContainText(t('en', 'audioNoSurah'));
});

test('AU-18 (AC24, P-5, kit v24 report [timeout-stalled]): stalled and waiting events during playback do not stop it; only no progress for 15 s does', async ({ page }) => {
  test.setTimeout(120_000);
  await serveAudio(page);
  await page.goto('/en/2/');
  await hydrated(page);
  await playSurah(page);
  await seekTo(page, 3 * STEP + 1000);
  await expect.poll(() => marked(page)).toEqual([4]);
  const t0 = (await audioState(page)).t;
  // As Safari and Chromium do on large files: 'stalled' (and 'waiting') while playback continues.
  const fire = () => page.evaluate(() => { const a = document.querySelector('audio[data-audio]')!; a.dispatchEvent(new Event('stalled')); a.dispatchEvent(new Event('waiting')); });
  await fire();
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(4500); await fire(); }
  await page.waitForTimeout(1500); // 19.5 s after the first 'stalled', more than the 15 s limit
  const st = await audioState(page);
  expect(st.paused, 'still playing').toBe(false);
  expect(st.t - t0, 'and moving').toBeGreaterThan(15000);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
  await expect(page.locator('[data-audio-status]')).toHaveAttribute('data-reason', '');
  await expect(page.locator('[data-audio-status]')).toHaveText('');
  // Pausing for longer than 15 s is not a stall either.
  await page.click('[data-pause]');
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  await page.waitForTimeout(16000);
  await expect(page.locator('[data-audio-status]')).toHaveAttribute('data-reason', '');
  await page.click('[data-pause]');
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
});

test('AU-19 (AC24, P-5): when the file really stops arriving, playback gives up 15 s after the position stops, with the message, and the mark stays', async ({ page }) => {
  test.setTimeout(150_000);
  // The host answers only up to the 250th second of surah 2's file; a request for anything after
  // that is never answered (the data has stopped). Playback starts at ayah 47 (230 s).
  const LIMIT = 44 + 250 * 4000;
  const pending: Route[] = [];
  await page.context().route(`https://${AUDIO_HOST}/**`, async (route: Route) => {
    const body = wav(2);
    const a = Number(/bytes=(\d+)-/.exec(route.request().headers()['range'] ?? '')?.[1] ?? 0);
    if (a >= LIMIT) { pending.push(route); return; }
    const z = LIMIT - 1;
    return route.fulfill({ status: 206, body: body.subarray(a, z + 1), headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${z}/${body.length}` } });
  });
  await page.goto('/en/2/');
  await hydrated(page);
  await page.click('button.apf[data-apf="47"]');
  await expect.poll(async () => (await audioState(page)).t, { timeout: 20000 }).toBeGreaterThan(46 * STEP + 1000);
  expect(await marked(page)).toEqual([47]);
  // Plays to about 250 s, then the position stops; 15 s later it gives up. Track when it last moved.
  let last = -1, movedAt = Date.now();
  const status = page.locator('[data-audio-status]');
  while ((await status.getAttribute('data-reason')) !== 'timeout-stalled') {
    const a = await audioState(page);
    // Only movement while playing counts (the give-up pauses the element, which can move it a little).
    if (!a.paused && a.t !== last) { last = a.t; movedAt = Date.now(); }
    expect(Date.now() - movedAt, 'gave up too late').toBeLessThan(20000);
    await page.waitForTimeout(200);
  }
  const quiet = Date.now() - movedAt;
  expect(quiet, 'not before 15 s without movement').toBeGreaterThanOrEqual(14000);
  await expect(status).toHaveText(`${t('en', 'audioUnavailable')} [timeout-stalled]`);
  const end = (await audioState(page)).t;
  expect(end).toBeGreaterThan(48 * STEP);
  expect(end).toBeLessThanOrEqual(250_500);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  expect((await marked(page)).length, 'AC24: the mark stays on the ayah being played').toBe(1);
  expect((await audioState(page)).paused).toBe(true);
  for (const r of pending) await r.abort().catch(() => undefined);
});
