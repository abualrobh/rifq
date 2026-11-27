// Kit v43 (part 1), in the browser, against the local Worker and the mock Quran Foundation API.
// - D-272 A (QA v42 FIND-CS): when the mini-player switches between its two layouts (text size,
//   screen width, turning the phone) while one of its buttons has keyboard or screen-reader focus,
//   focus moves to the same control in the new layout, or to "more" (one-row bar) where that control
//   is not there; "more" goes to play/pause in the two-row bar. Focus is never left on the page body.
// - D-279 (4) (QA v40 FIND-CJ, reopens D-262): the reader and home pages do not jump on load at large
//   text: the large-text class is set by the early inline script before the first paint (allowed by
//   its hash in the CSP; no 'unsafe-inline'), and the interface font is fetched early.
// Three sizes as in kit-v42.spec.ts: "normal" (100%), "text" (root font 200%, ROOT_200, checked to
// be 32 px) and "page" (200% page zoom: half the CSS width at device scale 2). Made-up data (the
// local mock and a made-up silent WAV). No Arabic characters and no Quran text in this file.
import type { Browser, Page } from '@playwright/test';
import { test, expect, surahs, hydrated, ROOT_200, rootFontPx, TIPS_SEEN_SCRIPT } from './helpers.ts';
import type { Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { audioState, serveAudio, STEP } from './audio-helpers.ts';

test.use({ allowHosts: [AUDIO_HOST] });

const LANGS: Lang[] = ['ar', 'en'];
const home = (l: Lang) => (l === 'ar' ? '/' : '/en/');
const P = (l: Lang, p: string) => home(l) + p;
const n = (s: number) => surahs[s - 1].items.length;
type Zoom = 'normal' | 'text' | 'page';

async function ctxFor(browser: Browser, kind: Zoom, w: number) {
  const pg = kind === 'page';
  const ctx = await browser.newContext({ viewport: { width: pg ? w / 2 : w, height: pg ? 422 : 844 }, deviceScaleFactor: pg ? 2 : 1, hasTouch: true, baseURL: 'http://127.0.0.1:8812' });
  if (kind === 'text') await ctx.addInitScript(ROOT_200);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  return { ctx, page, errs };
}
async function playSurah(page: Page) {
  await page.locator('[data-play-surah]').click();
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
  await expect(page.locator('[data-mini-player]')).toBeVisible();
}
const seekTo = (page: Page, ms: number) => page.evaluate((x) => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = x / 1000; }, ms);
// The data-mini-* key of the focused element, 'BODY' when focus fell to the page body.
const focusKey = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return 'BODY';
  const k = ['prev', 'toggle', 'next', 'more', 'go', 'close'].find((x) => el.hasAttribute(`data-mini-${x}`));
  return k ?? `${el.tagName}${el.closest('[data-mini-player]') ? ' in bar' : ''}`;
});
const focusOn = async (page: Page, key: string) => {
  await page.locator(`[data-mini-player] [data-mini-${key}]`).first().focus();
  expect(await focusKey(page)).toBe(key);
};
const big = (page: Page) => page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
const normal = (page: Page) => page.evaluate(() => { document.documentElement.style.fontSize = ''; });
const compact = (page: Page, on: boolean) => on ? expect(page.locator('[data-mini-player]')).toHaveAttribute('data-compact', '1') : expect(page.locator('[data-mini-player]')).not.toHaveAttribute('data-compact', '1');

for (const lang of LANGS) {
  test(`V43-01 (D-272 A, QA FIND-CS): text size changes with focus on a bar button keep focus on the same control (previous, play/pause, next), ${lang}`, async ({ browser }) => {
    const { ctx, page, errs } = await ctxFor(browser, 'normal', 390);
    await serveAudio(page, (s) => n(s) * STEP);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await playSurah(page);
    await seekTo(page, 2 * STEP + 500); // ayah 3: previous and next both enabled
    await expect(page.locator('[data-mini-prev]')).toBeEnabled();
    for (const key of ['toggle', 'prev', 'next']) {
      await compact(page, false);
      await focusOn(page, key);
      await big(page);
      await compact(page, true);
      expect(await focusKey(page), `${key}: two rows -> one row`).toBe(key);
      await normal(page);
      await compact(page, false);
      expect(await focusKey(page), `${key}: one row -> two rows`).toBe(key);
    }
    expect((await audioState(page))!.paused, 'the recitation keeps playing').toBe(false);
    expect(errs).toEqual([]);
    await ctx.close();
  });

  test(`V43-02 (D-272 A): go to and close (not in the one-row bar) go to "more"; "more" (not in the two-row bar) goes to play/pause; screen width and text size; ${lang}`, async ({ browser }) => {
    const { ctx, page, errs } = await ctxFor(browser, 'normal', 390);
    await serveAudio(page, (s) => n(s) * STEP);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await playSurah(page);
    // Go to -> narrower screen (one row): "more".
    await focusOn(page, 'go');
    await page.setViewportSize({ width: 320, height: 844 });
    await compact(page, true);
    expect(await focusKey(page), 'go to -> more').toBe('more');
    // More -> wider screen (two rows): play/pause.
    await page.setViewportSize({ width: 390, height: 844 });
    await compact(page, false);
    expect(await focusKey(page), 'more -> play/pause').toBe('toggle');
    // Close -> 200% text (one row): "more"; and the sheet is not opened by the move.
    await focusOn(page, 'close');
    await big(page);
    await compact(page, true);
    expect(await focusKey(page), 'close -> more').toBe('more');
    await expect(page.locator('dialog[data-mini-sheet]')).toHaveJSProperty('open', false);
    // Turning the phone: 844 x 390 landscape is wider; at 200% text it stays one row here, so the
    // same check is made by width only at 100%: more -> play/pause.
    await normal(page);
    await compact(page, false);
    expect(await focusKey(page), 'more -> play/pause (text size)').toBe('toggle');
    expect(errs).toEqual([]);
    await ctx.close();
  });

  test(`V43-03 (D-272 A): focus elsewhere on the page is not moved by a layout switch, ${lang}`, async ({ browser }) => {
    const { ctx, page, errs } = await ctxFor(browser, 'normal', 390);
    await serveAudio(page, (s) => n(s) * STEP);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await playSurah(page);
    await page.locator('li#a2 button.ayah-act').focus();
    await big(page);
    await compact(page, true);
    expect(await page.evaluate(() => !!document.activeElement?.matches('li#a2 button.ayah-act'))).toBe(true);
    await normal(page);
    await compact(page, false);
    expect(await page.evaluate(() => !!document.activeElement?.matches('li#a2 button.ayah-act'))).toBe(true);
    expect(errs).toEqual([]);
    await ctx.close();
  });
}

// D-279 (4): layout shift of the reader's and the home page's load, from the first paint until 2 s
// after the islands have loaded, tips already seen. 390 and 320 px, 100% and 200% text, 200% page
// zoom, Arabic and English: 0.1 or less (AC93). And the large-text class is on the root element
// before the body is parsed (so before the first paint), where the screen is less than 40 lines tall.
const CLS_SCRIPT = () => {
  const x = window as unknown as { __cls: number; __tallAtBody: boolean | null };
  x.__cls = 0; x.__tallAtBody = null;
  new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) x.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  const mo = new MutationObserver(() => { if (document.body && x.__tallAtBody === null) { x.__tallAtBody = document.documentElement.classList.contains('rifq-tall-text'); mo.disconnect(); } });
  mo.observe(document, { childList: true, subtree: true });
};
const CASES: [Zoom, number][] = [['normal', 390], ['normal', 320], ['text', 390], ['text', 320], ['page', 390], ['page', 320]];
for (const lang of LANGS) for (const route of ['2/', '']) {
  test(`V43-04 (D-279 (4), QA FIND-CJ, AC93): ${route ? 'reader' : 'home'} load layout shift 0.1 or less at 390/320 px, 100%/200% text and 200% page zoom; large-text class before the first paint; ${lang}`, async ({ browser }, info) => {
    test.setTimeout(180_000);
    const out: Record<string, { cls: number; tallAtBody: boolean | null }> = {};
    for (const [kind, w] of CASES) {
      const { ctx, page, errs } = await ctxFor(browser, kind, w);
      await ctx.addInitScript(TIPS_SEEN_SCRIPT);
      await page.addInitScript(CLS_SCRIPT);
      await page.goto(P(lang, route));
      await hydrated(page);
      if (kind === 'text') expect(await rootFontPx(page), 'root font really at 200%').toBe(32);
      await page.waitForTimeout(2000);
      const r = await page.evaluate(() => { const x = window as unknown as { __cls: number; __tallAtBody: boolean | null }; return { cls: Math.round(x.__cls * 10000) / 10000, tallAtBody: x.__tallAtBody, tall: document.documentElement.classList.contains('rifq-tall-text') }; });
      const tag = `${kind} ${w}`;
      out[tag] = { cls: r.cls, tallAtBody: r.tallAtBody };
      // 844 px tall at 100% is 52 lines: no class; 200% text or page zoom: 26 lines: the class.
      expect(r.tall, `${tag}: large-text class after load`).toBe(kind !== 'normal');
      expect(r.tallAtBody, `${tag}: the class is already right when the body starts (before the first paint)`).toBe(kind !== 'normal');
      expect(r.cls, `${tag}: layout shift`).toBeLessThanOrEqual(0.1);
      expect(errs, tag).toEqual([]);
      await ctx.close();
    }
    info.annotations.push({ type: 'cls', description: JSON.stringify(out) });
  });
}
