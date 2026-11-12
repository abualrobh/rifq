// RQ-003 browser tests. Every test uses a new, disposable browser profile and references only
// (surah and ayah numbers). Removals happen through the product and are logged (D-051).
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, surahs, N, MOBILE, DESKTOP, BUILD, hydrated, noOverflow, logRemoval, withoutAudioMeta } from './helpers.ts';
import { t, ACCOUNT_WORDS } from '../../src/core/strings.ts';

const KEY = 'rifq.saves';
const home = (lang: 'ar' | 'en') => (lang === 'ar' ? '/' : '/en/');
const reader = (lang: 'ar' | 'en', s: number, a?: number) => `${home(lang)}${s}/${a ? `#a${a}` : ''}`;
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const seed = (ctx: BrowserContext, value: unknown) => ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(value)]);

async function bookmark(page: Page, a: number) {
  await page.click(`button.bm[data-a="${a}"]`);
}

test('TP3-01: a bookmark stays after reload and after a browser restart', async () => {
  const dir = join(BUILD, 'profiles', `tp3-01-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  let ctx = await chromium.launchPersistentContext(dir, { baseURL: 'http://127.0.0.1:8812', args: ['--no-proxy-server'] });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('/2/');
  await hydrated(page);
  await bookmark(page, 5);
  await expect(page.locator('[data-reader-status]')).toHaveText(t('ar', 'saved'));
  await page.reload();
  await hydrated(page);
  await expect(page.locator('button.bm[data-a="5"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-bm="2:5"] a')).toHaveText(`${surahs[1].ar} 2:5`);
  await ctx.close();
  ctx = await chromium.launchPersistentContext(dir, { baseURL: 'http://127.0.0.1:8812', args: ['--no-proxy-server'] });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-bm="2:5"] a')).toBeVisible();
  await ctx.close();
});

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP3-02, TP3-03, TP3-06: empty state, saved notice, list direction and names, ${lang} ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('[data-empty]')).toHaveText(t(lang, 'noBookmarks'));
    await page.goto(reader(lang, 3));
    await hydrated(page);
    await bookmark(page, 7);
    await expect(page.locator('[data-reader-status]')).toHaveText(t(lang, 'saved'));
    await page.goto(home(lang));
    await hydrated(page);
    const item = page.locator('[data-bm="3:7"] a');
    await expect(item).toHaveText(`${lang === 'ar' ? surahs[2].ar : surahs[2].en} 3:7`);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-bookmarks]')!).direction)).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    await noOverflow(page);
    await page.click('#lang-switch');
    await hydrated(page);
    await expect(page.locator('[data-bm="3:7"] a')).toHaveText(`${lang === 'ar' ? surahs[2].en : surahs[2].ar} 3:7`);
    await noOverflow(page);
  });
}

test('TP3-08: removing one bookmark through the product removes only that one', async ({ page, context }) => {
  await seed(context, { v: 1, b: [[1, 1], [2, 2], [3, 3]], l: null });
  await page.goto('/');
  await hydrated(page);
  await page.click('[data-bm="2:2"] button');
  logRemoval('TP3-08', 'removed bookmark 2:2 through the home page, disposable profile');
  await expect(page.locator('[data-saved-status]')).toHaveText(t('ar', 'removed'));
  await page.reload();
  await hydrated(page);
  await expect(page.locator('[data-bm="2:2"]')).toHaveCount(0);
  await expect(page.locator('[data-bm]')).toHaveCount(2);
  expect(JSON.parse((await stored(page))!).b).toEqual([[1, 1], [3, 3]]);
});

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP3-09: an ayah visible for 3 seconds becomes continue reading, ${lang} ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto(reader(lang, 2, 40));
    await hydrated(page);
    await page.waitForTimeout(3800);
    await page.goto(home(lang));
    await hydrated(page);
    const link = page.locator('[data-continue]');
    await expect(link).toHaveText(t(lang, 'continueReading', { name: lang === 'ar' ? surahs[1].ar : surahs[1].en, a: 40 }));
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/2/#a40$`));
    await expect(page.locator('#a40')).toBeInViewport();
  });
}

test('TP3-10, TP3-11: leaving before 3 seconds keeps the old position; 3 seconds on a newer ayah replaces it', async ({ page }) => {
  await page.goto('/2/#a40');
  await hydrated(page);
  await page.waitForTimeout(3800);
  await page.goto('/2/#a120');
  await hydrated(page);
  await page.waitForTimeout(1500);
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-continue]')).toHaveAttribute('href', '/2/#a40');
  await page.goto('/2/#a120');
  await hydrated(page);
  await page.waitForTimeout(3800);
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-continue]')).toHaveAttribute('href', '/2/#a120');
});

test('TP3-12, TP3-14, TP3-15: a new profile has no continue offer, and no account or sync prompt appears anywhere', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-continue]')).toHaveCount(0);
  await page.goto('/2/#a3');
  await hydrated(page);
  await bookmark(page, 3);
  await page.waitForTimeout(3500);
  for (const p of ['/', '/2/', '/en/', '/en/2/']) {
    await page.goto(p);
    await hydrated(page);
    expect(ACCOUNT_WORDS.test(await page.locator('body').innerText()), p).toBe(false);
    expect(await page.locator('dialog, [role=dialog]').count()).toBe(0);
  }
});

test('TP3-16: bookmarks and last position are never sent to a server', async ({ page, seen }) => {
  await page.goto('/2/#a9');
  await hydrated(page);
  await bookmark(page, 9);
  await bookmark(page, 10);
  await page.waitForTimeout(3600);
  await page.goto('/');
  await hydrated(page);
  await page.click('[data-continue]');
  for (const s of withoutAudioMeta(seen)) {
    expect(s.method).toBe('GET');
    expect(s.body).toBeNull();
    expect(new URL(s.url).search).toMatch(/^(\?astro-retry=\d+)?$/);
  }
});

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP3-17: storage blocked: reading works, and a save shows it could not be saved, ${lang} ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); });
    await page.goto(reader(lang, 2));
    await hydrated(page);
    await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[1].items.length);
    await bookmark(page, 4);
    await expect(page.locator('[data-reader-status]')).toHaveText(t(lang, 'saveFailed'));
    await expect(page.locator('button.bm[data-a="4"]')).toHaveAttribute('aria-pressed', 'false');
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('[data-storage-blocked]')).toHaveText(t(lang, 'storageBlocked'));
    await noOverflow(page);
  });
}

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP3-18: storage full of made-up data: reading works, and a save shows it could not be saved, ${lang} ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto(reader(lang, 2));
    // Fill to the last byte: big chunks first, then smaller ones down to one character.
    const filled = await page.evaluate(() => {
      let i = 0, size = 256 * 1024, refused = 0;
      while (size >= 1 && i < 100000) {
        try { localStorage.setItem('made-up-filler-' + i, 'x'.repeat(size)); i++; } catch { refused++; size = Math.floor(size / 2); }
      }
      let full = false;
      try { localStorage.setItem('made-up-probe', '[]'); } catch { full = true; }
      return { items: i, refused, full };
    });
    expect(filled.full, 'storage is full').toBe(true);
    await page.reload();
    await hydrated(page);
    await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[1].items.length);
    await bookmark(page, 6);
    await expect(page.locator('[data-reader-status]')).toHaveText(t(lang, 'saveFailed'));
    await expect(page.locator('[data-reader-status]')).not.toHaveText(t(lang, 'saved'));
  });
}

test('TP3-19: device storage holds references only: no text, no names, no dates', async ({ page }) => {
  await page.goto('/2/#a20');
  await hydrated(page);
  await bookmark(page, 20);
  await bookmark(page, 21);
  await page.waitForTimeout(3600);
  const all = await page.evaluate(() => ({ ...localStorage }));
  const keys = Object.keys(all).sort();
  expect(keys.every((k) => k === 'rifq.saves' || k === 'rifq.settings')).toBe(true);
  const v = JSON.parse(all['rifq.saves']);
  expect(Object.keys(v).sort()).toEqual(['b', 'l', 'v']);
  expect(v.b).toEqual([[2, 20], [2, 21]]);
  expect(v.l[0]).toBe(2);
  expect(JSON.stringify(all)).not.toMatch(/[\u0600-\u06ff]/);
  expect(all['rifq.saves']).toMatch(/^[\[\]{}":,a-z0-9]+$/);
});

test('TP3-20: references that do not exist show a clear message and open nothing else', async ({ page, context }) => {
  const c2 = surahs[1].items.length;
  await seed(context, { v: 1, b: [[N + 1, 1], [2, c2 + 1], [0, 1], [1, 1]], l: [2, c2 + 1] });
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-bad-last]')).toHaveText(t('ar', 'badRef', { s: 2, a: c2 + 1 }));
  await expect(page.locator('[data-continue]')).toHaveCount(0);
  await expect(page.locator('[data-bad-bm]')).toHaveCount(3);
  await expect(page.locator('[data-bm] a')).toHaveCount(1);
  await page.goto(`/2/#a${c2 + 1}`);
  await hydrated(page);
  await expect(page.locator('[data-reader-status]')).toHaveText(t('ar', 'badRef', { s: 2, a: c2 + 1 }));
  expect(await page.locator(':target').count()).toBe(0);
  await page.goto(`/en/${N}/#a0`);
  await hydrated(page);
  await expect(page.locator('[data-reader-status]')).toHaveText(t('en', 'badRef', { s: N, a: 0 }));
});

test('TP3-21: malformed and script values in storage are ignored safely', async ({ page, context }) => {
  await context.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('rifq.saves', '{"v":1,"b":[["<img src=x onerror=alert(1)>",1],[1,"2"],{"a":1}],"l":"<script>alert(1)</script>"}'); localStorage.setItem('rifq.settings', '{"size":"<b>","dark":"yes"}'); sessionStorage.setItem('seeded', '1'); } });
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('[data-empty]')).toBeVisible();
  expect(await page.locator('img[src=x]').count()).toBe(0);
  await page.goto('/2/');
  await hydrated(page);
  await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[1].items.length);
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP3-24, TP3-22 (automated part): bookmark control name and on/off state in the interface language, by keyboard, ${lang}`, async ({ page }) => {
    await page.goto(reader(lang, 1));
    await hydrated(page);
    const b = page.locator('button.bm[data-a="2"]');
    await expect(b).toHaveAttribute('aria-label', t(lang, 'bookmarkOff', { a: 2 }));
    await expect(b).toHaveAttribute('aria-pressed', 'false');
    await b.focus();
    await page.keyboard.press('Enter');
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    await expect(b).toHaveAttribute('aria-label', t(lang, 'bookmarkOn', { a: 2 }));
    expect(await b.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Space');
    logRemoval('TP3-24', 'removed bookmark 1:2 with the bookmark button, disposable profile');
    await expect(b).toHaveAttribute('aria-pressed', 'false');
  });
}

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP3-25: at 500 bookmarks, another one shows the limit and the 500 stay unchanged, ${lang} ${vp.width}px`, async ({ page, context }) => {
    await page.setViewportSize(vp);
    const refs: [number, number][] = [];
    for (const s of surahs) for (const a of s.items) { if (refs.length < 500 && a.sora !== 2) refs.push([a.sora, a.aya_no]); }
    await seed(context, { v: 1, b: refs, l: null });
    await page.goto(reader(lang, 2));
    await hydrated(page);
    const before = await stored(page);
    await bookmark(page, 1);
    await expect(page.locator('[data-reader-status]')).toHaveText(t(lang, 'limit'));
    expect(await stored(page)).toBe(before);
    await noOverflow(page);
  });
}

test('TP3-26: clear all asks to confirm; cancel keeps everything; confirm removes all bookmarks', async ({ page, context }) => {
  await seed(context, { v: 1, b: [[1, 1], [2, 2], [3, 3]], l: [2, 2] });
  await page.goto('/');
  await hydrated(page);
  await page.click('[data-clear]');
  await page.click('[data-clear-cancel]');
  await expect(page.locator('[data-bm]')).toHaveCount(3);
  await page.click('[data-clear]');
  await page.click('[data-clear-confirm]');
  logRemoval('TP3-26', 'cleared bookmarks 1:1, 2:2, 3:3 through the home page, disposable profile');
  await expect(page.locator('[data-saved-status]')).toHaveText(t('ar', 'cleared'));
  await page.reload();
  await hydrated(page);
  await expect(page.locator('[data-bm]')).toHaveCount(0);
  expect(JSON.parse((await stored(page))!)).toEqual({ v: 1, b: [], l: [2, 2] });
});
