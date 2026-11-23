// Kit v39 part A: fixes to kit v38 (RQ-008 stage 2), decided by Hamzeh on 2026-11-23.
// - QA v38 FIND-BV (D-210): one reciter-list request per language after a language switch in Settings.
// - QA v38 FIND-BU and FIND-CB (D-205): no sideways scroll at 200% text on every reader page; a smaller
//   fixed bottom area at 200%, with nothing behind it when a control is focused (AC6, AC7, AC91).
// - QA v38 FIND-BW: a loading cue in the mini-player (RQ-006 AC20).
// - QA v38 FIND-BX: a double click on an ayah selects a word and opens no panel (AC26).
// - D-208 C (AC43): the Tafseer previous and next buttons show the target ayah, in the panel and on
//   the page alike.
// - D-207 B (RQ-006 AC28): previous and next ayah in the mini-player.
// Two stand-ins for 200%: "text" sets the root font to 200% (browser text zoom), "page" halves the
// CSS viewport with a device scale of 2 (Safari's aA page zoom on a 390 x 844 phone: 195 x 422).
// Made-up data (the local mock and a made-up silent WAV). No Arabic characters and no Quran text in
// this file: expected text comes from strings.ts. Figures for the hand-back are written to
// test-info annotations (reading space).
import type { Browser, Page } from '@playwright/test';
import { test, expect, surahs, MOBILE, hydrated, openAyah } from './helpers.ts';
import { t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { audioState, serveAudio, STEP } from './audio-helpers.ts';

test.use({ allowHosts: [AUDIO_HOST] });

type L = Lang;
const LANGS: L[] = ['ar', 'en'];
const home = (l: L) => (l === 'ar' ? '/' : '/en/');
const P = (l: L, p: string) => home(l) + p;
const n = (s: number) => surahs[s - 1].items.length;
const len = (s: number) => n(s) * STEP;
const seekTo = (page: Page, ms: number) => page.evaluate((x) => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = x / 1000; }, ms);
const marked = (page: Page) => page.$$eval('li.ayah-row.ap-current', (ls) => ls.map((l) => Number((l as HTMLElement).dataset.a)));
const mini = (page: Page) => page.locator('[data-mini-player]');
type Zoom = 'normal' | 'text' | 'page';
const ZOOMS: [Zoom, number][] = [['normal', 390], ['normal', 320], ['text', 390], ['text', 320], ['page', 195], ['page', 160]];

async function zoomed(browser: Browser, kind: Zoom, w: number) {
  const ctx = await browser.newContext({ viewport: { width: w, height: kind === 'page' ? 422 : 844 }, deviceScaleFactor: kind === 'page' ? 2 : 1, baseURL: 'http://127.0.0.1:8812' });
  // The root font is set as soon as the document has its root element (before the page's scripts).
  if (kind === 'text') await ctx.addInitScript(() => { const set = () => { if (document.documentElement) document.documentElement.style.fontSize = '200%'; }; set(); new MutationObserver(set).observe(document, { childList: true, subtree: false }); document.addEventListener('DOMContentLoaded', set); });
  return ctx;
}
async function playSurah(page: Page, s: number) {
  await page.locator('[data-play-surah]').click();
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
}

test('V39-01 (QA v38 FIND-BV, D-210, D-206 A): after a language switch in Settings the new list is asked for once, with and without a recitation', async ({ page, seen }) => {
  test.setTimeout(120_000);
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  for (const playing of [false, true]) {
    await page.goto('/2/');
    await hydrated(page);
    if (playing) await playSurah(page, 2);
    const from = seen.length;
    await page.click('nav[data-tabbar]:visible a[data-tab="settings"]');
    await expect(page).toHaveURL(/\/settings\/$/);
    await hydrated(page);
    await expect(page.locator('[data-set-reciter-name]')).not.toHaveText('');
    await page.click('[data-set-lang-link="en"]');
    await expect(page).toHaveURL(/\/en\/settings\/$/);
    await hydrated(page);
    await expect(page.locator('[data-set-reciter-name]')).not.toHaveText('');
    await page.waitForTimeout(1500);
    const lists = seen.slice(from).filter((s) => new URL(s.url).pathname === '/api/audio/reciters');
    const en = lists.filter((s) => s.body === '{"lang":"en"}').length;
    const ar = lists.filter((s) => s.body === '{"lang":"ar"}').length;
    expect(en, `English list requests (playing ${playing})`).toBe(1);
    expect(ar, `Arabic list requests (playing ${playing})`).toBeLessThanOrEqual(1);
    await page.evaluate(() => sessionStorage.clear());
  }
});

// The pages of D-205: reader, Tafseer page, home, Saved, Settings, surah index and Search.
const PAGES = ['2/', 'tafseer/2/#a5', '', 'saved/', 'settings/', 'surahs/', 'search/'];
for (const lang of LANGS) {
  test(`V39-02 (QA v38 FIND-BU, D-205, AC7, AC92): no sideways scroll on every reader page at 390 and 320 px, at 100% and 200% text, ${lang}`, async ({ browser }) => {
    test.setTimeout(240_000);
    for (const [kind, w] of ZOOMS) {
      const ctx = await zoomed(browser, kind, w);
      const page = await ctx.newPage();
      for (const p of PAGES) {
        await page.goto(P(lang, p));
        await hydrated(page);
        await page.waitForTimeout(200);
        const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(r.sw, `${kind} ${w} ${p}: scrollWidth <= clientWidth`).toBeLessThanOrEqual(r.cw);
        // The reader's top links are on screen (FIND-BU: they were cut off).
        if (p === '2/') {
          const off = await page.$$eval('.reader-main > .surah-nav:not(.surah-nav-end) a', (as) => as.filter((a) => { const b = a.getBoundingClientRect(); return b.left < -0.5 || b.right > innerWidth + 0.5; }).length);
          expect(off, `${kind} ${w}: top links on screen`).toBe(0);
        }
      }
      await ctx.close();
    }
  });
}

// Reading space: the screen height between the sticky header and the fixed bottom area (tab bar, and
// the mini-player when a recitation is loaded), in screen pixels of an 844 px tall phone.
async function space(page: Page, kind: Zoom) {
  return page.evaluate((k) => {
    // Kit v39: at large text the reader header scrolls away (not sticky): it then hides nothing.
    const hd = document.querySelector('.site-header')!;
    const head = getComputedStyle(hd).position === 'sticky' ? hd.getBoundingClientRect().bottom : Math.max(0, hd.getBoundingClientRect().bottom);
    const bar = document.querySelector('nav[data-tabbar="bottom"]')!.getBoundingClientRect();
    const m = document.querySelector('[data-mini-player]')?.getBoundingClientRect();
    const top = m ? m.top : bar.top;
    const f = k === 'page' ? 2 : 1;
    return { header: Math.round(head * f), tabbar: Math.round(bar.height * f), mini: m ? Math.round(m.height * f) : 0, reading: Math.round((top - head) * f), screen: Math.round(innerHeight * f) };
  }, kind);
}

for (const lang of LANGS) {
  test(`V39-03 (QA v38 FIND-CB, D-205, AC6, AC7, AC91, D-207 B): at 200% the fixed bottom area is smaller, nothing overlaps or is cut off, and focused controls are never behind it, ${lang}`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    for (const [kind, w] of [['normal', 390], ['text', 390], ['text', 320], ['page', 195]] as [Zoom, number][]) {
      const ctx = await zoomed(browser, kind, w);
      const page = await ctx.newPage();
      await serveAudio(page, len);
      await page.goto(P(lang, '2/'));
      await hydrated(page);
      const tag = `${kind} ${w}`;
      // Scrolled into the surah, so only the sticky header and the fixed bottom area are measured.
      await page.evaluate(() => scrollTo(0, 1500));
      await page.waitForTimeout(200);
      const quiet = await space(page, kind);
      await page.evaluate(() => scrollTo(0, 0));
      // AC6, 2.4.11: Play surah reached by keyboard is scrolled clear of the tab bar.
      await page.locator('[data-play-surah]').focus();
      const clear = await page.evaluate(() => { const b = document.querySelector('[data-play-surah]')!.getBoundingClientRect(); return b.bottom <= document.querySelector('nav[data-tabbar="bottom"]')!.getBoundingClientRect().top + 1; });
      expect(clear, `${tag}: Play surah above the tab bar when focused`).toBe(true);
      await playSurah(page, 2);
      await seekTo(page, 4 * STEP + 500);
      await expect.poll(() => marked(page)).toEqual([5]);
      await expect(mini(page)).toBeVisible();
      await page.waitForTimeout(300);
      const busy = await space(page, kind);
      info.annotations.push({ type: 'reading-space', description: `${lang} ${tag}: no recitation ${JSON.stringify(quiet)}; with recitation ${JSON.stringify(busy)}` });
      const r = await page.evaluate(() => {
        const bar = document.querySelector('nav[data-tabbar="bottom"]')!;
        const box = document.querySelector('[data-mini-player]')!;
        const items = [...bar.querySelectorAll('a'), ...box.querySelectorAll('button, a')].map((a) => a.getBoundingClientRect());
        let overlap = false;
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const A = items[i], B = items[j]; if (A.left < B.right - 0.5 && B.left < A.right - 0.5 && A.top < B.bottom - 0.5 && B.top < A.bottom - 0.5) overlap = true; }
        const lines = [...bar.querySelectorAll('.tab-label')].map((l) => { const rg = document.createRange(); rg.selectNodeContents(l); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; });
        const m = box.getBoundingClientRect(), b = bar.getBoundingClientRect();
        const btns = [...box.querySelectorAll('button, a')].map((x) => x.getBoundingClientRect());
        let gap = Infinity;
        for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) { const A = btns[i], B = btns[j]; gap = Math.min(gap, Math.max(B.left - A.right, A.left - B.right, B.top - A.bottom, A.top - B.bottom)); }
        return { overlap, lines: Math.max(...lines), minTarget: Math.min(...items.map((x) => Math.min(x.width, x.height))), off: items.some((x) => x.left < -0.5 || x.right > innerWidth + 0.5 || x.bottom > innerHeight + 0.5), miniAbove: m.bottom <= b.top + 1, gap, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      expect(r.overlap, tag).toBe(false);
      expect(r.off, tag).toBe(false);
      expect(r.lines, `${tag}: one line per tab label`).toBe(1);
      expect(r.minTarget, `${tag}: 44 px targets`).toBeGreaterThanOrEqual(44);
      expect(r.gap, `${tag}: 8 px between mini-player buttons`).toBeGreaterThanOrEqual(8);
      expect(r.miniAbove, `${tag}: mini-player above the tab bar`).toBe(true);
      expect(r.sw, tag).toBeLessThanOrEqual(r.cw);
      // The fixed bottom area with a recitation loaded. QA v38 measured 491 of 844 px at 200% text
      // (tab bar 177, mini-player 314). Text zoom: at most a third of the screen. Page zoom (a 195 px
      // wide page): two rows of 44 px tabs and the mini-player's buttons cannot share fewer rows, so
      // at most 55% (kit v38 on the same stand-in: see the hand-back).
      expect(busy.tabbar + busy.mini, `${tag}: fixed bottom area`).toBeLessThanOrEqual((kind === 'page' ? 0.55 : 0.34) * busy.screen);
      // A control focused near the end of the page is scrolled clear of the mini-player and tab bar.
      await page.locator('.surah-nav-end a').last().focus();
      const endClear = await page.evaluate(() => { const a = [...document.querySelectorAll('.surah-nav-end a')].pop()!.getBoundingClientRect(); return a.bottom <= document.querySelector('[data-mini-player]')!.getBoundingClientRect().top + 1; });
      expect(endClear, `${tag}: end link above the mini-player when focused`).toBe(true);
      await ctx.close();
    }
  });
}

test('V39-04 (QA v38 FIND-BW, RQ-006 AC20): playing from an ayah far down shows the loading message in the mini-player', async ({ page }) => {
  await serveAudio(page, len);
  await page.setViewportSize(MOBILE);
  // The metadata answer is held back, so the loading state (after 1 s) shows.
  await page.route('**/api/audio', async (r) => { await new Promise((ok) => setTimeout(ok, 3500)); await r.continue(); });
  await page.goto('/2/#a200');
  await hydrated(page);
  await openAyah(page, 200);
  await page.locator('dialog[data-ayah-panel] [data-act-play-from]').click();
  await expect(mini(page)).toBeVisible();
  await expect(mini(page)).toHaveAttribute('data-loading', '1');
  const cue = mini(page).locator('[data-mini-state="loading"]');
  await expect(cue).toHaveText(t('ar', 'audioLoading'));
  await expect(cue).toBeInViewport();
  // The row at the top of the surah is off screen; the cue is where the reader is.
  expect(await page.locator('[data-audio-status]').evaluate((e) => e.getBoundingClientRect().bottom < 0)).toBe(true);
  await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused; }, { timeout: 10_000 }).toBe(true);
  await expect(mini(page)).toHaveAttribute('data-loading', '0');
  await expect(mini(page).locator('[data-mini-state]')).toHaveCount(0);
});

test('V39-05 (QA v38 FIND-BX, AC26): a double click on an ayah selects a word and opens no panel; a single click still opens it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/2/#a10');
  await hydrated(page);
  const ay = page.locator('p.ayah[data-r="2:10"]');
  const box = (await ay.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + 20;
  for (let i = 0; i < 3; i++) {
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(700);
    expect(await page.locator('dialog[data-ayah-panel]').evaluate((d) => (d as HTMLDialogElement).open), 'double click: no panel').toBe(false);
    const sel = await page.evaluate(() => getSelection()?.toString() ?? '');
    expect(sel.trim().length, 'double click: a word is selected').toBeGreaterThan(0);
    expect(/\s/.test(sel.trim()), 'one word').toBe(false);
    await page.evaluate(() => getSelection()?.removeAllRanges());
  }
  // A slower double click: the panel opened by the first click stays open (no flicker).
  await page.mouse.click(x, y);
  await page.waitForTimeout(450);
  // The second click of a slow double click (detail 2), landing on the dimmed area.
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(300);
  expect(await page.locator('dialog[data-ayah-panel]').evaluate((d) => (d as HTMLDialogElement).open), 'slow double click: panel stays open').toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', false);
  // A single click opens it.
  await page.mouse.click(x, y);
  await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
  await expect(page.locator('dialog[data-ayah-panel] [data-act-title]')).toBeFocused();
});

for (const lang of LANGS) {
  test(`V39-06 (D-208 C, AC43, AC39, P-8): Tafseer previous and next show the target ayah in the panel and on the page; names keep the direction; edges unchanged, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    const check = async (root: string, a: number, count: number) => {
      const prev = page.locator(`${root} [data-tf-prev]`), next = page.locator(`${root} [data-tf-next]`);
      if (a > 1) {
        await expect(prev).toHaveText(t(lang, 'audioNowAyah', { a: a - 1 }));
        await expect(prev).toHaveAccessibleName(t(lang, 'prevAyahTo', { a: a - 1 }));
      }
      if (a < count) {
        await expect(next).toHaveText(t(lang, 'audioNowAyah', { a: a + 1 }));
        await expect(next).toHaveAccessibleName(t(lang, 'nextAyahTo', { a: a + 1 }));
      }
      for (const b of [prev, next]) if (await b.count()) { const bb = (await b.boundingBox())!; expect(bb.height).toBeGreaterThanOrEqual(44); }
    };
    // The page.
    await page.goto(P(lang, 'tafseer/2/#a5'));
    await hydrated(page);
    await expect(page.locator('main [data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
    await check('main', 5, n(2));
    const pageNav = await page.locator('main .tf-nav').innerHTML();
    // The panel: the same buttons, character for character (AC39).
    await page.goto(P(lang, '2/#a5;tafseer'));
    await hydrated(page);
    await expect(page.locator('dialog[data-tf-panel]')).toHaveJSProperty('open', true);
    await expect(page.locator('dialog[data-tf-panel] [data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
    await check('dialog[data-tf-panel]', 5, n(2));
    expect(await page.locator('dialog[data-tf-panel] .tf-nav').innerHTML()).toBe(pageNav);
    await page.locator('dialog[data-tf-panel] [data-tf-next]').click();
    await expect(page).toHaveURL(/#a6;tafseer$/);
    await check('dialog[data-tf-panel]', 6, n(2));
    // Directional icons mirror in Arabic only.
    const tr = await page.locator('dialog[data-tf-panel] [data-tf-next] svg').evaluate((s) => getComputedStyle(s).transform);
    if (lang === 'ar') expect(tr).not.toBe('none'); else expect(tr).toBe('none');
    // Edges (P-8): the first ayah's previous and the last ayah's next keep their kit v38 labels.
    await page.goto(P(lang, 'tafseer/2/#a1'));
    await hydrated(page);
    await expect(page.locator('main [data-tf-prev]')).toHaveText(t(lang, 'prevAyah'));
    await expect(page.locator('main [data-tf-prev]')).toHaveAttribute('data-tf-edge');
    await page.goto(P(lang, `tafseer/2/#a${n(2)}`));
    await hydrated(page);
    await expect(page.locator('main [data-tf-next]')).toHaveText(t(lang, 'nextAyah'));
    await page.goto(P(lang, 'tafseer/1/#a1'));
    await hydrated(page);
    await expect(page.locator('main [data-tf-prev]')).toHaveCount(0);
  });
}

for (const lang of LANGS) {
  test(`V39-07 (D-207 B, RQ-006 AC28): previous and next ayah in the mini-player act on the playing recitation; 44 px, 8 px apart, named, mirrored in Arabic; disabled at the surah's edges, ${lang}`, async ({ page }) => {
    test.setTimeout(120_000);
    await serveAudio(page, len);
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '1/'));
    await hydrated(page);
    await playSurah(page, 1);
    await seekTo(page, 2 * STEP + 500);
    await expect.poll(() => marked(page)).toEqual([3]);
    const prev = mini(page).locator('[data-mini-prev]'), next = mini(page).locator('[data-mini-next]');
    await expect(prev).toHaveAccessibleName(t(lang, 'prevAyah'));
    await expect(next).toHaveAccessibleName(t(lang, 'nextAyah'));
    // Order: previous, play/pause, next (keyboard order too).
    const ids = await mini(page).locator('button, a').evaluateAll((bs) => bs.map((b) => [...b.attributes].map((x) => x.name).find((x) => x.startsWith('data-mini-')) ?? ''));
    expect(ids.slice(0, 3)).toEqual(['data-mini-prev', 'data-mini-toggle', 'data-mini-next']);
    for (const b of [prev, next]) { const bb = (await b.boundingBox())!; expect(bb.width).toBeGreaterThanOrEqual(44); expect(bb.height).toBeGreaterThanOrEqual(44); }
    const tr = await prev.locator('svg').evaluate((s) => getComputedStyle(s).transform);
    if (lang === 'ar') expect(tr).not.toBe('none'); else expect(tr).toBe('none');
    await next.click();
    await expect.poll(() => marked(page)).toEqual([4]);
    await prev.click();
    await prev.click();
    await expect.poll(() => marked(page)).toEqual([2]);
    // Keyboard.
    await next.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => marked(page)).toEqual([3]);
    // Edges: first ayah, previous disabled; last ayah, next disabled.
    await prev.click(); await prev.click();
    await expect.poll(() => marked(page)).toEqual([1]);
    await expect(prev).toBeDisabled();
    await seekTo(page, (n(1) - 1) * STEP + 300);
    await expect.poll(() => marked(page)).toEqual([n(1)]);
    await expect(next).toBeDisabled();
    // Paused: next moves the mark and plays, as v37's buttons did.
    await mini(page).locator('[data-mini-toggle]').click();
    await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
    await prev.click();
    await expect.poll(() => marked(page)).toEqual([n(1) - 1]);
    // On another page the buttons act on the same recitation.
    await page.click('nav[data-tabbar]:visible a[data-tab="saved"]');
    await expect(page).toHaveURL(/saved\/$/);
    await expect(mini(page)).toBeVisible();
    const before = await page.evaluate(() => (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime);
    await mini(page).locator('[data-mini-prev]').click();
    await expect.poll(() => page.evaluate(() => (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime)).toBeLessThan(before - 2);
  });
}
