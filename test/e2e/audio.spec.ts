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
  await expect(b).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.locator('button.ap[aria-pressed="true"]')).toHaveCount(1);
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
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
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
  await expect(page.locator('[data-audio-status]')).toHaveText(`${t('en', 'audioNoSurah')} [surah-not-covered]`);
  await expect(page.locator('[data-play-surah]')).toBeDisabled();
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

test('AU-08 (AC28): Media Session title is the surah name and ayah, artist the reciter; next and previous move by ayah', async ({ page }) => {
  await serveAudio(page);
  await page.goto('/en/2/');
  await hydrated(page);
  await playSurah(page);
  await seekTo(page, 9 * STEP + 1000);
  await expect.poll(() => marked(page)).toEqual([10]);
  const md = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist }));
  expect(md).toEqual({ title: t('en', 'audioMediaTitle', { name: surahs[1].en, a: 10 }), artist: MOCK_RECITER_NAMES[7] });
  await page.click('[data-next-ayah]');
  await expect.poll(() => marked(page)).toEqual([11]);
  await page.click('[data-prev-ayah]');
  await page.click('[data-prev-ayah]');
  await expect.poll(() => marked(page)).toEqual([9]);
  expect((await audioState(page)).t).toBeLessThan(8 * STEP + 1500);
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
  const row = await page.$eval('#a3', (r) => {
    const box = (s: string) => r.querySelector(s)!.getBoundingClientRect();
    const ap = box('button.ap'), bm = box('button.bm'), tx = box('p.ayah');
    return { ap: [ap.width, ap.height], gap: Math.abs(ap.left - bm.right) < Math.abs(bm.left - ap.right) ? ap.left - bm.right : bm.left - ap.right, overlapText: !(ap.right <= tx.left || ap.left >= tx.right) };
  });
  expect(row.ap[0]).toBeGreaterThanOrEqual(44);
  expect(row.ap[1]).toBeGreaterThanOrEqual(44);
  expect(Math.abs(row.gap)).toBeGreaterThanOrEqual(8);
  expect(row.overlapText).toBe(false);
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
  await p2.click('[data-play-surah]');
  await expect(p2.locator('[data-audio-status]')).toHaveText(`${t('ar', 'audioNoReciter')} [reciters-empty]`);
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
