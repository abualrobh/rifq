// RQ-006 v1.3 continuity (D-126 to D-130): the recitation keeps playing across in-place page
// changes, with a mini-player on every page a reader can open. Against the local Worker and the mock
// Quran Foundation API; the approved audio host is answered with a made-up silent WAV (no request
// leaves the machine, no recitation audio). Not provable here (Chromium, no phone): AC27, AC28 on the
// lock screen, AC62 and AC73 on the reference phone with 4G and the memory figures on the phone.
import type { Page } from '@playwright/test';
import { test, expect, surahs, MOBILE, DESKTOP, hydrated, noOverflow } from './helpers.ts';
import { t } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { MOCK_RECITER_NAMES } from '../mock/qf-mock.ts';
import { audioState, serveAudio, STEP, type Hit } from './audio-helpers.ts';
import { loadRecorded, playFromShape, type RecordedShape } from '../fixtures/recorded-audio.ts';

test.use({ allowHosts: [AUDIO_HOST] });
test.describe.configure({ mode: 'default' });

const n = (s: number) => surahs[s - 1].items.length;
const len = (s: number) => n(s) * STEP;
const seekTo = (page: Page, ms: number) => page.evaluate((x) => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = x / 1000; }, ms);
const marked = (page: Page) => page.$$eval('li.ayah-row.ap-current', (ls) => ls.map((l) => Number((l as HTMLElement).dataset.a)));
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? 'null'));
const mini = (page: Page) => page.locator('[data-mini-player]');

// Marks the document: a full load drops the mark, an in-place change keeps it, and so does the
// audio element (same live node).
async function tag(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __doc: number; __el: Element | null; __loads: number };
    w.__doc = 1; w.__el = document.querySelector('audio[data-audio]'); w.__loads = 0;
    document.addEventListener('astro:page-load', () => { w.__loads++; });
  });
}
const sameDoc = (page: Page) => page.evaluate(() => { const w = window as unknown as { __doc?: number; __el?: Element | null }; return w.__doc === 1 && w.__el === document.querySelector('audio[data-audio]'); });
const clock = (page: Page) => page.evaluate(() => ({ ct: (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime * 1000, now: performance.now(), paused: (document.querySelector('audio[data-audio]') as HTMLAudioElement).paused }));

// One in-place change by a click, then the checks of AC62 (no pause, no jump: within 0.5 s of
// continuous play, P-8) and AC63 (the mini-player shows the playing recitation).
async function hop(page: Page, click: () => Promise<unknown>, path: RegExp | string) {
  const loads = await page.evaluate(() => (window as unknown as { __loads: number }).__loads);
  const a = await clock(page);
  await click();
  await page.waitForFunction((l) => (window as unknown as { __loads: number }).__loads > l, loads);
  if (typeof path === 'string') expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe(path);
  else expect(page.url()).toMatch(path);
  const b = await clock(page);
  expect(await sameDoc(page), 'in place, same audio element').toBe(true);
  if (!a.paused) {
    expect(b.paused, 'still playing').toBe(false);
    const drift = Math.abs((b.ct - a.ct) - (b.now - a.now));
    expect(drift, `AC62: within 0.5 s of continuous play (drift ${Math.round(drift)} ms)`).toBeLessThan(500);
  } else {
    expect(b.paused).toBe(true);
    expect(Math.abs(b.ct - a.ct)).toBeLessThan(50);
  }
  await expect(mini(page)).toBeVisible();
  await hydrated(page);
  return b;
}

async function playSurah(page: Page, s: number, lang: 'ar' | 'en' = 'ar') {
  await page.goto(lang === 'en' ? `/en/${s}/` : `/${s}/`);
  await hydrated(page);
  await expect(mini(page)).toHaveCount(0); // AC63: nothing before the first play
  await page.click('[data-play-surah]');
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
  await tag(page);
}

test('CN-01 (AC62, AC63, AC65, AC28, AC33, AC71, D-130): playing surah 2 continues across every page type in both languages', async ({ page, seen }) => {
  test.setTimeout(180_000);
  const hits: Hit[] = [];
  await serveAudio(page, len, hits);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await seekTo(page, 4 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([5]);
  // D-130: the mini-player is also on the playing surah's own page, beside the full player, and
  // the two never overlap.
  await expect(mini(page)).toBeVisible();
  const box = async () => ({ p: await page.locator('[data-player]').boundingBox(), m: await mini(page).boundingBox() });
  const b0 = await box();
  expect(b0.p!.y + b0.p!.height).toBeLessThanOrEqual(b0.m!.y + 1);
  await expect(page.locator('[data-mini-ayah]')).toHaveText(t('ar', 'audioNowAyah', { a: 5 }));
  const mediaTitle = () => page.evaluate(() => navigator.mediaSession.metadata?.title ?? '');
  const docs0 = seen.length;
  // The route (20 in-place changes): every page type, both languages, header, footer, index row,
  // surah navigation, Tafseer link and back, language switch, browser back and forward.
  const steps: [string, () => Promise<unknown>, RegExp | string][] = [
    ['home (brand)', () => page.click('a.brand'), '/'],
    ['index (card)', () => page.click('a.index-card'), '/surahs/'],
    ['reader 3 (index row)', () => page.click('a[data-surah-link="3"]'), '/3/'],
    ['reader 4 (next)', () => page.click('a[data-next]'), '/4/'],
    ['tafseer 4:1', () => page.click('#a1 a.tf-link'), /\/tafseer\/4\/#a1/],
    ['back to reading', () => page.click('a[data-back]'), /\/4\/#a1$/],
    ['privacy (footer)', () => page.click('[data-privacy-link]'), '/privacy/'],
    ['privacy en (switch)', () => page.click('#lang-switch'), '/en/privacy/'],
    ['home en (brand)', () => page.click('a.brand'), '/en/'],
    ['index en', () => page.click('a.index-card'), '/en/surahs/'],
    ['reader en 2 (row)', () => page.click('a[data-surah-link="2"]'), '/en/2/'],
    ['reader en 3 (next)', () => page.click('a[data-next]'), '/en/3/'],
    ['tafseer en 3:2', () => page.click('#a2 a.tf-link'), /\/en\/tafseer\/3\/#a2/],
    ['browser back', () => page.goBack(), '/en/3/'],
    ['browser forward', () => page.goForward(), /\/en\/tafseer\/3\/#a2/],
    ['back to reading en', () => page.click('a[data-back]'), /\/en\/3\/#a2$/],
    ['reader ar 3 (switch)', () => page.click('#lang-switch'), /\/3\/#a\d+$/],
    ['home ar', () => page.click('a.brand'), '/'],
    ['browser back ar', () => page.goBack(), /\/3\/#a\d+$/],
    ['index ar', () => page.click('[data-index-link] >> nth=0'), '/surahs/'],
  ];
  let i = 0;
  for (const [what, click, path] of steps) {
    await test.step(what, async () => { await hop(page, click, path); });
    i++;
    // AC28, D-126 3A: the system title is always the playing recitation, never the page on screen.
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(await mediaTitle(), what).toContain(lang === 'en' ? surahs[1].en : surahs[1].ar);
    // AC65: no ayah on another surah's page is marked.
    if (/\/[34]\//.test(page.url())) expect(await marked(page), what).toEqual([]);
    await expect(page.locator('[data-mini-surah]')).toContainText(`2. ${lang === 'en' ? surahs[1].en : surahs[1].ar}`);
    await noOverflow(page);
  }
  expect(i).toBe(20);
  // AC71: during and after 20 changes, pages and assets from RIFQ's origin only, the audio file from
  // the approved host only, no /api/ call but the audio metadata asked before, no /dev/ route, and
  // only the page asked for (no prefetching).
  const after = seen.slice(docs0);
  for (const s of after) {
    const u = new URL(s.url);
    expect([`127.0.0.1`, AUDIO_HOST]).toContain(u.hostname);
    // The only /api/ call is the Tafseer page's own request for the ayah it shows (RQ-005), a POST
    // made by its island when the page is opened, never a prefetch.
    // The other /api/ call: after the language switch, the reciter list in the new language, for the
    // reciter's name as QF gives it there (AC74, AC14); metadata only, asked once per language.
    if (u.pathname.startsWith('/api/')) { expect(['/api/tafseer', '/api/audio/reciters'], s.url).toContain(u.pathname); expect(s.method).toBe('POST'); }
    expect(u.pathname.startsWith('/dev/'), s.url).toBe(false);
  }
  expect(after.filter((s) => s.url.endsWith('/api/tafseer')).length).toBeLessThanOrEqual(3);
  expect(after.filter((s) => s.url.endsWith('/api/audio/reciters')).length).toBeLessThanOrEqual(1);
  const pages = after.filter((s) => new URL(s.url).hostname === '127.0.0.1' && (/\/$/.test(new URL(s.url).pathname)));
  // One fetch per change at most (back and forward may be answered by the router without one).
  expect(pages.length).toBeLessThanOrEqual(20);
  for (const h of hits) { expect(h.headers.cookie).toBeUndefined(); expect(h.headers.referer).toBeUndefined(); expect(h.headers.authorization).toBeUndefined(); }
  // Nothing about the pages visited is stored on the device.
  const keys = await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]);
  expect(keys[0].every((k) => k === 'rifq.settings' || k === 'rifq.saves')).toBe(true);
  expect(keys[1]).toEqual([]);
});

test('CN-02 (AC64, AC68, AC69, AC44): "go to the playing ayah", focus and title after a change, scroll on back and forward', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2, 'en');
  await seekTo(page, 39 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([40]);
  await hop(page, () => page.click('a.brand'), '/en/');
  // AC68: title changed, focus at the start of the main content, announced once.
  expect(await page.title()).toBe(t('en', 'siteName'));
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('content');
  await expect(page.locator('.astro-route-announcer')).toHaveText(t('en', 'siteName'));
  await expect(page.locator('.astro-route-announcer')).toHaveCount(1);
  expect(await page.evaluate(() => scrollY)).toBe(0); // AC69: a new page opens at the top
  // AC67 c: names say what they do and what plays.
  const go = page.locator('[data-mini-go]');
  await expect(go).toHaveAttribute('aria-label', t('en', 'miniGo', { s: 2, a: 40 }));
  await expect(go).toHaveAttribute('href', '/en/2/#a40');
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('aria-label', t('en', 'miniPause', { s: 2, a: 40 }));
  await hop(page, () => go.click(), '/en/2/#a40');
  // AC64: the playing ayah is on screen below the header and above both players, marked, focused.
  await expect.poll(() => marked(page)).toEqual([40]);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('a40');
  const fit = await page.evaluate(() => {
    const r = document.getElementById('a40')!.getBoundingClientRect();
    const top = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
    const bar = Math.min(document.querySelector('[data-player]')!.getBoundingClientRect().top, document.querySelector('[data-mini-player]')!.getBoundingClientRect().top);
    return r.top >= top - 1 && r.bottom <= bar + 1;
  });
  expect(fit).toBe(true);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
  // AC44: announced on this page only.
  await seekTo(page, 40 * STEP + 500);
  await expect(page.locator('[data-audio-now]')).toHaveText(t('en', 'audioNowAyah', { a: 41 }));
  // AC69: scroll down, go elsewhere, come back with Back: the same scroll position.
  await page.mouse.wheel(0, 900);
  // Wait until any scrolling has settled (an automatic scroll may still be running).
  let y = -1;
  await expect.poll(async () => { const v = await page.evaluate(() => scrollY); const same = v === y; y = v; return same; }, { intervals: [300] }).toBe(true);
  // Clicked by script: a test click would first scroll the footer link into view.
  await hop(page, () => page.evaluate(() => (document.querySelector('[data-privacy-link]') as HTMLElement).click()), '/en/privacy/');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await hop(page, () => page.goBack(), '/en/2/#a40');
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('content');
  // The skip link still works after the changes.
  await page.focus('a.skip');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('content');
  expect(await sameDoc(page)).toBe(true);
  // The mini-player link on the playing surah's own page: no page change, the ayah is shown.
  await page.evaluate(() => scrollTo(0, 0));
  const cur = Number(await page.locator('[data-mini-player]').getAttribute('data-a'));
  await page.click('[data-mini-go]');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(`a${cur}`);
  expect(await sameDoc(page)).toBe(true);
});

test('CN-03 (AC65, AC50 with D-127 A, AC10, AC19): another surah\'s page leaves the recitation alone until play there; last position rules', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await seekTo(page, 9 * STEP + 500);
  await expect.poll(async () => (await stored(page))?.l).toEqual([2, 10]); // own page: follows the audio
  await hop(page, () => page.click('a[data-prev] >> nth=0'), '/1/');
  // Another surah's page: the page's own player is idle for surah 1; nothing marked; the mini shows 2.
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  await expect(page.locator('[data-play-surah]')).toBeVisible();
  expect(await marked(page)).toEqual([]);
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-s', '2');
  // Reading here: D-062 saves what the reader reads (1:x); the audio moving on does not change it.
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await stored(page))?.l?.[0], { timeout: 8000 }).toBe(1);
  const l3 = (await stored(page)).l;
  await seekTo(page, 12 * STEP + 500);
  await page.waitForTimeout(1200);
  expect((await stored(page)).l[0]).toBe(1);
  expect((await stored(page)).l).toEqual(l3);
  // Bookmark and text size here do not touch the recitation.
  const c0 = await clock(page);
  await page.click('button.bm[data-a="2"]');
  await page.click('[data-display-toggle]');
  await page.click('[data-larger]');
  const c1 = await clock(page);
  expect(c1.paused).toBe(false);
  expect(Math.abs((c1.ct - c0.ct) - (c1.now - c0.now))).toBeLessThan(500);
  // AC19: the reciter changed here restarts the playing recitation (surah 2) in the new reciter.
  await page.locator('[data-audio-more] summary').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-audio-more] summary').click(); // closed again, so the player is short
  await expect.poll(async () => (await audioState(page))!.src).toContain('/97/2.mp3');
  await expect.poll(async () => { const x = (await audioState(page))!; return !x.paused && x.t >= 12 * STEP - 50 && x.t < 12 * STEP + 1500; }).toBe(true);
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-s', '2');
  await expect(page.locator('[data-mini-reciter]')).toHaveText(new RegExp(String(97)));
  // Only a play control here replaces it (AC10): ayah 2 of surah 1 plays, surah 2 has stopped.
  await page.click('button.ap[data-ap="2"]');
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-s', '1');
  await expect.poll(() => marked(page)).toEqual([2]);
  await expect.poll(async () => (await audioState(page))!.src).toContain('/97/1.mp3');
  // A single ayah never moves the last position.
  expect((await stored(page)).l[0]).toBe(1);
});

test('CN-04 (D-128 B, AC63, AC75, AC67): close stops and hides; the ended state shows elsewhere, is announced once, and goes on the next change', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 1);
  await hop(page, () => page.click('a.brand'), '/');
  // Room is kept for the bar (AC67 g): the footer's privacy link is not under it. QA FIND-I (kit v26):
  // the change's own scroll to the top (on the next frame) must be over before this scroll, and the
  // page must have stopped at its bottom before anything is measured.
  await scrollSettled(page);
  await expect.poll(async () => {
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await scrollSettled(page);
    return page.evaluate(() => Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)) <= 1);
  }).toBe(true);
  const f = await page.locator('[data-privacy-link]').boundingBox(), m = await mini(page).boundingBox();
  expect(f!.y + f!.height).toBeLessThanOrEqual(m!.y + 1);
  for (const sel of ['[data-mini-toggle]', '[data-mini-go]', '[data-mini-close]']) {
    const b = (await page.locator(sel).boundingBox())!;
    expect(b.width, sel).toBeGreaterThanOrEqual(44);
    expect(b.height, sel).toBeGreaterThanOrEqual(44);
  }
  await expect(mini(page)).toHaveAttribute('aria-label', t('ar', 'miniRegion'));
  await expect(page.locator('[data-mini-credit]')).toHaveText('Quran Foundation');
  await expect(page.locator('[data-mini-reciter]')).toHaveAttribute('lang', 'ar');
  // Pause and play from the mini-player (TOG-1: icon state and name change).
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('aria-label', t('ar', 'miniPlay', { s: 1, a: Number(await mini(page).getAttribute('data-a')) }));
  // A paused recitation stays paused at the same point across a change (AC62).
  await hop(page, () => page.click('a.index-card'), '/surahs/');
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(false);
  // AC75: the end of the surah while elsewhere: the ended state, announced, link still there.
  await seekTo(page, len(1) - 600);
  await expect(mini(page)).toHaveAttribute('data-phase', 'ended', { timeout: 4000 });
  await expect(page.locator('[data-mini-status]')).toHaveText(t('ar', 'miniEnded'));
  await expect(page.locator('[data-mini-status]')).toHaveAttribute('aria-live', 'polite');
  // QA FIND-M: what a screen reader reads in the region holds the ended line once, and not the
  // visible "now playing" label next to a region name of the same meaning (D-134).
  const exposed = await exposedText(page, '[data-mini-player]');
  expect(exposed.split(t('ar', 'miniEnded')).length - 1, exposed).toBe(1);
  expect(exposed.includes(t('ar', 'miniNowPlaying')), exposed).toBe(false);
  await expect(page.locator('[data-mini-go]')).toHaveAttribute('href', `/1/#a${n(1)}`);
  await expect(page.locator('[data-mini-toggle]')).toHaveCount(0);
  await hop2(page, () => page.click('a.brand'));
  await expect(mini(page)).toHaveCount(0);
  // D-128 B: close stops the sound and hides the bar; no room is kept; focus goes to the main content.
  await page.goto('/2/');
  await hydrated(page);
  await page.click('button.ap[data-ap="3"]');
  await expect.poll(async () => !(await audioState(page))!.paused).toBe(true);
  await page.click('[data-mini-close]');
  await expect(mini(page)).toHaveCount(0);
  expect((await audioState(page))!.paused).toBe(true);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--mini-h'))).toBe('');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('content');
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  expect(await page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();
});
test('CN-12 (QA v26 FIND-H, AC19, AC3): changing the reciter while paused loads it at the same ayah and stays paused, on the own page and elsewhere', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await seekTo(page, 5 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([6]);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  // On the playing surah's own page.
  await page.locator('[data-audio-more] summary').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-audio-more] summary').click();
  await expect.poll(async () => (await audioState(page))!.src).toContain('/97/2.mp3');
  await page.waitForTimeout(1500);
  expect((await audioState(page))!.paused, 'nothing starts on its own').toBe(true);
  await expect(mini(page)).toHaveAttribute('data-playing', '0');
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('[data-mini-reciter]')).toHaveText(new RegExp(String(97)));
  expect(await marked(page)).toEqual([6]);
  // Play resumes in the new reciter at that ayah.
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => { const x = (await audioState(page))!; return !x.paused && x.t >= 5 * STEP - 50 && x.t < 5 * STEP + 1500; }).toBe(true);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  // On another surah's page.
  await tag(page);
  await hop(page, () => page.click('a[data-prev] >> nth=0'), '/1/');
  await page.locator('[data-audio-more] summary').click();
  await page.check('[data-reciter="7"]');
  await page.locator('[data-audio-more] summary').click();
  await expect.poll(async () => (await audioState(page))!.src).toContain('/7/2.mp3');
  await page.waitForTimeout(1500);
  expect((await audioState(page))!.paused, 'nothing starts on its own').toBe(true);
  await expect(mini(page)).toHaveAttribute('data-s', '2');
  await expect(mini(page)).toHaveAttribute('data-playing', '0');
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => { const x = (await audioState(page))!; return !x.paused && x.t >= 5 * STEP - 50 && x.t < 5 * STEP + 1500; }).toBe(true);
  await expect(mini(page)).toHaveAttribute('data-a', '6');
});

// Resolves when the page has not scrolled for 6 animation frames in a row.
const scrollSettled = (page: Page) => page.evaluate(() => new Promise<void>((done) => {
  let last = -1, same = 0;
  const step = () => { const y = scrollY; same = y === last ? same + 1 : 0; last = y; if (same >= 6) done(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}));
// The text of an element a screen reader reads (text outside aria-hidden parts), in order.
const exposedText = (page: Page, sel: string) => page.$eval(sel, (root) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let x = w.nextNode(); x; x = w.nextNode()) if (!(x.parentElement?.closest('[aria-hidden="true"]'))) out += x.nodeValue;
  return out;
});
// A change after which the mini-player may be gone.
async function hop2(page: Page, click: () => Promise<unknown>) {
  const loads = await page.evaluate(() => (window as unknown as { __loads: number }).__loads);
  await click();
  await page.waitForFunction((l) => (window as unknown as { __loads: number }).__loads > l, loads);
  expect(await sameDoc(page)).toBe(true);
}

test('CN-05 (AC66, AC3, AC28): a reload or a new tab stops; nothing resumes; the help line says so', async ({ page, context }) => {
  await serveAudio(page, len);
  await playSurah(page, 2, 'en');
  await expect(page.locator('[data-audio-help]')).toHaveText(t('en', 'audioContinueHelp'));
  // A link opened in a new tab: a full load there, nothing plays; the first tab keeps playing.
  // (Headless Chromium does not open a tab on a modified click; a new page in the same context is
  // the same full load.)
  const tab = await context.newPage();
  await tab.goto(await page.locator('a.brand').getAttribute('href') ?? '/en/');
  await hydrated(tab);
  await expect(tab.locator('[data-mini-player]')).toHaveCount(0);
  expect((await audioState(tab))!.paused).toBe(true);
  expect((await audioState(page))!.paused).toBe(false);
  await tab.close();
  await page.reload();
  await hydrated(page);
  const a = (await audioState(page))!;
  expect(a.paused).toBe(true);
  expect(a.src).toBe('');
  await expect(mini(page)).toHaveCount(0);
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'idle');
  // No system title is left from before the reload (AC28: nothing to resume).
  expect(await page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();
});

test('CN-06 (AC76, D-129 A): playing in one tab pauses a recitation in another', async ({ page, context }) => {
  await serveAudio(page, len);
  await playSurah(page, 2);
  const p2 = await context.newPage();
  await p2.goto('/en/1/');
  await hydrated(p2);
  await p2.click('button.ap[data-ap="2"]');
  await expect.poll(async () => !(await audioState(p2))!.paused).toBe(true);
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('data-state', 'paused');
  // And back: resuming in the first tab pauses the second.
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(p2))!.paused).toBe(true);
  await p2.close();
});

test('CN-07 (AC74, AC14, AC41, AC67 e): the language switch keeps playing and changes the mini-player, full player and system title', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await seekTo(page, 6 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([7]);
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('aria-label', t('ar', 'miniPause', { s: 2, a: 7 }));
  await hop(page, () => page.click('#lang-switch'), /\/en\/2\/#a\d+$/);
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['en', 'ltr']);
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('aria-label', t('en', 'miniPause', { s: 2, a: 7 }));
  await expect(page.locator('[data-mini-surah]')).toHaveText(`2. ${surahs[1].en}`);
  await expect(page.locator('[data-mini-reciter]')).toHaveText(MOCK_RECITER_NAMES[7]);
  await expect(mini(page)).toHaveAttribute('aria-label', t('en', 'miniRegion'));
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe(t('en', 'audioMediaTitle', { name: surahs[1].en, a: 7 }));
  // The full player on its own page follows (English, surah mode, same ayah marked).
  await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
  await expect.poll(() => marked(page)).toEqual([7]);
  await expect(page.locator('[data-pause]')).toHaveText(t('en', 'audioPause'));
  // Desktop width: the bar and the page reflow, no sideways scroll; at 320 px too (SC 1.4.10).
  for (const w of [DESKTOP.width, 320]) { await page.setViewportSize({ width: w, height: 800 }); await noOverflow(page); }
});

test('CN-08 (AC70, R-9): settings, search, bookmarks, index filter, Tafseer and the development banner after in-place changes during playback', async ({ page }) => {
  await serveAudio(page, len);
  await playSurah(page, 2);
  await page.click('[data-night]');
  if (await page.locator('[data-display-toggle]').isVisible()) await page.click('[data-display-toggle]');
  await page.click('[data-larger]');
  const look = () => page.evaluate(() => [document.documentElement.classList.contains('dark'), document.documentElement.style.getPropertyValue('--ayah-size')]);
  const l0 = await look();
  expect(l0[0]).toBe(true);
  // No flash of the other palette: checked at the swap itself, before the new page paints.
  await page.evaluate(() => { const w = window as unknown as { __flash: boolean[] }; w.__flash = []; document.addEventListener('astro:after-swap', () => w.__flash.push(document.documentElement.classList.contains('dark'))); });
  await hop(page, () => page.click('a.brand'), '/');
  expect(await look()).toEqual(l0);
  expect(await page.evaluate(() => (window as unknown as { __flash: boolean[] }).__flash)).toEqual([true]);
  await expect(page.locator('[data-dev-banner]')).toBeVisible();
  await expect(page.locator('[data-source-details]')).toHaveCount(1);
  // Search (RQ-002) works on the swapped page, by its island (no full load to the Worker page).
  await page.fill('#q', '2:255');
  await page.press('#q', 'Enter');
  await expect(page.locator('[data-search-status]').first()).not.toBeEmpty();
  await expect(page.locator('[data-results] li, [data-search] a[href*="#a255"]').first()).toBeVisible();
  expect(await sameDoc(page)).toBe(true);
  // Index filter (RQ-004).
  await hop(page, () => page.click('a.index-card'), '/surahs/');
  await page.fill('[data-index-filter] input', '114');
  await expect(page.locator('[data-index-list] > li[data-row]:not([hidden])')).toHaveCount(1);
  await page.fill('[data-index-filter] input', '');
  // Bookmarks (RQ-003) on a reader page reached in place.
  await hop(page, () => page.click('a[data-surah-link="5"]'), '/5/');
  await page.click('button.bm[data-a="3"]');
  await expect(page.locator('button.bm[data-a="3"]')).toHaveAttribute('aria-pressed', 'true');
  // Tafseer (RQ-005) loads on a page reached in place.
  await hop(page, () => page.click('#a1 a.tf-link'), /\/tafseer\/5\/#a1/);
  await expect(page.locator('[data-tf-tafseer]')).toBeVisible();
  expect((await audioState(page))!.paused).toBe(false);
});

test('CN-09 (AC72 gate-off part, AC66): an answer that is not an RIFQ page is loaded in full, never placed in the tab', async ({ page }) => {
  await serveAudio(page, len);
  await playSurah(page, 2);
  // The server answers the next page with an error (as the gate's 401, a lock-out or a 503 would).
  for (const [status, type] of [[401, 'text/plain'], [503, 'text/plain'], [429, 'text/plain'], [500, 'text/html']] as const) {
    await hop(page, () => page.click('a.brand'), '/');
    await page.route('**/surahs/', (r) => r.fulfill({ status, contentType: type, body: status === 500 ? '<p>error</p>' : 'refused' }), { times: 2 });
    await page.click('a.index-card');
    await page.waitForURL('**/surahs/');
    // A full load: the document is new, the answer shows as the browser shows it, nothing plays.
    await expect.poll(() => sameDoc(page).catch(() => false), { message: String(status) }).toBe(false);
    expect(await page.locator('[data-mini-player]').count()).toBe(0);
    await page.unroute('**/surahs/');
    await page.goto('/2/');
    await hydrated(page);
    await page.click('[data-play-surah]');
    await expect.poll(async () => !(await audioState(page))!.paused).toBe(true);
    await tag(page);
  }
  // QA v26 FIND-G: a 404 is placed in the tab only when it is RIFQ's own 404 page. A 404 with
  // another HTML page (even an A1 page without the not-found marker) is loaded in full.
  const index = await (await page.request.get('/surahs/')).text();
  for (const body of ['<p>missing</p>', index]) {
    await hop(page, () => page.click('a.brand'), '/');
    await page.route('**/surahs/', (r) => r.fulfill({ status: 404, contentType: 'text/html', body }), { times: 2 });
    await page.click('a.index-card');
    await page.waitForURL('**/surahs/');
    await expect.poll(() => sameDoc(page).catch(() => false), { message: '404 ' + body.length }).toBe(false);
    await page.unroute('**/surahs/');
    await page.goto('/2/');
    await hydrated(page);
    await page.click('[data-play-surah]');
    await expect.poll(async () => !(await audioState(page))!.paused).toBe(true);
    await tag(page);
  }
});

test('CN-13 (QA v26 FIND-G, AC62): Back and Forward to RIFQ\'s own 404 page stay in place and keep the recitation playing', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  const r = await page.goto('/no-such-page/');
  expect(r!.status()).toBe(404);
  await hydrated(page);
  await tag(page);
  await hop2(page, () => page.click('main a[href="/"]'));
  await hop2(page, () => page.click('a.index-card'));
  await hop2(page, () => page.click('a[data-surah-link="2"]'));
  await hydrated(page);
  await page.click('[data-play-surah]');
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused; }).toBe(true);
  await hop(page, () => page.goBack(), /\/surahs\/$/);
  await hop(page, () => page.goBack(), /127\.0\.0\.1:\d+\/$/);
  await hop(page, () => page.goBack(), /\/no-such-page\/$/);
  await expect(page.locator('h1')).toHaveText(t('ar', 'notFound'));
  await hop(page, () => page.goForward(), /127\.0\.0\.1:\d+\/$/);
  expect((await audioState(page))!.paused).toBe(false);
});

test('CN-10 (AC73, P-13 in Chromium): 50 in-place changes during surah 2; no reload, no break, no listener build-up', async ({ page }) => {
  test.setTimeout(300_000);
  await serveAudio(page, len);
  await playSurah(page, 2);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
  const listeners = () => page.evaluate(() => (window as unknown as { __ls?: () => number }).__ls?.() ?? -1);
  // Counts the window and document listeners in place now (added and not removed; "once" ones not
  // counted), so a build-up from pages left behind would show.
  await page.evaluate(() => {
    const w = window as unknown as { __ls: () => number };
    const live: [EventTarget, string, unknown, boolean][] = [];
    const cap = (o: unknown) => (typeof o === 'boolean' ? o : !!(o && typeof o === 'object' && (o as AddEventListenerOptions).capture));
    for (const T of [Window.prototype, Document.prototype]) {
      const add = T.addEventListener, rem = T.removeEventListener;
      T.addEventListener = function (this: EventTarget, ...a: any[]) {
        const once = !!(a[2] && typeof a[2] === 'object' && (a[2] as AddEventListenerOptions).once);
        if (!once && !live.some((x) => x[0] === this && x[1] === a[0] && x[2] === a[1] && x[3] === cap(a[2]))) live.push([this, a[0], a[1], cap(a[2])]);
        return (add as any).apply(this, a);
      } as typeof add;
      T.removeEventListener = function (this: EventTarget, ...a: any[]) {
        const i = live.findIndex((x) => x[0] === this && x[1] === a[0] && x[2] === a[1] && x[3] === cap(a[2]));
        if (i >= 0) live.splice(i, 1);
        return (rem as any).apply(this, a);
      } as typeof rem;
    }
    w.__ls = () => live.length;
  });
  const h0 = await heap();
  const route: [() => Promise<unknown>, RegExp | string][] = [
    [() => page.click('a.brand'), /\/(en\/)?$/],
    [() => page.click('a.index-card'), /surahs\/$/],
    [() => page.click('a[data-surah-link="3"]'), /\/3\/$/],
    [() => page.click('#a1 a.tf-link'), /tafseer\/3\//],
    [() => page.click('[data-privacy-link]'), /privacy\/$/],
  ];
  const counts: number[] = [];
  for (let i = 0; i < 50; i++) {
    const [click, path] = route[i % route.length];
    await hop(page, click, path);
    if (i % 10 === 2) counts.push(await listeners()); // on a reader page (surah 3), with its islands
    if (i % 10 === 9) await hop(page, () => page.click('#lang-switch'), /./);
  }
  const h1 = await heap();
  expect(await sameDoc(page)).toBe(true);
  expect((await audioState(page))!.paused).toBe(false);
  // Listeners do not pile up: the count after each 10 changes stays level (within a small margin).
  expect(Math.max(...counts) - Math.min(...counts), `listener counts ${counts.join(', ')}`).toBeLessThanOrEqual(6);
  test.info().annotations.push({ type: 'memory', description: `Chromium heap after GC: start ${h0} bytes, after 50 changes ${h1} bytes; window/document listener balance per 10 changes: ${counts.join(', ')}` });
  console.log(`CN-10 memory: start ${h0} B, end ${h1} B; listeners ${counts.join(', ')}`);
});

// CN-11 (D-125 B, D-133 A): an address with a double slash in its path and a first ayah that starts
// after 0 ms play as given. Run on a made-up shape of that kind (always) and on the recorded pre-live
// shape of that kind, read from the private fixture (RIFQ_AUDIO_SHAPE) with its own values; no
// recorded value is written here.
const MADE_UP_LATE: RecordedShape = {
  keys: ['audio_url', 'chapter_id', 'duration', 'file_size', 'format', 'id', 'timestamps'], format: 'mp3', fileSize: 116214080, duration: 7162000,
  types: { file_size: 'number', duration: 'number', audio_url: 'string', timestamps: 'array' },
  urlPath: 'https://download.quranicaudio.com/quran/mock_made_up_reciter//{s}.mp3', urlHasQuery: false, entries: 286,
  entryKeys: ['duration', 'segments', 'timestamp_from', 'timestamp_to', 'verse_key'], first: [2740, 11980], last: [7100500, 7161300], lastEndMinusDuration: -700,
};
function recordedLate(): RecordedShape | null {
  const rec = loadRecorded();
  if (!rec) return null;
  for (const r of rec.reciters) for (const x of r.surahs) {
    const sh = x.shape;
    if (x.s === 2 && x.ok && sh?.urlPath && /^https:\/\/[^/]+\/.*\/\//.test(sh.urlPath) && sh.first && sh.first[0] > 0) return sh;
  }
  return null;
}
for (const kind of ['made-up', 'recorded'] as const) {
  test(`CN-11 (D-125 B, ${kind} shape): an address with a double slash and an ayah 1 starting after 0 ms play as given`, async ({ page }) => {
    const sh = kind === 'made-up' ? MADE_UP_LATE : recordedLate();
    test.skip(!sh, 'RIFQ_AUDIO_SHAPE not given (or it holds no such case)');
    test.skip(n(2) !== 286, 'needs the real ayah count of surah 2');
    const play = playFromShape(sh!, 2, 7);
    const url = play.url as string;
    const first = (play.t as [number, number][])[0][0];
    expect(url).toMatch(/^https:\/\/[^/]+\/.*\/\/2\.mp3$/);
    expect(first).toBeGreaterThan(1000);
    const hits: Hit[] = [];
    await serveAudio(page, () => 60_000, hits);
    await page.route('**/api/audio', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(play) }));
    await page.goto('/en/2/');
    await hydrated(page);
    await page.click('[data-play-surah]');
    await expect.poll(async () => { const x = (await audioState(page))!; return !x.paused && x.t >= first; }).toBe(true);
    expect((await audioState(page))!.src).toBe(url);
    expect(hits.every((h) => h.url === url)).toBe(true);
    await expect.poll(() => marked(page)).toEqual([1]);
    // Before the first ayah's start nothing is marked from the file (AC13): seek back to 1 s.
    await seekTo(page, 1000);
    await page.waitForTimeout(600);
    expect((await marked(page)).length).toBeLessThanOrEqual(1);
  });
}
