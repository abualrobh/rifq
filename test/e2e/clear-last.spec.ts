// RQ-003 v1.3 AC14 to AC23 (D-103): the clear last reading position button on the home page.
// Every test uses a disposable profile and made-up references; each removal goes through the
// product and is logged (D-051).
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, surahs, MOBILE, DESKTOP, hydrated, noOverflow, logRemoval } from './helpers.ts';
import { t } from '../../src/core/strings.ts';

const KEY = 'rifq.saves';
const home = (lang: 'ar' | 'en') => (lang === 'ar' ? '/' : '/en/');
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const seed = (ctx: BrowserContext, value: unknown) => ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(value)]);
const nameOf = (lang: 'ar' | 'en', s: number) => (lang === 'ar' ? surahs[s - 1].ar : surahs[s - 1].en);

test('CL-01 (AC14): the button shows only when a last position is saved, with or without bookmarks', async ({ page, context }) => {
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-saved-status]')).toBeAttached();
  await expect(page.locator('[data-clear-last]')).toHaveCount(0);
  await seed(context, { v: 1, b: [], l: [2, 40] });
  const p2 = await context.newPage();
  await p2.goto('/');
  await hydrated(p2);
  await expect(p2.locator('[data-continue]')).toBeVisible();
  await expect(p2.locator('[data-clear-last]')).toHaveText(t('ar', 'clearLast'));
  await expect(p2.locator('[data-empty]')).toBeVisible();
});

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`CL-02 (AC15, AC16, AC17, AC18, AC21): cancel keeps it; confirm removes only the position, ${lang} ${vp.width}px`, async ({ page, context }) => {
    await page.setViewportSize(vp);
    await context.addInitScript(() => { if (!sessionStorage.getItem('s2')) { localStorage.setItem('rifq.settings', '{"size":2,"dark":true}'); sessionStorage.setItem('s2', '1'); } });
    await seed(context, { v: 1, b: [[1, 1], [2, 5], [3, 3]], l: [2, 40] });
    await page.goto(home(lang));
    await hydrated(page);
    const btn = page.locator('[data-clear-last]');
    await expect(btn).toHaveText(t(lang, 'clearLast'));
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-clear-last]')!).direction)).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    await btn.click();
    await expect(page.locator('[data-clear-last-note]')).toHaveText(t(lang, 'clearLastNote'));
    await expect(page.locator('[data-clear-last-confirm]')).toHaveText(t(lang, 'clearLastConfirm'));
    await expect(page.locator('[data-clear-last-cancel]')).toHaveText(t(lang, 'cancel'));
    await noOverflow(page);
    await page.click('[data-clear-last-cancel]');
    await expect(page.locator('[data-continue]')).toBeVisible();
    expect(JSON.parse((await stored(page))!).l).toEqual([2, 40]);
    await page.click('[data-clear-last]');
    await page.click('[data-clear-last-confirm]');
    logRemoval('CL-02', `removed last position 2:40 through the home page (${lang}, ${vp.width}px), disposable profile`);
    await expect(page.locator('[data-saved-status]')).toHaveText(t(lang, 'clearLastDone'));
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    await expect(page.locator('[data-clear-last]')).toHaveCount(0);
    await page.reload();
    await hydrated(page);
    await expect(page.locator('[data-bm]')).toHaveCount(3);
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    await expect(page.locator('[data-clear-last]')).toHaveCount(0);
    expect(JSON.parse((await stored(page))!)).toEqual({ v: 1, b: [[1, 1], [2, 5], [3, 3]], l: null });
    expect(await page.evaluate(() => localStorage.getItem('rifq.settings'))).toBe('{"size":2,"dark":true}');
    await noOverflow(page);
  });
}

test('CL-03 (AC18): another open home tab hides the shortcut too, until a new position is saved', async ({ context }) => {
  await seed(context, { v: 1, b: [], l: [3, 3] });
  const a = await context.newPage(), b = await context.newPage();
  for (const p of [a, b]) { await p.goto('/'); await hydrated(p); await expect(p.locator('[data-continue]')).toBeVisible(); }
  await a.click('[data-clear-last]');
  await a.click('[data-clear-last-confirm]');
  logRemoval('CL-03', 'removed last position 3:3 through the home page, disposable profile');
  await expect(b.locator('[data-continue]')).toHaveCount(0);
  await expect(b.locator('[data-clear-last]')).toHaveCount(0);
  await b.goto('/2/#a40');
  await hydrated(b);
  await b.waitForTimeout(3800);
  await b.goto('/');
  await hydrated(b);
  await expect(b.locator('[data-continue]')).toHaveAttribute('href', '/2/#a40');
});

test('CL-04 (AC19): a write that fails shows the failure message and keeps the shortcut', async ({ page, context }) => {
  await seed(context, { v: 1, b: [[1, 1]], l: [2, 7] });
  await page.goto('/');
  await hydrated(page);
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.click('[data-clear-last]');
  await page.click('[data-clear-last-confirm]');
  await expect(page.locator('[data-saved-status]')).toHaveText(t('ar', 'clearLastFailed'));
  await expect(page.locator('[data-continue]')).toBeVisible();
  await expect(page.locator('[data-clear-last]')).toBeFocused();
  expect(JSON.parse((await stored(page))!).l).toEqual([2, 7]);
});

test('CL-05 (AC19): blocked storage: no button, the storage message instead', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-storage-blocked]')).toHaveText(t('ar', 'storageBlocked'));
  await expect(page.locator('[data-clear-last]')).toHaveCount(0);
});

for (const lang of ['ar', 'en'] as const) {
  test(`CL-06 (AC20): keyboard only, names in the interface language, focus never lost, ${lang}`, async ({ page, context }) => {
    await seed(context, { v: 1, b: [[1, 1]], l: [2, 40] });
    await page.goto(home(lang));
    await hydrated(page);
    const btn = page.locator('[data-clear-last]');
    await expect(btn).toHaveAttribute('aria-label', t(lang, 'clearLastName', { name: nameOf(lang, 2), a: 40 }));
    const box = (await btn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await btn.focus();
    const y0 = await page.evaluate(() => scrollY);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-clear-last-confirm]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-clear-last-cancel]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    logRemoval('CL-06', `removed last position 2:40 by keyboard (${lang}), disposable profile`);
    const status = page.locator('[data-saved-status]');
    await expect(status).toHaveText(t(lang, 'clearLastDone'));
    await expect(status).toHaveAttribute('role', 'status');
    await expect(page.locator('#saved-h')).toBeFocused();
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe('none');
  });
}

test('CL-07 (AC22): choose, cancel, confirm and reload make no request for the clear action', async ({ page, context, seen }) => {
  await seed(context, { v: 1, b: [[1, 1]], l: [2, 40] });
  await page.goto('/');
  await hydrated(page);
  const n = seen.length;
  await page.click('[data-clear-last]');
  await page.click('[data-clear-last-cancel]');
  await page.click('[data-clear-last]');
  await page.click('[data-clear-last-confirm]');
  logRemoval('CL-07', 'removed last position 2:40 through the home page, disposable profile');
  await expect(page.locator('[data-saved-status]')).toHaveText(t('ar', 'clearLastDone'));
  expect(seen.slice(n), 'no request while clearing').toEqual([]);
  await page.reload();
  await hydrated(page);
  for (const s of seen) {
    expect(s.method).toBe('GET');
    expect(s.body).toBeNull();
    expect(new URL(s.url).search).toMatch(/^(\?astro-retry=\d+)?$/);
  }
});

test('CL-08 (AC23): a saved position not in the source shows the AC10 message and the button with its plain name', async ({ page, context }) => {
  const c2 = surahs[1].items.length;
  await seed(context, { v: 1, b: [], l: [2, c2 + 1] });
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-bad-last]')).toHaveText(t('ar', 'badRef', { s: 2, a: c2 + 1 }));
  const btn = page.locator('[data-clear-last]');
  await expect(btn).toHaveText(t('ar', 'clearLast'));
  expect(await btn.getAttribute('aria-label')).toBeNull();
  await btn.click();
  await page.click('[data-clear-last-confirm]');
  logRemoval('CL-08', `removed made-up last position 2:${c2 + 1} through the home page, disposable profile`);
  await expect(page.locator('[data-bad-last]')).toHaveCount(0);
  expect(JSON.parse((await stored(page))!).l).toBeNull();
});
