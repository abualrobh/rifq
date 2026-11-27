// Kit v42, in the browser, against the local Worker and the mock Quran Foundation API.
// - D-270 A (V41-H1): at large text the mini-player is one row (previous ayah, play/pause, next ayah,
//   "more"); "more" opens a sheet with the reciter, the short credit (D-268 A), go to the playing
//   ayah, close and the source details. "Large text" is measured (MiniPlayer.tsx compactNow): less
//   than 22rem of screen width, or html.rifq-tall-text on a phone-width page.
// - D-267 A (QA FIND-CO): the source details table never makes a page scroll sideways; its columns
//   stack where the panel is narrow for its text.
// Three sizes: "normal" (100%), "text" (root font 200%, browser text zoom, ROOT_200, checked to be
// 32 px) and "page" (Safari aA page zoom 200%: half the CSS width at device scale 2). Touch is
// emulated (hasTouch, taps). Made-up data (the local mock and a made-up silent WAV). No Arabic
// characters and no Quran text in this file: expected text comes from strings.ts and the mock.
// Figures for the hand-back (the fixed bottom area) go to test-info annotations.
import type { Browser, Page } from '@playwright/test';
import { test, expect, surahs, hydrated, ROOT_200, rootFontPx } from './helpers.ts';
import { t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { AR_WORD, MOCK_RECITER_NAMES } from '../mock/qf-mock.ts';
import { audioState, serveAudio, STEP } from './audio-helpers.ts';

test.use({ allowHosts: [AUDIO_HOST] });

const LANGS: Lang[] = ['ar', 'en'];
const home = (l: Lang) => (l === 'ar' ? '/' : '/en/');
const P = (l: Lang, p: string) => home(l) + p;
const n = (s: number) => surahs[s - 1].items.length;
const len = (s: number) => n(s) * STEP;
const name7 = (l: Lang) => (l === 'ar' ? AR_WORD(7) : MOCK_RECITER_NAMES[7]);
type Zoom = 'normal' | 'text' | 'page';
// [kind, phone width]: "page" uses half the phone's width in CSS pixels at device scale 2.
const SIZES: [Zoom, number][] = [['normal', 390], ['normal', 320], ['text', 390], ['text', 320], ['page', 390], ['page', 320]];
const LARGE: [Zoom, number][] = [['text', 390], ['text', 320], ['page', 390], ['page', 320]];

async function ctxFor(browser: Browser, kind: Zoom, w: number) {
  const page2 = kind === 'page';
  const ctx = await browser.newContext({ viewport: { width: page2 ? w / 2 : w, height: page2 ? 422 : 844 }, deviceScaleFactor: page2 ? 2 : 1, hasTouch: true, baseURL: 'http://127.0.0.1:8812' });
  if (kind === 'text') await ctx.addInitScript(ROOT_200);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await serveAudio(page, len);
  return { ctx, page, errs };
}
async function open(page: Page, kind: Zoom, url: string) {
  await page.goto(url);
  await hydrated(page);
  if (kind === 'text') expect(await rootFontPx(page), 'root font really at 200%').toBe(32);
}
async function playSurah(page: Page) {
  await page.locator('[data-play-surah]').click();
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
  await expect(page.locator('[data-mini-player]')).toBeVisible();
}
const seekTo = (page: Page, ms: number) => page.evaluate((x) => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = x / 1000; }, ms);

// The fixed bottom area (tab bar and mini-player) in screen pixels of the phone.
const bottomArea = (page: Page, kind: Zoom) => page.evaluate((f) => {
  const bar = document.querySelector('nav[data-tabbar="bottom"]')!.getBoundingClientRect();
  const m = document.querySelector('[data-mini-player]')?.getBoundingClientRect();
  const top = m && m.height ? Math.min(m.top, bar.top) : bar.top;
  return { tabbar: Math.round(bar.height * f), mini: m ? Math.round(m.height * f) : 0, bottom: Math.round((innerHeight - top) * f), screen: Math.round(innerHeight * f) };
}, kind === 'page' ? 2 : 1);

// The mini-player's controls: rows (distinct tops), sizes, gaps and order.
const barFacts = (page: Page) => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('[data-mini-player]')!;
  const ctl = [...box.querySelectorAll<HTMLElement>('button, a')].filter((e) => e.getClientRects().length > 0 && !e.closest('dialog'));
  const r = ctl.map((e) => ({ k: Object.keys(e.dataset).find((x) => x.startsWith('mini')) ?? '', ...JSON.parse(JSON.stringify(e.getBoundingClientRect())) as DOMRect }));
  let gap = Infinity;
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const A = r[i], B = r[j]; gap = Math.min(gap, Math.max(B.left - A.right, A.left - B.right, B.top - A.bottom, A.top - B.bottom)); }
  const cs = getComputedStyle(box);
  const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return {
    compact: box.dataset.compact === '1', keys: r.map((x) => x.k), rows: new Set(r.map((x) => Math.round(x.top))).size,
    minW: Math.min(...r.map((x) => x.width)), minH: Math.min(...r.map((x) => x.height)), gap, avail,
    lefts: Object.fromEntries(r.map((x) => [x.k, Math.round(x.left)])),
    off: r.some((x) => x.left < -0.5 || x.right > innerWidth + 0.5), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize), tall: document.documentElement.classList.contains('rifq-tall-text'),
    creditShown: !!box.querySelector('[data-mini-credit]') && box.querySelector<HTMLElement>('[data-mini-credit]')!.getClientRects().length > 0 && !box.querySelector('[data-mini-credit]')!.closest('dialog'),
  };
});

for (const lang of LANGS) {
  test(`V42-01 (D-270 A, D-207 B): at large text the mini-player is one row: previous, play/pause, next and more, 44 px tall, 8 px apart, mirrored in Arabic; no sideways scroll; ${lang}`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    for (const [kind, w] of LARGE) {
      const { ctx, page, errs } = await ctxFor(browser, kind, w);
      const tag = `${kind} ${w}`;
      await open(page, kind, P(lang, '2/'));
      await playSurah(page);
      await page.waitForTimeout(300);
      const f = await barFacts(page);
      expect(f.compact, tag).toBe(true);
      expect(f.keys, `${tag}: the controls in the bar, in order`).toEqual(['miniPrev', 'miniToggle', 'miniNext', 'miniMore']);
      expect(f.rows, `${tag}: one row`).toBe(1);
      expect(f.minH, `${tag}: 44 px tall`).toBeGreaterThanOrEqual(44);
      expect(f.gap, `${tag}: 8 px apart`).toBeGreaterThanOrEqual(7.5);
      // 44 px wide where four 44 px buttons and three 8 px gaps fit; otherwise they share the width
      // equally and never get narrower than 24 px (WCAG 2.5.8).
      if (f.avail >= 4 * 44 + 3 * 8) expect(f.minW, `${tag}: 44 px wide`).toBeGreaterThanOrEqual(44);
      else { expect(f.minW, `${tag}: shared width`).toBeGreaterThanOrEqual(Math.floor((f.avail - 3 * 8) / 4) - 1); expect(f.minW).toBeGreaterThanOrEqual(24); }
      // The reading direction: previous at the start, more at the end (Arabic: right to left).
      const L = f.lefts;
      if (lang === 'ar') expect(L.miniPrev > L.miniToggle && L.miniToggle > L.miniNext && L.miniNext > L.miniMore, `${tag}: mirrored`).toBe(true);
      else expect(L.miniPrev < L.miniToggle && L.miniToggle < L.miniNext && L.miniNext < L.miniMore, tag).toBe(true);
      expect(f.off, tag).toBe(false);
      expect(f.sw, `${tag}: no sideways scroll`).toBeLessThanOrEqual(f.cw);
      expect(f.creditShown, `${tag}: the credit is in "more", not in the bar`).toBe(false);
      // Screen reader names: the existing names, and "more" says it opens a dialog.
      const more = page.locator('[data-mini-more]');
      await expect(more).toHaveAttribute('aria-label', t(lang, 'miniMore'));
      await expect(more).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-mini-prev]')).toHaveAttribute('aria-label', t(lang, 'prevAyah'));
      await expect(page.locator('[data-mini-next]')).toHaveAttribute('aria-label', t(lang, 'nextAyah'));
      await expect(page.locator('[data-mini-player]')).toHaveAttribute('aria-label', t(lang, 'miniRegion'));
      // D-207 B: previous disabled at the first ayah, next at the last; they move the recitation.
      await expect(page.locator('[data-mini-prev]')).toBeDisabled();
      await page.locator('[data-mini-next]').tap();
      await expect.poll(async () => (await audioState(page))!.t).toBeGreaterThanOrEqual(STEP - 100);
      await expect(page.locator('[data-mini-prev]')).toBeEnabled();
      await seekTo(page, (n(2) - 1) * STEP + 500);
      await expect(page.locator('[data-mini-next]')).toBeDisabled();
      const busy = await bottomArea(page, kind);
      info.annotations.push({ type: 'bottom-area', description: `${lang} ${tag}: ${JSON.stringify(busy)} bar ${JSON.stringify({ avail: Math.round(f.avail), minW: Math.round(f.minW), rem: f.rem, tall: f.tall })}` });
      expect(errs, tag).toEqual([]);
      await ctx.close();
    }
  });

  test(`V42-02 (D-270 A, D-268 A): at normal sizes the mini-player is as in kit v41 (two rows, go to and close in the bar, the credit shown); the switch follows the measured fit; ${lang}`, async ({ browser }, info) => {
    test.setTimeout(120_000);
    for (const [kind, w] of [['normal', 390], ['normal', 320]] as [Zoom, number][]) {
      const { ctx, page, errs } = await ctxFor(browser, kind, w);
      await open(page, kind, P(lang, '2/'));
      await playSurah(page);
      await page.waitForTimeout(300);
      const f = await barFacts(page);
      // The measured rule: one row exactly when the screen is narrower than 22rem (or tall text).
      expect(f.compact, `${w}`).toBe(f.cw < 22 * f.rem || f.tall);
      if (!f.compact) {
        expect(f.keys).toEqual(['miniPrev', 'miniToggle', 'miniNext', 'miniGo', 'miniClose']);
        expect(f.rows, `${w}: the kit v41 bar fits its two rows`).toBeLessThanOrEqual(2);
        expect(f.creditShown).toBe(true);
        await expect(page.locator('[data-mini-reciter]')).toHaveText(name7(lang));
        await expect(page.locator('[data-mini-label]')).toBeVisible();
        await expect(page.locator('[data-mini-more]')).toHaveCount(0);
        expect(f.minW).toBeGreaterThanOrEqual(44);
      }
      info.annotations.push({ type: 'bottom-area', description: `${lang} ${kind} ${w}: compact ${f.compact}, rows ${f.rows}, ${JSON.stringify(await bottomArea(page, kind))}` });
      expect(errs).toEqual([]);
      await ctx.close();
    }
  });

  test(`V42-03 (D-270 A, D-268 A, D-128): "more" opens a sheet with the credit, go to the playing ayah, close and the source details; focus moves in and back; Esc, the close button and the dimmed area close it; ${lang}`, async ({ browser }) => {
    test.setTimeout(180_000);
    for (const [kind, w] of [['text', 390], ['page', 390]] as [Zoom, number][]) {
      const { ctx, page, errs } = await ctxFor(browser, kind, w);
      const tag = `${kind} ${w}`;
      await open(page, kind, P(lang, '2/'));
      await playSurah(page);
      await seekTo(page, 4 * STEP + 500);
      const more = page.locator('[data-mini-more]');
      const sheet = page.locator('dialog[data-mini-sheet]');
      await more.tap();
      await expect(sheet).toHaveJSProperty('open', true);
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(sheet).toHaveAttribute('aria-labelledby', 'mini-sheet-h');
      await expect(sheet.locator('#mini-sheet-h')).toHaveText(t(lang, 'miniMore'));
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-more-title')), `${tag}: focus on the heading`).toBe(true);
      // D-268 A: the short credit names the reciter and Quran Foundation.
      await expect(sheet.locator('[data-mini-reciter]')).toHaveText(name7(lang));
      await expect(sheet.locator('[data-mini-credit]')).toHaveText('Quran Foundation');
      await expect(sheet.locator('.more-credit')).toBeVisible();
      await expect(sheet.locator('[data-more-now] [data-mini-ayah]')).toHaveText(t(lang, 'audioNowAyah', { a: 5 }));
      // Go to and close, with the existing strings as their visible text.
      await expect(sheet.locator('[data-mini-go]')).toHaveText(t(lang, 'miniGo', { s: 2, a: 5 }));
      await expect(sheet.locator('[data-mini-close]')).toHaveText(t(lang, 'miniClose'));
      // The reciter button's source details, the same table (D-253: licence without a date).
      await expect(sheet.locator('[data-audio-source]')).toBeVisible();
      await expect(sheet.locator('[data-audio-source] dd').first()).toHaveText(name7(lang));
      await expect(sheet.locator('[data-audio-source] dd').last()).toHaveText(t(lang, 'audioLicence'));
      for (const b of await sheet.locator('button, a').all()) { const bb = (await b.boundingBox())!; expect(bb.height, `${tag}: 44 px`).toBeGreaterThanOrEqual(44); }
      const fit = await page.evaluate(() => { const d = document.querySelector('dialog[data-mini-sheet]')!.getBoundingClientRect(); const i = document.querySelector('dialog[data-mini-sheet] .sheet-in')!; return { l: d.left, r: d.right, t: d.top, iw: innerWidth, ih: innerHeight, isw: i.scrollWidth, icw: i.clientWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
      expect(fit.l, tag).toBeGreaterThanOrEqual(0);
      expect(fit.r, tag).toBeLessThanOrEqual(fit.iw + 0.5);
      expect(fit.t, tag).toBeGreaterThanOrEqual(0);
      expect(fit.isw, `${tag}: nothing sideways in the sheet`).toBeLessThanOrEqual(fit.icw);
      expect(fit.sw, tag).toBeLessThanOrEqual(fit.cw);
      // Tab stays inside.
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[data-mini-sheet]')), `${tag}: Tab ${i}`).toBe(true); }
      // Esc closes; focus back on more.
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveJSProperty('open', false);
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-mini-more'))).toBe(true);
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      // The close button.
      await more.tap();
      await expect(sheet).toHaveJSProperty('open', true);
      await sheet.locator('[data-more-close]').tap();
      await expect(sheet).toHaveJSProperty('open', false);
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-mini-more'))).toBe(true);
      // A tap on the dimmed area above the sheet.
      await more.tap();
      await expect(sheet).toHaveJSProperty('open', true);
      await page.touchscreen.tap(page.viewportSize()!.width / 2, 5);
      await expect(sheet).toHaveJSProperty('open', false);
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-mini-more'))).toBe(true);
      // Still playing all along.
      expect((await audioState(page))!.paused).toBe(false);
      // Go to the playing ayah (this page): the sheet closes and the ayah has focus.
      await page.evaluate(() => scrollTo(0, 0));
      await more.tap();
      await sheet.locator('[data-mini-go]').tap();
      await expect(sheet).toHaveJSProperty('open', false);
      await expect(page.locator('li#a5')).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('a5');
      // Go to from another page: the reader opens in place, the recitation goes on.
      await page.locator('nav[data-tabbar="bottom"] a[data-tab="saved"]').tap();
      await expect(page).toHaveURL(/saved\/$/);
      await hydrated(page);
      if (kind === 'text') expect(await rootFontPx(page)).toBe(32);
      await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-compact', '1');
      await page.locator('[data-mini-more]').tap();
      await page.locator('dialog[data-mini-sheet] [data-mini-go]').tap();
      await expect(page).toHaveURL(new RegExp(`/2/#a\\d+$`));
      expect((await audioState(page))!.paused).toBe(false);
      // Close (D-128) from the sheet: the player goes and focus is on the page, not on a removed control.
      await page.locator('[data-mini-more]').tap();
      await page.locator('dialog[data-mini-sheet] [data-mini-close]').tap();
      await expect(page.locator('[data-mini-player]')).toHaveCount(0);
      expect((await audioState(page))!.paused).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('content');
      expect(errs, tag).toEqual([]);
      await ctx.close();
    }
  });
}

test('V42-04 (D-270 A, RQ-006 AC28): with the one-row bar the lock-screen previous and next ayah still work, and the bar follows them', async ({ browser }) => {
  const { ctx, page, errs } = await ctxFor(browser, 'text', 390);
  await ctx.addInitScript(() => {
    const w = window as unknown as { __h: Record<string, ((d: unknown) => void) | null> };
    w.__h = {};
    const orig = MediaSession.prototype.setActionHandler;
    MediaSession.prototype.setActionHandler = function (this: MediaSession, a: MediaSessionAction, h: MediaSessionActionHandler | null) { w.__h[a] = h as never; return orig.call(this, a, h); };
  });
  await open(page, 'text', '/en/2/');
  await playSurah(page);
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-compact', '1');
  const kinds = await page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as { __h: Record<string, unknown> }).__h).map(([k, v]) => [k, v === null ? 'null' : typeof v])));
  expect(kinds).toMatchObject({ previoustrack: 'function', nexttrack: 'function', seekbackward: 'null', seekforward: 'null', play: 'function', pause: 'function' });
  const press = (a: string) => page.evaluate((x) => (window as unknown as { __h: Record<string, (d: unknown) => void> }).__h[x]({ action: x }), a);
  await press('nexttrack');
  await press('nexttrack');
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-a', '3');
  await expect(page.locator('[data-mini-prev]')).toBeEnabled();
  await press('previoustrack');
  await expect(page.locator('[data-mini-player]')).toHaveAttribute('data-a', '2');
  await press('pause');
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('[data-mini-toggle]')).toHaveAttribute('aria-label', t('en', 'miniPlay', { s: 2, a: 2 }));
  expect(errs).toEqual([]);
  await ctx.close();
});

test('V42-05 (D-270 A): the bar changes layout with the text size and screen width, without a reload; an open sheet closes when the bar becomes two rows, with focus on play/pause', async ({ browser }) => {
  const { ctx, page, errs } = await ctxFor(browser, 'normal', 390);
  await open(page, 'normal', '/2/');
  await playSurah(page);
  const mini = page.locator('[data-mini-player]');
  await expect(mini).not.toHaveAttribute('data-compact', '1');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(mini).toHaveAttribute('data-compact', '1');
  await page.locator('[data-mini-more]').tap();
  await expect(page.locator('dialog[data-mini-sheet]')).toHaveJSProperty('open', true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await expect(mini).not.toHaveAttribute('data-compact', '1');
  await expect(page.locator('dialog[data-mini-sheet]')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-mini-toggle'))).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(mini).toHaveAttribute('data-compact', '1');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mini).not.toHaveAttribute('data-compact', '1');
  expect((await audioState(page))!.paused).toBe(false);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('V42-06 (D-270 A, QA v38 FIND-BW): with the one-row bar the loading line shows under the row, where the reader is', async ({ browser }) => {
  const { ctx, page, errs } = await ctxFor(browser, 'page', 390);
  await page.route('**/api/audio', async (r) => { await new Promise((ok) => setTimeout(ok, 3500)); await r.continue(); });
  await open(page, 'page', '/2/#a200');
  await page.locator('li#a200 button.ayah-act').click();
  await page.locator('dialog[data-ayah-panel] [data-act-play-from]').click();
  const mini = page.locator('[data-mini-player]');
  await expect(mini).toHaveAttribute('data-loading', '1');
  await expect(mini).toHaveAttribute('data-compact', '1');
  const cue = mini.locator('[data-mini-state="loading"]');
  await expect(cue).toHaveText(t('ar', 'audioLoading'));
  await expect(cue).toBeInViewport();
  const rows = await page.evaluate(() => { const r = document.querySelector('[data-mini-row]')!.getBoundingClientRect(); const c = document.querySelector('[data-mini-state="loading"]')!.getBoundingClientRect(); return { below: c.top >= r.bottom - 0.5 }; });
  expect(rows.below).toBe(true);
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused; }, { timeout: 10_000 }).toBe(true);
  await expect(mini.locator('[data-mini-state]')).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

for (const lang of LANGS) {
  test(`V42-07 (D-267 A, QA FIND-CO, D-270 A): no sideways scroll at 390 and 320 px, 100% and 200% text and 200% page zoom, with the reciter panel or the more sheet open; the source details stack at large text; ${lang}`, async ({ browser }, info) => {
    test.setTimeout(300_000);
    const out: string[] = [];
    for (const [kind, w] of SIZES) {
      const { ctx, page, errs } = await ctxFor(browser, kind, w);
      const tag = `${kind} ${w}`;
      const sw = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      for (const p of ['', '2/', 'tafseer/2/', 'saved/', 'settings/', 'surahs/', 'search/', 'privacy/']) {
        await open(page, kind, P(lang, p));
        const r = await sw();
        expect(r.sw, `${tag} /${p}`).toBeLessThanOrEqual(r.cw);
      }
      // The reader with the reciter panel open (FIND-CO).
      await open(page, kind, P(lang, '2/'));
      await page.locator('[data-reciter-btn]').tap();
      const src = page.locator('[data-audio-player] [data-audio-source]');
      await expect(src).toBeVisible();
      const panel = await page.evaluate(() => {
        const dl = document.querySelector('[data-audio-player] [data-audio-source]')!;
        const dt = dl.querySelector('dt')!.getBoundingClientRect(), dd = dl.querySelector('dd')!.getBoundingClientRect(), b = dl.getBoundingClientRect();
        const cells = [...dl.children].map((c) => c.getBoundingClientRect());
        return { stacked: dd.top >= dt.bottom - 0.5, outside: cells.some((c) => c.left < b.left - 0.5 || c.right > b.right + 0.5), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      expect(panel.sw, `${tag}: reciter panel open`).toBeLessThanOrEqual(panel.cw);
      expect(panel.outside, `${tag}: every cell inside the table`).toBe(false);
      // Stacked at large text; two columns at 100% on these phones.
      expect(panel.stacked, `${tag}: stacked`).toBe(kind !== 'normal');
      // The bar and, where it is one row, the more sheet.
      await page.locator('[data-reciter-btn]').tap();
      await playSurah(page);
      let r = await sw();
      expect(r.sw, `${tag}: playing`).toBeLessThanOrEqual(r.cw);
      if (await page.locator('[data-mini-more]').count()) {
        await page.locator('[data-mini-more]').tap();
        await expect(page.locator('dialog[data-mini-sheet] [data-audio-source]')).toBeVisible();
        const s = await page.evaluate(() => { const i = document.querySelector('dialog[data-mini-sheet] .sheet-in')!; const dl = i.querySelector('[data-audio-source]')!; const dt = dl.querySelector('dt')!.getBoundingClientRect(), dd = dl.querySelector('dd')!.getBoundingClientRect(); return { isw: i.scrollWidth, icw: i.clientWidth, stacked: dd.top >= dt.bottom - 0.5 }; });
        expect(s.isw, `${tag}: sheet`).toBeLessThanOrEqual(s.icw);
        if (kind !== 'normal') expect(s.stacked, `${tag}: sheet table stacked`).toBe(true);
        r = await sw();
        expect(r.sw, `${tag}: sheet open`).toBeLessThanOrEqual(r.cw);
        await page.keyboard.press('Escape');
      }
      out.push(`${tag}: stacked ${panel.stacked}`);
      expect(errs, tag).toEqual([]);
      await ctx.close();
    }
    info.annotations.push({ type: 'source-details', description: `${lang} ${out.join('; ')}` });
  });
}

test('V42-08 (AC93 P-17, D-270 A): layout shift when the bar appears and the sheet opens and closes, at 100% and 200%, is 0.1 or less (counted after the page has loaded: the reader load at 200% is FIND-CJ, D-262)', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const out: Record<string, number> = {};
  for (const lang of LANGS) for (const [kind, w] of [['normal', 390], ['text', 390], ['text', 320], ['page', 390]] as [Zoom, number][]) {
    const { ctx, page, errs } = await ctxFor(browser, kind, w);
    await page.addInitScript(() => { const x = window as unknown as { __cls: number }; x.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) x.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    await open(page, kind, P(lang, '2/'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0; scrollTo(0, 1500); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0; });
    // Play from the ayah panel (the reader stays where it is), then the sheet, then the reciter panel.
    const a = await page.evaluate(() => { for (const el of document.querySelectorAll<HTMLElement>('li.ayah-row')) if (el.getBoundingClientRect().top > 80) return Number(el.dataset.a); return 10; });
    await page.locator(`li#a${a} button.ayah-act`).click();
    await page.locator('dialog[data-ayah-panel] [data-act-play-from]').click();
    await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused; }).toBe(true);
    await page.waitForTimeout(800);
    if (await page.locator('[data-mini-more]').count()) {
      await page.locator('[data-mini-more]').tap();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    out[`${lang} ${kind} ${w}`] = Math.round(cls * 10000) / 10000;
    expect(cls, `${lang} ${kind} ${w}`).toBeLessThanOrEqual(0.1);
    expect(errs).toEqual([]);
    await ctx.close();
  }
  info.annotations.push({ type: 'cls', description: JSON.stringify(out) });
});
