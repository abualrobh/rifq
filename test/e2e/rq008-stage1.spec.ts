// RQ-008 v1.0 stage 1 (kit v37): tab bar (AC1 to AC8), home (AC9 to AC21), Saved screen (AC22 to
// AC25), Settings screen (AC70 to AC78) and the cross-cutting criteria that apply to them (AC86 to
// AC97). Arabic and English, light and dark, 390 and 1280 px, keyboard and screen reader basics,
// blocked storage. Every test uses a disposable profile and made-up references (surah and ayah
// numbers only); each removal goes through the product and is logged (D-051). No Arabic characters
// and no Quran text in this file: names and expected strings come from the source and strings.ts.
// RIFQ_SHOTS (private folder, optional): R8-SHOTS writes screenshots of each new screen there.
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, surahs, src, MOBILE, DESKTOP, hydrated, noOverflow, logRemoval, topAyah } from './helpers.ts';
import { juzStarts } from '../../src/core/source-adapter.ts';
import { t, type Lang } from '../../src/core/strings.ts';

type L = Lang;
const LANGS: L[] = ['ar', 'en'];
const home = (l: L) => (l === 'ar' ? '/' : '/en/');
const P = (l: L, p: string) => home(l) + p;
const nameOf = (l: L, s: number) => (l === 'ar' ? surahs[s - 1].ar : surahs[s - 1].en);
const juz = juzStarts(src.list);
const counts = [0, ...surahs.map((s) => s.items.length)];
const TAB_KEYS = ['tabHome', 'tabRead', 'searchButton', 'tabSaved', 'tabSettings'] as const;
const TAB_IDS = ['home', 'read', 'search', 'saved', 'settings'];
// Made-up device data: references only.
const seed = (ctx: BrowserContext, kv: Record<string, unknown>) => ctx.addInitScript((x) => {
  if (sessionStorage.getItem('r8seeded')) return;
  for (const [k, v] of Object.entries(x)) localStorage.setItem(k, JSON.stringify(v));
  sessionStorage.setItem('r8seeded', '1');
}, kv);
const blockStorage = (page: Page) => page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); });
const bottomBar = (page: Page) => page.locator('nav[data-tabbar="bottom"]');
const topBar = (page: Page) => page.locator('nav[data-tabbar="top"]');
const visibleBar = (page: Page) => page.locator('nav[data-tabbar]:visible');
const store = (page: Page, k: string) => page.evaluate((key) => localStorage.getItem(key), k);
const ratio = (a: number[], b: number[]) => {
  const lum = (c: number[]) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

// Pages a reader can open, with the tab that must be current there (AC2; none on privacy and 404).
const PAGES: [string, string | null][] = [['', 'home'], ['surahs/', 'home'], ['2/', 'read'], ['tafseer/2/#a3', 'read'], ['search/', 'search'], ['saved/', 'saved'], ['settings/', 'settings'], ['privacy/', null]];

for (const lang of LANGS) {
  test(`R8-01 (AC1, AC2, AC4): phone tab bar on every reader page, five items in order, current item, 44 px, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    // RIFQ's 404 page is one Arabic page (with an English line), so its bar is checked in Arabic only.
    for (const [path, cur] of [...PAGES, ...(lang === 'ar' ? [['no-such-page/', null] as [string, null]] : [])]) {
      await page.goto(P(lang, path));
      const bar = bottomBar(page);
      await expect(bar, path).toBeVisible();
      await expect(topBar(page)).toBeHidden();
      await expect(bar).toHaveAttribute('aria-label', t(lang, 'tabBarLabel'));
      expect(await bar.evaluate((n) => n.tagName)).toBe('NAV');
      const links = bar.locator('a[data-tab]');
      await expect(links).toHaveCount(5);
      expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('data-tab')))).toEqual(TAB_IDS);
      expect(await links.evaluateAll((as) => as.map((a) => a.textContent?.trim()))).toEqual(TAB_KEYS.map((k) => t(lang, k)));
      // Reading direction: Home is on the right in Arabic and on the left in English.
      const xs = await links.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().left));
      const sorted = [...xs].sort((a, b) => a - b);
      expect(xs, `${path} order`).toEqual(lang === 'ar' ? [...sorted].reverse() : sorted);
      for (const box of await links.evaluateAll((as) => as.map((a) => { const r = a.getBoundingClientRect(); return [r.width, r.height]; }))) {
        expect(box[0]).toBeGreaterThanOrEqual(44); expect(box[1]).toBeGreaterThanOrEqual(44);
      }
      const current = await links.evaluateAll((as) => as.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('data-tab')));
      expect(current, path).toEqual(cur ? [cur] : []);
      if (cur) {
        // Not colour alone: the current label is bold and has an indicator bar.
        const cue = await bar.locator('a[aria-current="page"]').evaluate((a) => ({ w: getComputedStyle(a).fontWeight, bar: getComputedStyle(a, '::before').content }));
        expect(Number(cue.w)).toBeGreaterThanOrEqual(700);
        expect(cue.bar).not.toBe('none');
      }
      // The bar sits at the bottom of the screen; each item is a plain link.
      const r = await bar.boundingBox();
      expect(Math.round(r!.y + r!.height)).toBe(MOBILE.height);
      for (const h of await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(h).toMatch(/^\//);
    }
  });

  test(`R8-02 (AC8, D-179 A): from 52rem the five items are a row in the header; no bottom bar; side index kept, ${lang}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    for (const [path, cur] of PAGES) {
      await page.goto(P(lang, path));
      await expect(bottomBar(page)).toBeHidden();
      const bar = topBar(page);
      await expect(bar).toBeVisible();
      expect(await bar.evaluate((n) => !!n.closest('header.site-header'))).toBe(true);
      const links = bar.locator('a[data-tab]');
      expect(await links.evaluateAll((as) => as.map((a) => a.textContent?.trim()))).toEqual(TAB_KEYS.map((k) => t(lang, k)));
      const boxes = await links.evaluateAll((as) => as.map((a) => { const r = a.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }));
      for (const b of boxes) { expect(b[2]).toBeGreaterThanOrEqual(44); expect(b[3]).toBeGreaterThanOrEqual(44); expect(Math.abs(b[1] - boxes[0][1])).toBeLessThan(2); }
      const xs = boxes.map((b) => b[0]);
      const sorted = [...xs].sort((a, b) => a - b);
      expect(xs).toEqual(lang === 'ar' ? [...sorted].reverse() : sorted);
      expect(await links.evaluateAll((as) => as.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('data-tab')))).toEqual(cur ? [cur] : []);
      await expect(page.locator('nav[data-tabbar]:visible')).toHaveCount(1);
      await noOverflow(page);
    }
    await page.goto(P(lang, '2/'));
    await expect(page.locator('[data-reader-side]')).toBeVisible();
  });

  test(`R8-03 (AC3, D-180 A): Read opens the last reading position, else the surah index, ${lang}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(home(lang));
    await hydrated(page);
    const read = bottomBar(page).locator('a[data-tab="read"]');
    await expect(read).toHaveAttribute('href', P(lang, 'surahs/'));
    await read.click();
    await expect(page).toHaveURL(new RegExp(P(lang, 'surahs/') + '$'));
    // A saved position in the source: Read opens it (in place, the reader at that ayah).
    await page.evaluate(() => localStorage.setItem('rifq.saves', '{"v":1,"b":[],"l":[2,40]}'));
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    await expect(bottomBar(page).locator('a[data-tab="read"]')).toHaveAttribute('href', P(lang, '2/#a40'));
    await bottomBar(page).locator('a[data-tab="read"]').click();
    await expect(page).toHaveURL(new RegExp(P(lang, '2/#a40') + '$'));
    await expect(page.locator('#a40')).toBeInViewport();
    // A saved position that is not in this build's source: the index.
    const p2 = await context.newPage();
    await p2.setViewportSize(MOBILE);
    await p2.addInitScript((c) => localStorage.setItem('rifq.saves', JSON.stringify({ v: 1, b: [], l: [2, c + 1] })), counts[2]);
    await p2.goto(home(lang));
    await hydrated(p2);
    await expect(bottomBar(p2).locator('a[data-tab="read"]')).toHaveAttribute('href', P(lang, 'surahs/'));
  });
}

test('R8-04 (AC4, AC97): without JavaScript the tab bar is plain links; development pages have no tab bar', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
  const page = await ctx.newPage();
  await page.goto('/saved/');
  const links = bottomBar(page).locator('a[data-tab]');
  await expect(links).toHaveCount(5);
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(['/', '/surahs/', '/search/', '/saved/', '/settings/']);
  await links.nth(4).click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await expect(page.locator('h1')).toHaveText(t('ar', 'tabSettings'));
  await ctx.close();
});

test('R8-04b (AC97): development pages are unchanged: no tab bar, no in-place router', async ({ request }) => {
  for (const p of ['/dev/verify-text/', '/dev/font-check/', '/dev/quote-check/', '/dev/tafseer-en-coverage/']) {
    const r = await request.get(p);
    if (r.status() !== 200) continue;
    const html = await r.text();
    expect(html.includes('data-tabbar'), p).toBe(false);
    expect(html.includes('name="rifq-page"'), p).toBe(false);
    expect(html.includes('tabbar.ts') || /client\/tabbar/.test(html), p).toBe(false);
  }
});

for (const lang of LANGS) {
  test(`R8-05 (AC6, AC7, AC92): nothing hidden behind the tab bar; 320 px and 5 text sizes without horizontal scroll, ${lang}`, async ({ page, context }) => {
    await seed(context, { 'rifq.saves': { v: 1, b: [[2, 255], [18, 10], [36, 1]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2, 1] } });
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 700 });
      for (const path of ['', 'saved/', 'settings/', 'search/', '2/', 'privacy/']) {
        for (const size of [1.25, 2.5]) {
          await page.evaluate((s) => localStorage.setItem('rifq.settings', JSON.stringify({ size: s })), size).catch(() => undefined);
          await page.goto(P(lang, path));
          await hydrated(page).catch(() => undefined);
          await noOverflow(page);
          await page.waitForTimeout(300);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(200);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(100);
          const bar = await bottomBar(page).boundingBox();
          const priv = await page.locator('[data-privacy-link]').boundingBox();
          expect(priv!.y + priv!.height, `${path} privacy link above the tab bar`).toBeLessThanOrEqual(bar!.y + 1);
          const tabLabels = await bottomBar(page).locator('.tab-label').evaluateAll((ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return [r.left, r.right]; }));
          for (let i = 1; i < tabLabels.length; i++) expect(Math.min(tabLabels[i][1], tabLabels[i - 1][1]) - Math.max(tabLabels[i][0], tabLabels[i - 1][0]), 'labels do not overlap').toBeLessThanOrEqual(0.5);
        }
      }
    }
    // Focus not obscured (2.4.11): the privacy link, reached by keyboard, is clear of the bar.
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[data-privacy-link]').focus();
    const bar = await bottomBar(page).boundingBox();
    const f = await page.locator('[data-privacy-link]').boundingBox();
    expect(f!.y + f!.height).toBeLessThanOrEqual(bar!.y + 1);
  });
}

for (const lang of LANGS) {
  test(`R8-06 (AC9, AC11, AC14, AC16, AC17, AC18, AC19, AC21): home order and contents with device data, ${lang}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    // Bookmarks stored in Quran order; one is not in the source and is skipped on home (AC15).
    await seed(context, { 'rifq.saves': { v: 1, b: [[2, counts[2] + 1], [2, 255], [18, 10], [36, 1], [67, 1]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2, 1] } });
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('[data-continue]')).toBeVisible();
    await expect(page.locator('[data-recent]')).toBeVisible();
    // AC9 order: title, go-to box, continue card, mySaved row, juz grid, recently read.
    const order = await page.evaluate(() => ['h1.home-title', '[data-home-goto]', '[data-continue]', '[data-my-saved]', '[data-home-juz]', '[data-recent]']
      .map((s) => document.querySelector(s)!.getBoundingClientRect().top));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // AC11: surah name in the interface language, ayah number and juz; opens the reader there.
    const card = page.locator('[data-continue]');
    await expect(card).toHaveAttribute('href', P(lang, '2/#a255'));
    await expect(card.locator('[data-continue-name]')).toHaveText(nameOf(lang, 2));
    const j = juz.filter((x) => x.s < 2 || (x.s === 2 && x.a <= 255)).pop()!.juz;
    expect(src.list.find((x) => x.sora === 2 && x.aya_no === 255)!.jozz).toBe(j);
    await expect(card.locator('[data-continue-sub]')).toHaveText(t(lang, 'cardAyahJuz', { a: 255, j }));
    await expect(card).toContainText(t(lang, 'continueCard'));
    // AC14: first 3 valid bookmarks in Quran order; View all opens the Saved screen. AC16: note.
    await expect(page.locator('#my-saved-h')).toHaveText(t(lang, 'mySaved'));
    const cards = page.locator('[data-bm-card]');
    expect(await cards.evaluateAll((as) => as.map((a) => a.getAttribute('data-bm-card')))).toEqual(['2:255', '18:10', '36:1']);
    expect(await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([P(lang, '2/#a255'), P(lang, '18/#a10'), P(lang, '36/#a1')]);
    await expect(cards.first()).toContainText(nameOf(lang, 2));
    await expect(cards.first().locator('bdi[dir="ltr"]')).toHaveText('255');
    await expect(page.locator('[data-view-all]')).toHaveAttribute('href', P(lang, 'saved/'));
    await expect(page.locator('[data-saved-note]')).toHaveText(t(lang, 'bookmarksNote'));
    // AC17: 30 juz in order, 6 per row at 390 px, Latin digits, juzOf names, same targets as the index.
    const jl = page.locator('[data-home-juz-link]');
    await expect(jl).toHaveCount(30);
    expect(await jl.allTextContents()).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
    expect(await jl.evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')))).toEqual(Array.from({ length: 30 }, (_, i) => t(lang, 'juzOf', { n: i + 1 })));
    expect(await jl.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(juz.map((x) => P(lang, `${x.s}/#a${x.a}`)));
    const tops = await jl.evaluateAll((as) => as.slice(0, 7).map((a) => Math.round(a.getBoundingClientRect().top)));
    expect(new Set(tops.slice(0, 6)).size).toBe(1);
    expect(tops[6]).toBeGreaterThan(tops[0]);
    // AC18: All surahs opens the index.
    await expect(page.locator('[data-all-surahs]')).toHaveAttribute('href', P(lang, 'surahs/'));
    await expect(page.locator('[data-all-surahs]')).toHaveText(t(lang, 'allSurahs'));
    // AC19: recently read, most recent first, each at its first ayah.
    await expect(page.locator('#recent-h')).toHaveText(t(lang, 'recentTitle'));
    const chips = page.locator('[data-recent-chip]');
    expect(await chips.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([P(lang, '18/#a1'), P(lang, '2/#a1'), P(lang, '1/#a1')]);
    expect(await chips.allTextContents()).toEqual([18, 2, 1].map((s) => nameOf(lang, s)));
    // AC21: direction, no Quran text on home.
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('p.ayah')).toHaveCount(0);
    await noOverflow(page);
    // The card opens the reader at that ayah.
    await card.click();
    await expect(page).toHaveURL(new RegExp(P(lang, '2/#a255') + '$'));
    await expect(page.locator('#a255')).toBeInViewport();
  });

  test(`R8-07 (AC12, AC15): no data: no card, the noBookmarks line, no recent row; a saved position not in the source shows badRef, ${lang}`, async ({ page, context }) => {
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    await expect(page.locator('#my-saved-h')).toBeVisible();
    await expect(page.locator('[data-my-saved] [data-empty]')).toHaveText(t(lang, 'noBookmarks'));
    await expect(page.locator('[data-recent]')).toHaveCount(0);
    await expect(page.locator('[data-storage-blocked]')).toHaveCount(0);
    const p2 = await context.newPage();
    await p2.addInitScript((c) => localStorage.setItem('rifq.saves', JSON.stringify({ v: 1, b: [[2, c + 1]], l: [2, c + 1] })), counts[2]);
    await p2.goto(home(lang));
    await hydrated(p2);
    await expect(p2.locator('[data-bad-last]')).toHaveText(t(lang, 'badRef', { s: 2, a: counts[2] + 1 }));
    await expect(p2.locator('[data-continue]')).toHaveCount(0);
    await expect(p2.locator('[data-bm-card]')).toHaveCount(0);
    await expect(p2.locator('[data-my-saved] [data-empty]')).toHaveText(t(lang, 'noBookmarks'));
  });
}

test('R8-08 (AC13, AC76): storage blocked: home shows storageBlocked once and no cards; settings still apply and say they are not remembered', async ({ page }) => {
  await blockStorage(page);
  await page.setViewportSize(MOBILE);
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-storage-blocked]')).toHaveCount(1);
  await expect(page.locator('[data-storage-blocked]')).toHaveText(t('ar', 'storageBlocked'));
  await expect(page.locator('[data-continue], [data-bm-card], [data-recent]')).toHaveCount(0);
  await expect(page.locator('#q')).toBeVisible();
  await expect(bottomBar(page).locator('a[data-tab="read"]')).toHaveAttribute('href', '/surahs/');
  await page.goto('/settings/');
  await hydrated(page);
  const sw = page.locator('[data-night-switch]');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  await expect(page.locator('[data-settings-status]')).toHaveText(t('ar', 'settingsNotRemembered'));
  await page.locator('[data-set-larger]').click();
  await expect(page.locator('[data-set-size-label]')).toHaveText(t('ar', 'fontSize', { n: 3, m: 5 }));
  await expect(page.locator('[data-set-data] [data-storage-blocked]')).toHaveText(t('ar', 'storageBlocked'));
  await expect(page.locator('[data-set-clear-last], [data-set-clear-recent]')).toHaveCount(0);
  // Reading still works.
  await page.goto('/2/');
  await expect(page.locator('#a1 p.ayah')).toBeVisible();
});

test('R8-09 (AC20, D-182 A): a surah joins recently read only when the 3-second rule records an ayah; most recent first; at most 3; numbers only', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(MOBILE);
  await page.goto('/2/');
  await hydrated(page);
  expect(await store(page, 'rifq.recent')).toBeNull();
  await expect.poll(() => store(page, 'rifq.saves'), { timeout: 10_000 }).not.toBeNull();
  await expect.poll(() => store(page, 'rifq.recent'), { timeout: 10_000 }).toBe('{"v":1,"s":[2]}');
  for (const s of [18, 36, 2]) {
    await page.goto(`/${s}/`);
    await hydrated(page);
    await expect.poll(async () => JSON.parse((await store(page, 'rifq.recent')) ?? '{}').s?.[0], { timeout: 10_000 }).toBe(s);
  }
  expect(JSON.parse((await store(page, 'rifq.recent'))!)).toEqual({ v: 1, s: [2, 36, 18] });
  // Leaving before 3 seconds adds nothing.
  await page.goto('/67/');
  await page.goto('/');
  await hydrated(page);
  expect(JSON.parse((await store(page, 'rifq.recent'))!)).toEqual({ v: 1, s: [2, 36, 18] });
  await expect(page.locator('[data-recent-chip]')).toHaveCount(3);
});

for (const lang of LANGS) {
  test(`R8-10 (AC22, AC23, AC25, D-184 A): the Saved screen keeps today's Saved panel: continue, clear last, list, Remove, Clear all, ${lang}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    await seed(context, { 'rifq.saves': { v: 1, b: [[1, 1], [2, 5], [2, counts[2] + 1]], l: [2, 40] } });
    await page.goto(P(lang, 'saved/'));
    await hydrated(page);
    await expect(page.locator('h1')).toHaveText(t(lang, 'tabSaved'));
    await expect(page.locator('[data-saved] .hint').first()).toHaveText(t(lang, 'bookmarksNote'));
    await expect(page.locator('[data-continue]')).toHaveAttribute('href', P(lang, '2/#a40'));
    await expect(page.locator('[data-bm]')).toHaveCount(3);
    await expect(page.locator('[data-bad-bm]')).toHaveText(t(lang, 'badRef', { s: 2, a: counts[2] + 1 }));
    // Clear last position, with its confirm step and focus moves (RQ-003 v1.3).
    await page.locator('[data-clear-last]').click();
    await expect(page.locator('[data-clear-last-confirm]')).toBeFocused();
    await page.locator('[data-clear-last-confirm]').click();
    logRemoval('R8-10', `last position via Saved screen (${lang})`);
    await expect(page.locator('[data-saved-status]')).toHaveText(t(lang, 'clearLastDone'));
    await expect(page.locator('#saved-h')).toBeFocused();
    expect(JSON.parse((await store(page, 'rifq.saves'))!)).toEqual({ v: 1, b: [[1, 1], [2, 5], [2, counts[2] + 1]], l: null });
    // Remove one; Clear all with its confirm step.
    await page.locator('[data-bm="1:1"] button').click();
    logRemoval('R8-10', `bookmark 1:1 via Saved screen (${lang})`);
    await expect(page.locator('[data-saved-status]')).toHaveText(t(lang, 'removed'));
    await page.locator('[data-clear]').click();
    await page.locator('[data-clear-confirm]').click();
    logRemoval('R8-10', `all bookmarks via Saved screen (${lang})`);
    await expect(page.locator('[data-saved-status]')).toHaveText(t(lang, 'cleared'));
    await expect(page.locator('[data-empty]')).toHaveText(t(lang, 'noBookmarks'));
    await noOverflow(page);
  });
}

test('R8-11 (AC24): another RIFQ tab changes bookmarks: the Saved screen and the home row update without a reload', async ({ page, context }) => {
  await page.goto('/saved/');
  await hydrated(page);
  const homeTab = await context.newPage();
  await homeTab.goto('/');
  await hydrated(homeTab);
  await expect(homeTab.locator('[data-bm-card]')).toHaveCount(0);
  const other = await context.newPage();
  await other.goto('/2/');
  await hydrated(other);
  await other.locator('button.bm[data-a="7"]').click();
  await expect(page.locator('[data-bm="2:7"]')).toBeVisible();
  await expect(homeTab.locator('[data-bm-card="2:7"]')).toBeVisible();
});

for (const lang of LANGS) {
  test(`R8-12 (AC70, AC71, AC72, AC73): Settings: switch (role switch, Space, Enter), text size, no night button in any header, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    await expect(page.locator('h1')).toHaveText(t(lang, 'tabSettings'));
    // AC70 parts and order.
    const heads = await page.locator('.settings-screen h2').allTextContents();
    expect(heads).toEqual([t(lang, 'appearance'), t(lang, 'textSize'), t(lang, 'interfaceLanguage'), t(lang, 'audioReciter'), t(lang, 'deviceData')]);
    await expect(page.locator('[data-set-privacy-link]')).toHaveAttribute('href', P(lang, 'privacy/'));
    await expect(page.locator('[data-set-saved-link]')).toHaveAttribute('href', P(lang, 'saved/'));
    // AC71: one switch with a visible label and its state exposed.
    const sw = page.locator('[data-night-switch]');
    await expect(sw).toHaveAttribute('role', 'switch');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('switch', { name: t(lang, 'night') })).toHaveCount(1);
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    expect(JSON.parse((await store(page, 'rifq.settings'))!).dark).toBe(true);
    await sw.focus();
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    // AC72: the change applies on every page, before paint, and no header has a theme button.
    for (const path of ['', 'surahs/', '2/', 'tafseer/2/#a1', 'search/', 'saved/', 'settings/', 'privacy/']) {
      await page.goto(P(lang, path));
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
      await expect(page.locator('.site-header [data-night], .site-header .night-btn, .site-header #lang-switch')).toHaveCount(0);
    }
    // AC73: text size from Settings reaches the reader (Quran text size).
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    await expect(page.locator('[data-set-size-label]')).toHaveText(t(lang, 'fontSize', { n: 2, m: 5 }));
    await page.locator('[data-set-larger]').click();
    await page.locator('[data-set-larger]').click();
    await expect(page.locator('[data-set-size-label]')).toHaveText(t(lang, 'fontSize', { n: 4, m: 5 }));
    await page.goto(P(lang, '2/'));
    expect(await page.locator('#a1 p.ayah').evaluate((p) => getComputedStyle(p).fontSize)).toBe('32px');
    // The reader header keeps its text-size control (D-193 A); home does not have one.
    await expect(page.locator('.site-header [data-display-panel]')).toHaveCount(1);
    await page.goto(home(lang));
    await expect(page.locator('.site-header [data-display-panel]')).toHaveCount(0);
  });

  test(`R8-13 (AC75, D-181 C): interface language in Settings; the reading place is kept by the last position; Tafseer page link, ${lang}`, async ({ page }) => {
    const other: L = lang === 'ar' ? 'en' : 'ar';
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/#a40'));
    await hydrated(page);
    await expect.poll(() => store(page, 'rifq.saves'), { timeout: 10_000 }).toContain('"l":[2,');
    const at = JSON.parse((await store(page, 'rifq.saves'))!).l;
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    const links = page.locator('[data-set-lang-link]');
    expect(await links.allTextContents()).toEqual([`${lang === 'ar' ? '✓' : ''}${t(lang, 'langArabic')}`, `${lang === 'en' ? '✓' : ''}${t(lang, 'langEnglish')}`]);
    await expect(page.locator(`[data-set-lang-link="${lang}"]`)).toHaveAttribute('aria-current', 'true');
    await page.locator(`[data-set-lang-link="${other}"]`).click();
    await expect(page).toHaveURL(new RegExp(P(other, 'settings/') + '$'));
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(other);
    await hydrated(page);
    await expect(page.locator('h1')).toHaveText(t(other, 'tabSettings'));
    await bottomBar(page).locator('a[data-tab="read"]').click();
    await expect(page).toHaveURL(new RegExp(P(other, `${at[0]}/#a${at[1]}`) + '$'));
    // The Tafseer page has its own language link, on the same ayah (RQ-005 AC19, RQ-007 AC3).
    await page.goto(P(lang, 'tafseer/2/#a5'));
    await hydrated(page);
    await expect(page.locator('main #lang-switch')).toHaveAttribute('href', new RegExp(`${P(other, 'tafseer/2/')}#a5`));
  });

  test(`R8-14 (AC70, AC74, D-183 A, D-184 A): Data on this device: clear last position and clear recently read, each with a confirm step, ${lang}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    await seed(context, { 'rifq.saves': { v: 1, b: [[1, 1]], l: [2, 40] }, 'rifq.recent': { v: 1, s: [2, 1] }, 'rifq.settings': { size: 2, dark: false } });
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    // Clear recently read: cancel keeps it; confirm removes only it.
    const btn = page.locator('[data-set-clear-recent]');
    await expect(btn).toHaveText(t(lang, 'clearRecent'));
    await btn.click();
    await expect(page.locator('[data-set-clear-recent-confirm]')).toBeFocused();
    await expect(page.locator('[data-set-clear-recent-confirm]')).toHaveText(t(lang, 'clearRecentConfirm'));
    await page.locator('[data-set-clear-recent-cancel]').click();
    await expect(btn).toBeFocused();
    expect(await store(page, 'rifq.recent')).toBe('{"v":1,"s":[2,1]}');
    await btn.click();
    await page.locator('[data-set-clear-recent-confirm]').click();
    logRemoval('R8-14', `recently read via Settings (${lang})`);
    await expect(page.locator('[data-set-data-status]')).toHaveText(t(lang, 'clearRecentDone'));
    await expect(page.locator('#set-data-h')).toBeFocused();
    expect(await store(page, 'rifq.recent')).toBeNull();
    expect(JSON.parse((await store(page, 'rifq.saves'))!)).toEqual({ v: 1, b: [[1, 1]], l: [2, 40] });
    expect(JSON.parse((await store(page, 'rifq.settings'))!)).toEqual({ size: 2, dark: false });
    await expect(page.locator('[data-set-clear-recent]')).toHaveCount(0);
    // Clear last position (RQ-003 v1.3 behaviour).
    const last = page.locator('[data-set-clear-last]');
    await expect(last).toHaveAccessibleName(t(lang, 'clearLastName', { name: nameOf(lang, 2), a: 40 }));
    await last.click();
    await expect(page.locator('[data-set-clear-last-confirm]')).toBeFocused();
    await page.locator('[data-set-clear-last-confirm]').click();
    logRemoval('R8-14', `last position via Settings (${lang})`);
    await expect(page.locator('[data-set-data-status]')).toHaveText(t(lang, 'clearLastDone'));
    expect(JSON.parse((await store(page, 'rifq.saves'))!)).toEqual({ v: 1, b: [[1, 1]], l: null });
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('[data-continue], [data-recent]')).toHaveCount(0);
    await expect(page.locator('[data-bm-card="1:1"]')).toBeVisible();
  });
}

for (const mode of ['light', 'dark'] as const) for (const lang of LANGS) {
  test(`R8-15 (AC78, AC91, AC92): new screens: 44 px controls, text contrast 4.5:1, switch and tab bar borders 3:1, ${lang} ${mode}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    await seed(context, { 'rifq.saves': { v: 1, b: [[2, 255], [18, 10]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2] }, 'rifq.settings': { size: 1.5, dark: mode === 'dark' } });
    for (const path of ['', 'saved/', 'settings/', 'search/']) {
      await page.goto(P(lang, path));
      await hydrated(page);
      await noOverflow(page);
      const small = await page.$$eval('main a, main button, nav[data-tabbar] a', (els) => els.filter((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || getComputedStyle(e).visibility === 'hidden') return false;
        if (e.closest('.hint, p.msg, .footer-links')) return false;
        return r.height < 43.5 || r.width < 43.5;
      }).map((e) => (e.getAttribute('data-tab') ?? e.className) || e.tagName));
      expect(small, `${path} targets under 44 px`).toEqual([]);
      // Text contrast of the new parts against their own box.
      const pairs = await page.$$eval('nav[data-tabbar="bottom"] a, [data-continue] span:not(.cc-go), [data-bm-card] span, [data-home-juz-link], [data-recent-chip], .settings-screen h2, .switch-label, [data-set-lang-link], .set-link, [data-view-all], [data-all-surahs]', (els) => els.map((e) => {
        let b: Element | null = e, bg = 'rgba(0, 0, 0, 0)';
        while (b && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(b).backgroundColor; b = b.parentElement; }
        if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = getComputedStyle(document.body).backgroundColor;
        return [getComputedStyle(e).color, bg, (e.getAttribute('data-tab') ?? e.className) || e.tagName];
      }));
      for (const [fg, bg, what] of pairs) expect(ratio(rgb(fg), rgb(bg)), `${path} ${what} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    const sw = await page.locator('.switch-track').evaluate((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(e.closest('.set-sec')!).backgroundColor]);
    expect(ratio(rgb(sw[0]), rgb(sw[1])), 'switch border 3:1').toBeGreaterThanOrEqual(3);
    const tb = await bottomBar(page).evaluate((e) => [getComputedStyle(e).borderTopColor, getComputedStyle(document.body).backgroundColor, getComputedStyle(e).backgroundColor]);
    expect(Math.max(ratio(rgb(tb[0]), rgb(tb[1])), ratio(rgb(tb[0]), rgb(tb[2]))), 'tab bar edge 3:1').toBeGreaterThanOrEqual(3);
  });
}

test('R8-16 (AC86, AC87, AC88, AC90, AC95): the new screens make only RIFQ requests, carry no device data in any request, show no account or streak wording, and send noindex', async ({ page, context, seen }) => {
  await seed(context, { 'rifq.saves': { v: 1, b: [[2, 255]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18] }, 'rifq.settings': { size: 2, dark: true } });
  for (const path of ['/', '/saved/', '/settings/', '/search/', '/en/', '/en/saved/', '/en/settings/', '/en/search/']) {
    const r = await page.goto(path);
    expect(r!.status()).toBe(200);
    expect(r!.headers()['x-robots-tag'] ?? '').toContain('noindex');
    expect(r!.headers()['strict-transport-security'] ?? '').toContain('max-age');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    await hydrated(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/sign.?in|log.?in|register|sign.?up|create (an )?account|streak|badge|points|goal|reminder/i);
  }
  // Tab bar changes in place.
  await page.goto('/');
  await hydrated(page);
  for (const id of ['search', 'saved', 'settings', 'home', 'read']) {
    await page.locator(`nav[data-tabbar]:visible a[data-tab="${id}"]`).click();
    await page.waitForLoadState();
    await hydrated(page);
  }
  for (const s of seen) {
    const u = new URL(s.url);
    expect(u.origin).toBe('http://127.0.0.1:8812');
    expect(s.method, s.url).toBe('GET');
    expect(u.search, s.url).toBe('');
    expect(decodeURIComponent(s.url)).not.toMatch(/rifq\.|[{}"]|\[/);
    expect(u.pathname).not.toMatch(/^\/api\//);
    expect(/fonts\.googleapis|gstatic/.test(s.url)).toBe(false);
  }
});

test('R8-17 (keyboard, screen reader basics): skip link, main, then the tab bar (P-1); landmarks and names', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/settings/');
  await hydrated(page);
  const navs = await page.getByRole('navigation', { name: t('ar', 'tabBarLabel') }).count();
  expect(navs).toBe(1);
  await expect(page.getByRole('link', { name: t('ar', 'tabSettings') })).toHaveAttribute('aria-current', 'page');
  // Keyboard order: everything in main comes before the bar, which comes before the footer.
  const order: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => { const a = document.activeElement; return a?.closest('nav[data-tabbar]') ? 'bar' : a?.closest('main') ? 'main' : a?.closest('footer') ? 'footer' : a?.closest('header') ? 'header' : 'other'; });
    if (order[order.length - 1] !== where) order.push(where);
    if (where === 'footer') break;
  }
  expect(order.filter((x) => x !== 'other')).toEqual(['header', 'main', 'bar', 'footer']);
  // Every tab bar link, when focused, is fully on screen (2.4.11).
  for (const a of await bottomBar(page).locator('a').all()) {
    await a.focus();
    expect(await a.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
  }
});

test.describe('with a recitation (made-up silent file answered locally)', () => {
test.use({ allowHosts: ['download.quranicaudio.com'] });
test('R8-18 (AC5, AC6): a recitation keeps playing when the reader uses tab bar items; the mini-player sits above the bar', async ({ page }) => {
  const { serveAudio } = await import('./audio-helpers.ts');
  await serveAudio(page, () => 3_600_000);
  await page.setViewportSize(MOBILE);
  await page.goto('/1/');
  await hydrated(page);
  await page.click('button.ap[data-ap="1"]');
  await page.waitForFunction(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null; return !!a && !a.paused && a.readyState >= 2; });
  await page.evaluate(() => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).playbackRate = 0.0625; (window as unknown as { __same: number }).__same = 1; });
  for (const id of ['home', 'search', 'saved', 'settings', 'read']) {
    await bottomBar(page).locator(`a[data-tab="${id}"]`).click();
    await page.waitForFunction((x) => document.querySelector(`nav[data-tabbar="bottom"] a[data-tab="${x}"]`)?.getAttribute('aria-current') === 'page' || x === 'read', id);
    expect(await page.evaluate(() => (window as unknown as { __same?: number }).__same)).toBe(1);
    expect(await page.evaluate(() => !(document.querySelector('audio[data-audio]') as HTMLAudioElement).paused)).toBe(true);
    // AC6: the mini-player sits directly above the tab bar and does not cover it.
    const mini = await page.locator('[data-mini-player]').boundingBox();
    const bar = await bottomBar(page).boundingBox();
    expect(Math.abs(mini!.y + mini!.height - bar!.y)).toBeLessThanOrEqual(1);
  }
});
});

test('R8-19 (AC73 reading place): after a text size change in Settings, the Read tab returns to the reading place', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/2/#a30');
  await hydrated(page);
  const before = await topAyah(page);
  await expect.poll(async () => JSON.parse((await store(page, 'rifq.saves')) ?? '{}').l?.[1], { timeout: 10_000 }).toBe(before);
  await bottomBar(page).locator('a[data-tab="settings"]').click();
  await expect(page.locator('h1')).toHaveText(t('ar', 'tabSettings'));
  await hydrated(page);
  await page.locator('[data-set-larger]').click();
  await page.locator('[data-set-larger]').click();
  await bottomBar(page).locator('a[data-tab="read"]').click();
  await expect(page).toHaveURL(new RegExp(`/2/#a${before}$`));
  expect(await page.locator(`#a${before} p.ayah`).evaluate((p) => getComputedStyle(p).fontSize)).toBe('32px');
  await expect.poll(() => topAyah(page)).toBe(before);
});

for (const lang of LANGS) {
  test(`R8-20 (AC93, P-17): layout shift of home and reader loads is 0.1 or less (Saved and Settings measured), with device data, ${lang}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    await seed(context, { 'rifq.saves': { v: 1, b: [[2, 255], [18, 10], [36, 1]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2, 1] } });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    const out: Record<string, number> = {};
    for (const path of ['', 'saved/', 'settings/', '2/']) {
      await page.goto(P(lang, path));
      await hydrated(page);
      await page.waitForTimeout(800);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      out[path || 'home'] = Math.round(cls * 1000) / 1000;
      // AC93 sets the limit for home and reader pages; Saved and Settings are measured and reported.
      if (path === '' || path === '2/') expect(cls, `${path || 'home'} CLS`).toBeLessThanOrEqual(0.1);
    }
    test.info().annotations.push({ type: 'cls', description: JSON.stringify(out) });
  });
}

test('R8-SHOTS: screenshots of each new screen (private folder, optional)', async ({ browser }) => {
  const dir = process.env.RIFQ_SHOTS;
  test.skip(!dir, 'RIFQ_SHOTS not set');
  mkdirSync(dir!, { recursive: true });
  for (const width of [390, 1280]) for (const lang of LANGS) for (const dark of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, baseURL: 'http://127.0.0.1:8812' });
    await seed(ctx, { 'rifq.saves': { v: 1, b: [[2, 255], [18, 10], [36, 1], [67, 1]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2, 1] }, 'rifq.settings': { size: 1.5, dark } });
    const page = await ctx.newPage();
    for (const [n, p] of [['home', ''], ['saved', 'saved/'], ['settings', 'settings/'], ['search', 'search/']]) {
      if (width === 1280 && n !== 'home' && n !== 'settings') continue;
      await page.goto(P(lang, p));
      await hydrated(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/${n}-${lang}-${dark ? 'dark' : 'light'}-${width}.png`, fullPage: width === 390 });
    }
    await ctx.close();
  }
});
