// RQ-006 v1.3 continuity (D-126 to D-130): the recitation keeps playing across in-place page
// changes, with a mini-player on every page a reader can open. Against the local Worker and the mock
// Quran Foundation API; the approved audio host is answered with a made-up silent WAV (no request
// leaves the machine, no recitation audio). Not provable here (Chromium, no phone): AC27, AC28 on the
// lock screen, AC62 and AC73 on the reference phone with 4G and the memory figures on the phone.
import type { Page } from '@playwright/test';
import { test, expect, surahs, MOBILE, DESKTOP, hydrated, noOverflow, ayahAction, bookmarked, clickLink } from './helpers.ts';
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
// Kit v39 (RQ-008 AC50): reader pages have no brand link (the tab bar has Home), so Home is reached
// through the visible tab bar's Home item on every page.
const toHome = (page: Page) => page.click('nav[data-tabbar]:visible a[data-tab="home"]');

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
  // D-130: the mini-player is also on the playing surah's own page. Kit v38 (RQ-008 AC55, D-203 A):
  // it is the only player there; the Play surah row is not fixed and scrolls with the page.
  await expect(mini(page)).toBeVisible();
  expect(await page.locator('[data-surah-audio]').evaluate((e) => getComputedStyle(e).position)).toBe('static');
  expect(await page.locator('[data-player]').count()).toBe(0);
  await expect(page.locator('[data-mini-ayah]')).toHaveText(t('ar', 'audioNowAyah', { a: 5 }));
  const mediaTitle = () => page.evaluate(() => navigator.mediaSession.metadata?.title ?? '');
  const docs0 = seen.length;
  // The route (23 in-place changes): every page type, both languages, header, footer, index row,
  // surah navigation, Tafseer link and back, tab bar, language switch in Settings (kit v37, RQ-008
  // D-181 C), browser back and forward.
  const tab = (id: string) => () => page.click(`nav[data-tabbar]:visible a[data-tab="${id}"]`);
  const steps: [string, () => Promise<unknown>, RegExp | string][] = [
    ['home (brand)', () => toHome(page), '/'],
    ['index (All surahs)', () => page.click('a[data-all-surahs]'), '/surahs/'],
    ['reader 3 (index row)', () => page.click('a[data-surah-link="3"]'), '/3/'],
    ['reader 4 (next)', () => page.click('a[data-next]'), '/4/'],
    // Kit v38: the Tafseer page is reached by its address (old links); the reader opens the panel.
    ['tafseer 4:1', () => clickLink(page, '/tafseer/4/#a1'), /\/tafseer\/4\/#a1/],
    ['back to reading', () => page.click('a[data-back]'), /\/4\/#a1$/],
    ['privacy (footer)', () => page.click('[data-privacy-link]'), '/privacy/'],
    ['settings (tab bar)', tab('settings'), '/settings/'],
    ['settings en (language)', () => page.click('[data-set-lang-link="en"]'), '/en/settings/'],
    ['home en (tab bar)', tab('home'), '/en/'],
    ['index en', () => page.click('a[data-all-surahs]'), '/en/surahs/'],
    ['reader en 2 (row)', () => page.click('a[data-surah-link="2"]'), '/en/2/'],
    ['reader en 3 (next)', () => page.click('a[data-next]'), '/en/3/'],
    ['tafseer en 3:2', () => clickLink(page, '/en/tafseer/3/#a2'), /\/en\/tafseer\/3\/#a2/],
    ['browser back', () => page.goBack(), '/en/3/'],
    ['browser forward', () => page.goForward(), /\/en\/tafseer\/3\/#a2/],
    ['back to reading en', () => page.click('a[data-back]'), /\/en\/3\/#a2$/],
    ['settings en (tab bar)', tab('settings'), '/en/settings/'],
    ['settings ar (language)', () => page.click('[data-set-lang-link="ar"]'), '/settings/'],
    ['home ar (brand)', () => toHome(page), '/'],
    ['browser back ar', () => page.goBack(), '/settings/'],
    ['saved ar (tab bar)', tab('saved'), '/saved/'],
    ['index ar (Read tab, no other position yet)', tab('read'), /\/(surahs\/|\d+\/#a\d+)$/],
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
  expect(i).toBe(steps.length);
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
  expect(pages.length).toBeLessThanOrEqual(steps.length);
  for (const h of hits) { expect(h.headers.cookie).toBeUndefined(); expect(h.headers.referer).toBeUndefined(); expect(h.headers.authorization).toBeUndefined(); }
  // Nothing about the pages visited is stored on the device.
  const keys = await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]);
  // Kit v37: recently read (RQ-008 AC20) is the one new device-only item (surah numbers only).
  // Kit v40: "tips seen" (RQ-008 AC80, a yes/no value) is the other one.
  expect(keys[0].every((k) => k === 'rifq.settings' || k === 'rifq.saves' || k === 'rifq.recent' || k === 'rifq.tips')).toBe(true);
  expect(keys[1]).toEqual([]);
});

test('CN-02 (AC64, AC68, AC69, AC44): "go to the playing ayah", focus and title after a change, scroll on back and forward', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2, 'en');
  await seekTo(page, 39 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([40]);
  await hop(page, () => toHome(page), '/en/');
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
    const bar = Math.min(document.querySelector('nav[data-tabbar="bottom"]')!.getBoundingClientRect().top, document.querySelector('[data-mini-player]')!.getBoundingClientRect().top);
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
  await ayahAction(page, 2, 'bookmark');
  await page.click('[data-display-toggle]');
  await page.click('[data-larger]');
  // Kit v39 (RQ-008 AC50): the reader header is shorter, so the open size panel now lies over the
  // Play surah row; it is closed (Esc) before the reciter button is used.
  await page.keyboard.press('Escape');
  const c1 = await clock(page);
  expect(c1.paused).toBe(false);
  expect(Math.abs((c1.ct - c0.ct) - (c1.now - c0.now))).toBeLessThan(500);
  // AC19: the reciter changed here restarts the playing recitation (surah 2) in the new reciter.
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-reciter-btn]').click(); // closed again
  await expect.poll(async () => (await audioState(page))!.src).toContain('/97/2.mp3');
  await expect.poll(async () => { const x = (await audioState(page))!; return !x.paused && x.t >= 12 * STEP - 50 && x.t < 12 * STEP + 1500; }).toBe(true);
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-s', '2');
  await expect(page.locator('[data-mini-reciter]')).toHaveText(new RegExp(String(97)));
  // Only a play control here replaces it (AC10): ayah 2 of surah 1 plays, surah 2 has stopped.
  await ayahAction(page, 2, 'play-ayah');
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
  await hop(page, () => toHome(page), '/');
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
  await hop(page, () => page.click('a[data-all-surahs]'), '/surahs/');
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
  await hop2(page, () => toHome(page));
  await expect(mini(page)).toHaveCount(0);
  // D-128 B: close stops the sound and hides the bar; no room is kept; focus goes to the main content.
  await page.goto('/2/');
  await hydrated(page);
  await ayahAction(page, 3, 'play-ayah');
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
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-reciter-btn]').click();
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
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="7"]');
  await page.locator('[data-reciter-btn]').click();
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

// QA v26 FIND-F (SC 2.4.11, AC43, AC67 d): no focused ayah control on /2/ at 390 px is hidden by the
// sticky player or the mini-player, with nothing playing, with the full player (and the mini-player
// D-130 puts under it), and with the mini-player for another surah. Every focusable control in the
// ayah list is focused; the first 60 by the Tab key, then all of them by focus().
async function focusHidden(page: Page, tabs: number) {
  const check = () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !el.closest('ol.ayat')) return null;
    let edge = innerHeight;
    for (const sel of ['[data-mini-player]', 'nav[data-tabbar="bottom"]']) {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      if (b && b.height > 0 && b.top > 0 && b.top < edge) edge = b.top;
    }
    const head = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
    const r = el.getBoundingClientRect();
    return r.bottom <= edge + 0.5 && r.bottom > head ? '' : `${el.getAttribute('aria-label') ?? el.className} bottom ${Math.round(r.bottom)} edge ${Math.round(edge)}`;
  });
  const bad: string[] = [];
  await page.evaluate(() => { const b = document.querySelector<HTMLElement>('ol.ayat'); b?.setAttribute('tabindex', '-1'); b?.focus(); scrollTo({ top: 0, behavior: 'instant' }); b?.removeAttribute('tabindex'); });
  let seen = 0;
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press('Tab');
    await scrollSettled(page);
    const r = await check();
    if (r === null) break;
    seen++;
    if (r) bad.push('Tab: ' + r);
  }
  const all = await page.evaluate(async () => {
    const out: string[] = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const els = [...document.querySelectorAll<HTMLElement>('ol.ayat :is(a[href], button:not([disabled]))')].filter((e) => e.tabIndex >= 0 && e.getClientRects().length > 0);
    for (const el of els) {
      el.focus();
      await frame();
      let edge = innerHeight;
      for (const sel of ['[data-mini-player]', 'nav[data-tabbar="bottom"]']) {
        const b = document.querySelector(sel)?.getBoundingClientRect();
        if (b && b.height > 0 && b.top > 0 && b.top < edge) edge = b.top;
      }
      const head = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
      const r = el.getBoundingClientRect();
      if (!(r.bottom <= edge + 0.5 && r.bottom > head)) out.push(`${el.getAttribute('aria-label') ?? el.className} bottom ${Math.round(r.bottom)} edge ${Math.round(edge)}`);
    }
    return { n: els.length, out };
  });
  return { tabbed: seen, n: all.n, bad: [...bad, ...all.out] };
}

test('CN-14 (QA v26 FIND-F, SC 2.4.11): focused ayah controls on /2/ are never hidden by the player or the mini-player', async ({ page }) => {
  test.setTimeout(400_000);
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  const results: string[] = [];
  // 1. Nothing playing: the idle player only.
  await page.goto('/2/');
  await hydrated(page);
  await expect(mini(page)).toHaveCount(0);
  let r = await focusHidden(page, 60);
  results.push(`idle: ${r.tabbed} by Tab, ${r.n} by focus()`);
  expect(r.tabbed).toBe(60);
  expect(r.n).toBeGreaterThanOrEqual(286); // kit v38: one actions button per ayah (D-187 A)
  expect(r.bad, 'idle').toEqual([]);
  // 2. A recitation of this surah (paused, so nothing scrolls by itself), with the mini-player (kit
  // v38: the only player, D-203 A).
  await page.click('[data-play-surah]');
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await expect(mini(page)).toBeVisible();
  r = await focusHidden(page, 60);
  results.push(`full player: ${r.tabbed} by Tab, ${r.n} by focus()`);
  expect(r.bad, 'full player and mini-player').toEqual([]);
  // 3. The mini-player for another surah (surah 1 playing), on /2/.
  await page.click('[data-mini-close]');
  await playSurah(page, 1);
  await hop(page, () => page.click('a[data-next] >> nth=0'), '/2/');
  await expect(mini(page)).toHaveAttribute('data-s', '1');
  r = await focusHidden(page, 60);
  results.push(`mini-player: ${r.tabbed} by Tab, ${r.n} by focus()`);
  expect(r.bad, 'mini-player').toEqual([]);
  // (Surah 1 is short, so it may have ended during the checks; the bar then shows the ended state.)
  await expect(mini(page)).toBeVisible();
  test.info().annotations.push({ type: 'focus', description: results.join('; ') });
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
  // Kit v38 (D-203 A, Hamzeh): the "Listening continues..." note left with the fixed full player.
  await expect(page.locator('[data-audio-help]')).toHaveCount(0);
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
  await ayahAction(p2, 2, 'play-ayah');
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
  // Kit v37 (D-181 C): the language is switched in Settings; the Read tab then opens the playing
  // surah's page at the saved position (the playing ayah, D-117 A).
  await hop(page, () => page.click('nav[data-tabbar]:visible a[data-tab="settings"]'), '/settings/');
  await hop(page, () => page.click('[data-set-lang-link="en"]'), '/en/settings/');
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['en', 'ltr']);
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('aria-label', t('en', 'miniPause', { s: 2, a: 7 }));
  await hop(page, () => page.click('nav[data-tabbar]:visible a[data-tab="read"]'), /\/en\/2\/#a\d+$/);
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
  // Kit v37 (RQ-008 AC71): night mode on the Settings screen, reached in place; Back to the reader.
  await hop(page, () => page.click('nav[data-tabbar]:visible a[data-tab="settings"]'), '/settings/');
  await hydrated(page);
  await page.click('[data-night-switch]');
  await hop(page, () => page.goBack(), '/2/');
  if (await page.locator('[data-display-toggle]').isVisible()) await page.click('[data-display-toggle]');
  await page.click('[data-larger]');
  const look = () => page.evaluate(() => [document.documentElement.classList.contains('dark'), document.documentElement.style.getPropertyValue('--ayah-size')]);
  const l0 = await look();
  expect(l0[0]).toBe(true);
  // No flash of the other palette: checked at the swap itself, before the new page paints.
  await page.evaluate(() => { const w = window as unknown as { __flash: boolean[] }; w.__flash = []; document.addEventListener('astro:after-swap', () => w.__flash.push(document.documentElement.classList.contains('dark'))); });
  await hop(page, () => toHome(page), '/');
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
  await hop(page, () => page.click('a[data-all-surahs]'), '/surahs/');
  await page.fill('[data-index-filter] input', '114');
  await expect(page.locator('[data-index-list] > li[data-row]:not([hidden])')).toHaveCount(1);
  await page.fill('[data-index-filter] input', '');
  // Bookmarks (RQ-003) on a reader page reached in place.
  await hop(page, () => page.click('a[data-surah-link="5"]'), '/5/');
  await ayahAction(page, 3, 'bookmark');
  await expect.poll(() => bookmarked(page, 3)).toBe(true);
  // Tafseer (RQ-005) loads on a page reached in place (kit v38: by its address).
  await hop(page, () => clickLink(page, '/tafseer/5/#a1'), /\/tafseer\/5\/#a1/);
  await expect(page.locator('[data-tf-tafseer]')).toBeVisible();
  expect((await audioState(page))!.paused).toBe(false);
});

test('CN-09 (AC72 gate-off part, AC66): an answer that is not an RIFQ page is loaded in full, never placed in the tab', async ({ page }) => {
  await serveAudio(page, len);
  await playSurah(page, 2);
  // The server answers the next page with an error (as the gate's 401, a lock-out or a 503 would).
  for (const [status, type] of [[401, 'text/plain'], [503, 'text/plain'], [429, 'text/plain'], [500, 'text/html']] as const) {
    await hop(page, () => toHome(page), '/');
    await page.route('**/surahs/', (r) => r.fulfill({ status, contentType: type, body: status === 500 ? '<p>error</p>' : 'refused' }), { times: 2 });
    await page.click('a[data-all-surahs]');
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
    await hop(page, () => toHome(page), '/');
    await page.route('**/surahs/', (r) => r.fulfill({ status: 404, contentType: 'text/html', body }), { times: 2 });
    await page.click('a[data-all-surahs]');
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
  await hop2(page, () => page.click('a[data-all-surahs]'));
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
    [() => toHome(page), /\/(en\/)?$/],
    [() => page.click('a[data-all-surahs]'), /surahs\/$/],
    [() => page.click('a[data-surah-link="3"]'), /\/3\/$/],
    [() => clickLink(page, '/tafseer/3/#a1'), /tafseer\/3\//],
    [() => page.click('[data-privacy-link]'), /privacy\/$/],
  ];
  const counts: number[] = [];
  for (let i = 0; i < 50; i++) {
    const [click, path] = route[i % route.length];
    await hop(page, click, path);
    if (i % 10 === 2) counts.push(await listeners()); // on a reader page (surah 3), with its islands
    // Kit v37 (D-181 C): the language switch is in Settings; the route goes on from that page.
    if (i % 10 === 9) { await hop(page, () => page.click('nav[data-tabbar]:visible a[data-tab="settings"]'), /settings\/$/); await hop(page, () => page.click('[data-set-lang-link]:not([aria-current])'), /settings\/$/); }
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

// QA v27 FIND-N and FIND-F rest (SC 2.4.11, AC43): keyboard focus moving forward (Tab) and back
// (Shift+Tab) through the ayah controls on /2/. After each key press the focused control is
// measured against the sticky header (top) and the top of the player or mini-player (bottom).
// `clear`: the whole control is between them. `covered`: no part of it is (SC 2.4.11 fails).
async function sweep(page: Page, fwd: number, back: number) {
  const check = () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !el.closest('ol.ayat')) return null;
    let edge = innerHeight;
    for (const sel of ['[data-mini-player]', 'nav[data-tabbar="bottom"]']) {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      if (b && b.height > 0 && b.top > 0 && b.top < edge) edge = b.top;
    }
    const head = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
    const r = el.getBoundingClientRect();
    const name = `${el.getAttribute('aria-label') ?? el.className} ${Math.round(r.top)}-${Math.round(r.bottom)} (header ${Math.round(head)}, bar ${Math.round(edge)})`;
    return { clear: r.top >= head - 0.5 && r.bottom <= edge + 0.5, covered: r.bottom <= head + 0.5 || r.top >= edge - 0.5, name };
  });
  // The web fonts are loaded first: a font arriving after a key press can change the header's
  // height and move the page after the browser has scrolled the control into view (seen once at
  // 360 px in English in a repeated run), which is a different matter from focus scrolling.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => { const b = document.querySelector<HTMLElement>('ol.ayat'); b?.setAttribute('tabindex', '-1'); b?.focus(); scrollTo({ top: 0, behavior: 'instant' }); b?.removeAttribute('tabindex'); });
  await scrollSettled(page);
  const out = { presses: 0, notClear: [] as string[], covered: [] as string[] };
  for (const [key, times] of [['Tab', fwd], ['Shift+Tab', back]] as const) {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key);
      await scrollSettled(page);
      const r = await check();
      if (r === null) break;
      out.presses++;
      if (!r.clear) out.notClear.push(`${key}: ${r.name}`);
      if (r.covered) out.covered.push(`${key}: ${r.name}`);
    }
  }
  return out;
}
async function setTextSize(page: Page, size: number) {
  await page.evaluate((v) => { const k = 'rifq.settings'; const s = JSON.parse(localStorage.getItem(k) ?? '{}'); localStorage.setItem(k, JSON.stringify({ ...s, size: v })); }, size);
}
// The three player states of CN-14 on /2/ or /en/2/, each followed by a sweep.
async function sweepStates(page: Page, lang: 'ar' | 'en', fwd: number, back: number) {
  const p = (s: number) => (lang === 'en' ? `/en/${s}/` : `/${s}/`);
  const res: { state: string; r: Awaited<ReturnType<typeof sweep>>; size: string }[] = [];
  const size = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--ayah-size'));
  await page.goto(p(2));
  await hydrated(page);
  res.push({ state: 'idle', r: await sweep(page, fwd, back), size: await size() });
  await page.click('[data-play-surah]');
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await expect(mini(page)).toBeVisible();
  res.push({ state: 'full player + mini-player', r: await sweep(page, fwd, back), size: await size() });
  await page.click('[data-mini-close]');
  await playSurah(page, 1, lang);
  await hop(page, () => page.click('a[data-next] >> nth=0'), p(2));
  await expect(mini(page)).toHaveAttribute('data-s', '1');
  res.push({ state: 'mini-player for surah 1', r: await sweep(page, fwd, back), size: await size() });
  return res;
}

for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`CN-15 (QA v27 FIND-N, SC 2.4.11): at ${size.width}x${size.height}, Tab and Shift+Tab never leave a focused ayah control under the header or a player (ar, en; text size 1 and 5; 3 player states)`, async ({ page }) => {
    test.setTimeout(900_000);
    await serveAudio(page, len);
    await page.setViewportSize(size);
    const notes: string[] = [];
    for (const lang of ['ar', 'en'] as const) {
      for (const ts of [1.25, 2.5]) {
        await page.goto(lang === 'en' ? '/en/' : '/');
        await setTextSize(page, ts);
        for (const { state, r, size: got } of await sweepStates(page, lang, 40, 30)) {
          expect(got, `${lang} ${state}: text size applied`).toBe(`${ts}rem`);
          notes.push(`${lang} size ${ts} ${state}: ${r.presses} presses, ${r.notClear.length} not clear`);
          expect(r.presses, `${lang} ${ts} ${state}: the sweep reached the ayah list`).toBeGreaterThan(40);
          expect(r.notClear, `${lang} ${ts} ${state}`).toEqual([]);
        }
        await page.click('[data-mini-close]').catch(() => undefined);
      }
    }
    test.info().annotations.push({ type: 'focus', description: notes.join('; ') });
  });
}

test('CN-16 (QA v27 FIND-F rest, SC 2.4.11): phone held sideways (844x390) with the full player and the mini-player: no focused ayah control is fully hidden (Tab, Shift+Tab, focus(); ar, en)', async ({ page }) => {
  test.setTimeout(600_000);
  await serveAudio(page, len);
  await page.setViewportSize({ width: 844, height: 390 });
  const notes: string[] = [];
  for (const lang of ['ar', 'en'] as const) {
    await page.goto(lang === 'en' ? '/en/2/' : '/2/');
    await hydrated(page);
    await page.click('[data-play-surah]');
    await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
    await page.click('[data-mini-toggle]');
    await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
    await expect(mini(page)).toBeVisible();
    const r = await sweep(page, 60, 30);
    const f = await focusHidden(page, 0);
    notes.push(`${lang}: ${r.presses} presses, ${r.notClear.length} not fully clear, ${r.covered.length} fully hidden; focus() ${f.n} controls, ${f.bad.length} not clear`);
    expect(r.covered, `${lang}: fully hidden by keys`).toEqual([]);
    expect(r.notClear, `${lang}: not fully clear by keys`).toEqual([]);
    expect(f.bad, `${lang}: focus()`).toEqual([]);
    await page.click('[data-mini-close]');
  }
  test.info().annotations.push({ type: 'focus', description: notes.join('; ') });
});

test('CN-17 (QA v27 FIND-O): a reciter change while paused, with slow audio metadata, shows no "loading" message while nothing is loading', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  // From now on the audio metadata answers after 2.5 s (more than the 1 s loading clock).
  await page.route('**/api/audio', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  const status = page.locator('[data-audio-status]');
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-reciter-btn]').click();
  // While the metadata is on its way (held paused, nothing will play): no loading message.
  await page.waitForTimeout(1500);
  await expect(status).not.toHaveText(t('ar', 'audioLoading'));
  await expect.poll(async () => (await audioState(page))!.src, { timeout: 10_000 }).toContain('/97/2.mp3');
  await page.waitForTimeout(1500);
  expect((await audioState(page))!.paused).toBe(true);
  await expect(status).not.toHaveText(t('ar', 'audioLoading'));
  await expect(status).toHaveAttribute('data-loading', '0');
});

test('CN-18 (QA v27, informational): in the ended state the mini-player exposes no empty paragraph to screen readers', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 1);
  await hop(page, () => page.click('a[data-next] >> nth=0'), '/2/');
  await seekTo(page, len(1) - 300);
  await expect(mini(page)).toHaveAttribute('data-phase', 'ended', { timeout: 15_000 });
  const snap = await mini(page).ariaSnapshot();
  expect(snap, snap).not.toMatch(/- paragraph\s*$/m);
  await expect(page.locator('[data-mini-status]')).toHaveText(t('ar', 'miniEnded'));
});

// QA v28 FIND-P (SC 2.4.11 and 2.4.7 in practice, AC43, AC67 d, P-2): while a surah plays, focus
// moved to another ayah's control (Tab, Shift+Tab, focus()) is the reader moving: automatic
// scrolling pauses and stays paused while focus stays there, so the control stays on screen.
const focusOnScreen = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement;
  let edge = innerHeight;
  for (const sel of ['[data-mini-player]', 'nav[data-tabbar="bottom"]']) {
    const b = document.querySelector(sel)?.getBoundingClientRect();
    if (b && b.height > 0 && b.top > 0 && b.top < edge) edge = b.top;
  }
  const head = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
  const r = el.getBoundingClientRect();
  return { ok: r.top >= head - 0.5 && r.bottom <= edge + 0.5, label: el.getAttribute('aria-label') ?? '', top: Math.round(r.top), bottom: Math.round(r.bottom), head: Math.round(head), edge: Math.round(edge) };
});
for (const lang of ['ar', 'en'] as const) {
  test(`CN-19 (QA v28 FIND-P, ${lang}): focus on another ayah's control during surah playback is never scrolled off screen`, async ({ page }) => {
    await serveAudio(page, len);
    await page.setViewportSize(MOBILE);
    await playSurah(page, 2, lang);
    // By focus(): the control of ayah 10, then two ayah changes, the second after the 5 s pause.
    await page.focus('button.ayah-act[data-act="10"]');
    let f = await focusOnScreen(page);
    expect(f.ok, JSON.stringify(f)).toBe(true);
    await seekTo(page, STEP + 300);
    await expect.poll(() => marked(page)).toEqual([2]);
    await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
    await page.waitForTimeout(600);
    f = await focusOnScreen(page);
    expect(f.ok, `after the ayah change: ${JSON.stringify(f)}`).toBe(true);
    await page.waitForTimeout(5200);
    await seekTo(page, 2 * STEP + 300);
    await expect.poll(() => marked(page)).toEqual([3]);
    await page.waitForTimeout(600);
    f = await focusOnScreen(page);
    expect(f.ok, `5 s later, focus still there: ${JSON.stringify(f)}`).toBe(true);
    // By the keyboard: Tab to the next control, then an ayah change.
    await page.keyboard.press('Tab');
    await seekTo(page, 3 * STEP + 300);
    await expect.poll(() => marked(page)).toEqual([4]);
    await page.waitForTimeout(600);
    f = await focusOnScreen(page);
    expect(f.ok, `after Tab: ${JSON.stringify(f)}`).toBe(true);
    // "Go to the playing ayah" turns automatic scrolling back on at once (AC64). Kit v38: in the
    // mini-player, the only player (D-203 A).
    await page.click('[data-mini-go]');
    await expect(page.locator('li#a4')).toBeInViewport();
    await seekTo(page, 4 * STEP + 300);
    await expect.poll(() => marked(page)).toEqual([5]);
    await expect(page.locator('li#a5')).toBeInViewport();
    // Focus on the playing ayah's own control does not pause it.
    await page.focus('button.ayah-act[data-act="5"]');
    await seekTo(page, 5 * STEP + 300);
    await expect.poll(() => marked(page)).toEqual([6]);
    await expect(page.locator('li#a6')).toBeInViewport();
  });
}

// QA v28 FIND-Q: Play pressed while a paused reciter change is still loading is not lost: the
// player says it is loading, and the recitation starts at the same ayah once the reciter is ready.
test('CN-20 (QA v28 FIND-Q): play pressed during a held reciter change starts it once loaded, with a loading message meanwhile', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await seekTo(page, 3 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([4]);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await page.route('**/api/audio', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  const status = page.locator('[data-audio-status]');
  for (const [rid, how] of [['97', '[data-mini-toggle]'], ['7', '[data-pause]']] as const) {
    await page.locator('[data-reciter-btn]').click();
    await page.check(`[data-reciter="${rid}"]`);
    await page.locator('[data-reciter-btn]').click();
    await page.waitForTimeout(500);
    // While held, the full player offers to resume (not "Play surah" from ayah 1).
    await expect(page.locator('[data-play-surah]')).toHaveCount(0);
    await page.click(how);
    await expect(status).toHaveText(t('ar', 'audioLoading'));
    await expect(status).toHaveAttribute('data-loading', '1');
    await expect.poll(async () => { const x = (await audioState(page))!; return x.src.includes(`/${rid}/2.mp3`) && !x.paused && x.t >= 3 * STEP - 50 && x.t < 3 * STEP + 2500; }, { timeout: 10_000 }).toBe(true);
    await expect(status).not.toHaveText(t('ar', 'audioLoading'));
    expect(await marked(page)).toEqual([4]);
    await page.click('[data-mini-toggle]');
    await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
    await seekTo(page, 3 * STEP + 500);
  }
});

// QA v28 FIND-R: a held change whose metadata comes after the 15 s give-up: the "not available"
// message is shown at the give-up and taken away when the new reciter is ready.
test('CN-21 (QA v28 FIND-R): the give-up message of a late held reciter change goes once the reciter is ready', async ({ page }) => {
  test.setTimeout(90_000);
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await page.route('**/api/audio', async (route) => { await new Promise((r) => setTimeout(r, 17_000)); await route.continue(); });
  const status = page.locator('[data-audio-status]');
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-reciter-btn]').click();
  // Development builds add the reason code after the message.
  await expect(status).toContainText(t('ar', 'audioUnavailable'), { timeout: 17_000 });
  await expect(status).toHaveAttribute('data-reason', 'timeout-loading');
  await expect.poll(async () => (await audioState(page))!.src, { timeout: 15_000 }).toContain('/97/2.mp3');
  await expect(status).not.toContainText(t('ar', 'audioUnavailable'));
  await expect(status).toHaveAttribute('data-reason', '');
  expect((await audioState(page))!.paused).toBe(true);
});

// QA v29 FIND-V: a paused reciter change made while offline. Play then says the device is offline
// (not "loading" for ever), and once back online Play starts the new reciter at the same ayah.
test('CN-22 (QA v29 FIND-V): after a paused reciter change made offline, play says offline, then plays the new reciter once online', async ({ page, context }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await seekTo(page, 3 * STEP + 500);
  await expect.poll(() => marked(page)).toEqual([4]);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  const status = page.locator('[data-audio-status]');
  await context.setOffline(true);
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-reciter-btn]').click();
  await expect(status).toHaveText(t('ar', 'audioOffline'));
  // Still offline: play gives the normal offline message, never the loading one.
  await page.click('[data-pause]');
  await expect(status).toHaveText(t('ar', 'audioOffline'));
  await page.waitForTimeout(800);
  await expect(status).not.toHaveText(t('ar', 'audioLoading'));
  await expect(status).not.toHaveAttribute('data-loading', '1');
  expect((await audioState(page))!.paused).toBe(true);
  // Back online: one press plays the new reciter from the same ayah.
  await context.setOffline(false);
  await page.click('[data-pause]');
  await expect.poll(async () => { const x = (await audioState(page))!; return x.src.includes('/97/2.mp3') && !x.paused && x.t >= 3 * STEP - 50 && x.t < 3 * STEP + 2500; }, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => marked(page)).toEqual([4]);
  await expect(status).not.toHaveText(t('ar', 'audioLoading'));
});

// QA v29 I-2: play pressed during a held reciter change that passes the 15 s give-up is not lost:
// when the reciter still arrives, it plays (as a plain start that arrives late does).
// D-164 A (kit v31, QA v30 FIND-AC): Hamzeh kept this behaviour. After the 15 s give-up the press is
// still kept: when the late reciter arrives it starts by itself, with no second press, and the
// "unavailable" message goes. This test is the record of that decision; no code changed for it.
test('CN-23 (QA v29 I-2, D-164 A): a play press during a held change that passes the give-up plays when the reciter arrives', async ({ page }) => {
  test.setTimeout(90_000);
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  await playSurah(page, 2);
  await page.click('[data-mini-toggle]');
  await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
  await page.route('**/api/audio', async (route) => { await new Promise((r) => setTimeout(r, 17_000)); await route.continue(); });
  const status = page.locator('[data-audio-status]');
  await page.locator('[data-reciter-btn]').click();
  await page.check('[data-reciter="97"]');
  await page.locator('[data-reciter-btn]').click();
  await page.waitForTimeout(1000);
  await page.click('[data-pause]');
  await expect(status).toHaveText(t('ar', 'audioLoading'));
  await expect(status).toContainText(t('ar', 'audioUnavailable'), { timeout: 17_000 });
  await expect.poll(async () => { const x = (await audioState(page))!; return x.src.includes('/97/2.mp3') && !x.paused; }, { timeout: 15_000 }).toBe(true);
  await expect(status).not.toContainText(t('ar', 'audioUnavailable'));
});
