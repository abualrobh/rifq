// Kit v41, in the browser, against the local Worker and the mock Quran Foundation API.
// - D-254: the recitation credit names the reciter and Quran Foundation (Quran Foundation Developer
//   Terms 2026-11-20: "Credit Quran Foundation and the reciter"), behind the reader page's reciter
//   button and in Settings; the mini-player keeps naming both while a recitation is loaded.
// - D-253 C: the licence line in the source details names the Quran Foundation Developer Terms
//   without a date.
// - Layout shift of the Settings screen while its credit fills in (the reciter list loads).
// Made-up data (the local mock and a made-up silent WAV). No Arabic characters and no Quran text in
// this file: expected text comes from strings.ts. Figures go to test-info annotations.
import type { Page } from '@playwright/test';
import { test, expect, surahs, MOBILE, hydrated, noOverflow } from './helpers.ts';
import { t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { AR_WORD, MOCK_RECITER_NAMES } from '../mock/qf-mock.ts';
import { audioState, serveAudio, STEP } from './audio-helpers.ts';

test.use({ allowHosts: [AUDIO_HOST] });

const LANGS: Lang[] = ['ar', 'en'];
const home = (l: Lang) => (l === 'ar' ? '/' : '/en/');
const len = (s: number) => surahs[s - 1].items.length * STEP;
const name7 = (l: Lang) => (l === 'ar' ? AR_WORD(7) : MOCK_RECITER_NAMES[7]);

async function playSurah(page: Page) {
  await page.locator('[data-play-surah]').click();
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
}

test('V41-01 (D-254, D-253 C): behind the reciter button the credit names the reciter and Quran Foundation; the licence line has no date', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  for (const lang of LANGS) {
    await page.goto(home(lang) + '2/');
    await hydrated(page);
    const credit = page.locator('[data-audio-credit]');
    await expect(credit).toBeHidden();
    await page.locator('[data-reciter-btn]').click();
    await expect(credit).toBeVisible();
    await expect(credit).toHaveText(t(lang, 'audioCreditBy', { name: name7(lang) }));
    await expect(credit).toHaveAttribute('data-credit-named', '1');
    await expect(credit.locator('[data-credit-reciter]')).toHaveText(name7(lang));
    await expect(credit.locator('[data-credit-reciter]')).toHaveAttribute('lang', lang);
    if (lang === 'ar') await expect(credit.locator('bdi[data-ltr-run]')).toHaveText('Quran Foundation');
    // The licence line: the terms named, no date.
    const dd = page.locator('[data-audio-source] dd').last();
    await expect(dd).toHaveText(t(lang, 'audioLicence'));
    expect(await dd.textContent()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(await page.locator('main').textContent()).not.toContain('2026-10-11');
    await noOverflow(page);
    // Choosing the other reciter names that reciter in the credit.
    await page.check('[data-reciter="97"]');
    await expect(credit.locator('[data-credit-reciter]')).toHaveText(lang === 'ar' ? AR_WORD(97) : MOCK_RECITER_NAMES[97]);
    await page.check('[data-reciter="7"]');
    await expect(credit.locator('[data-credit-reciter]')).toHaveText(name7(lang));
  }
});

test('V41-02 (D-254): Settings shows the credit with the reciter and Quran Foundation, in Arabic and English', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  for (const lang of LANGS) {
    await page.goto(home(lang) + 'settings/');
    await hydrated(page);
    const credit = page.locator('[data-set-credit]');
    await expect(credit).toHaveText(t(lang, 'audioCreditBy', { name: name7(lang) }));
    await expect(credit).toHaveAttribute('data-credit-named', '1');
    await expect(page.locator('[data-set-reciter-name]')).toHaveText(name7(lang));
    await noOverflow(page);
  }
});

test('V41-03 (D-254): while a recitation plays, the reader credit and the mini-player both name the reciter and Quran Foundation', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  for (const lang of LANGS) {
    await page.goto(home(lang) + '1/');
    await hydrated(page);
    await playSurah(page);
    await expect(page.locator('[data-mini-reciter]')).toHaveText(name7(lang));
    await expect(page.locator('[data-mini-credit]')).toHaveText('Quran Foundation');
    await expect(page.locator('[data-audio-credit]')).toHaveText(t(lang, 'audioCreditBy', { name: name7(lang) }));
    // In Settings (in place, still playing) too.
    await page.click('nav[data-tabbar]:visible a[data-tab="settings"]');
    await hydrated(page);
    await expect(page.locator('[data-set-credit]')).toHaveText(t(lang, 'audioCreditBy', { name: name7(lang) }));
    await expect(page.locator('[data-mini-reciter]')).toHaveText(name7(lang));
    await page.locator('[data-mini-close]').click();
  }
});

test('V41-04 (layout shift): the Settings screen while its credit and reciter fill in', async ({ page }, info) => {
  await page.setViewportSize(MOBILE);
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  for (const lang of LANGS) {
    await page.goto(home(lang) + 'settings/');
    await hydrated(page);
    await expect(page.locator('[data-set-credit]')).toHaveAttribute('data-credit-named', '1');
    await page.waitForTimeout(500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    info.annotations.push({ type: 'cls', description: `settings ${lang}: ${cls.toFixed(4)}` });
    expect(cls).toBeLessThan(0.1);
  }
});
