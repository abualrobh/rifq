// Kit v40: D-216 A and D-213 A (one Go to box; Enter opens the first direct result, otherwise runs the
// word search; QA v39 FIND-CD), QA v39 FIND-CE (the reader's Go to button focuses the box), V39-H1 (the
// ayah actions button stays hidden after a panel opened by a tap or click closes) and RQ-008 stage 4
// (D-199: first-visit tips AC79 to AC85 and Show tips again). Arabic and English, made-up data (the
// local mock), disposable profiles. No Arabic characters and no Quran text in this file: expected
// text comes from the source file and strings.ts.
import type { Browser, Page } from '@playwright/test';
import { test, expect, surahs, src, MOBILE, hydrated, settle, ROOT_200, rootFontPx, TIPS_SEEN_SCRIPT } from './helpers.ts';
import { gotoResults } from '../../src/core/goto.ts';
import { foldName } from '../../src/core/surah-match.ts';
import { juzStarts } from '../../src/core/source-adapter.ts';
import { t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';

test.use({ allowHosts: [AUDIO_HOST] });

const LANGS: Lang[] = ['ar', 'en'];
const home = (l: Lang) => (l === 'ar' ? '/' : '/en/');
const P = (l: Lang, p: string) => home(l) + p;
const nameOf = (l: Lang, s: number) => (l === 'ar' ? surahs[s - 1].ar : surahs[s - 1].en);
const n = (s: number) => surahs[s - 1].items.length;
const juz = juzStarts(src.list);
const searches = (seen: { url: string }[], from: number) => seen.slice(from).filter((s) => new URL(s.url).pathname === '/api/search');
// The Go to view's own rule (core/goto.ts) on the source's data, to pick a word with no direct result.
const folded = ['', ...surahs.map((s) => foldName(s.ar))];
const counts = [0, ...surahs.map((s) => s.items.length)];
function wordWithoutDirect(): string {
  for (const it of src.list) for (const w of it.aya_text.split(' ')) {
    if ([...w].length < 3 || /\d/.test(w)) continue;
    if (!gotoResults(w, { lang: 'ar', folded, counts, juz }).results.length && !gotoResults(w, { lang: 'ar', folded, counts, juz }).msg) return w;
  }
  throw new Error('no word without a direct result');
}

async function typeIn(page: Page, q: string) {
  const st = page.locator('main [data-goto-status]');
  const before = await st.getAttribute('data-seq');
  await page.fill('main [data-goto-input]', q);
  await expect(st).not.toHaveAttribute('data-seq', String(before));
}

for (const lang of LANGS) {
  test(`V40-01 (D-216 A, AC59): Go to has one box, no word-search heading or row, the how-to hint under the box, and a Search key, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    for (const p of ['search/', '']) {
      await page.goto(P(lang, p));
      await hydrated(page);
      const v = page.locator('main [data-goto]');
      await expect(v.locator('input')).toHaveCount(2); // the box and the hidden lang field
      await expect(v.locator('[data-goto-input]')).toHaveAttribute('enterkeyhint', 'search');
      await expect(v.locator('[data-goto-word]')).toHaveCount(0);
      await expect(v.locator('.goto-h')).toHaveText([t(lang, 'youCanType')]);
      await expect(v.locator('[data-goto-how]')).toHaveText(t(lang, 'gotoHowTo'));
      // The hint is right under the box and describes it.
      const order = await v.evaluate((root) => { const f = root.querySelector('.goto-field')!; const h = root.querySelector('[data-goto-how]')!; return f.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING ? h.previousElementSibling === f : false; });
      expect(order).toBe(true);
      expect((await v.locator('[data-goto-input]').getAttribute('aria-describedby'))!.split(' ')).toContain('q-how');
    }
  });

  test(`V40-02 (D-213 A, FIND-CD, AC68): Enter opens the first direct result in place, with no word search and no "No results", ${lang}`, async ({ page, seen }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, 'search/'));
    await hydrated(page);
    await page.evaluate(() => { (window as unknown as { __doc: number }).__doc = 1; });
    const from = seen.length;
    await typeIn(page, '2:255');
    await expect(page.locator('[data-goto-result]').first()).toHaveAttribute('data-goto-ref', '2:255');
    await page.locator('[data-goto-input]').press('Enter');
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}#a255$`));
    await expect(page.locator('li#a255')).toBeInViewport();
    expect(await page.evaluate(() => (window as unknown as { __doc?: number }).__doc)).toBe(1); // in place
    expect(searches(seen, from).length).toBe(0);
    // A surah name, the juz keyword (from a chip) and the home box.
    for (const [q, url] of [[nameOf(lang, 36), P(lang, '36/')], [`${t(lang, 'kindJuz')} 30`, `${P(lang, `${juz.find((j) => j.juz === 30)!.s}/`)}#a${juz.find((j) => j.juz === 30)!.a}`]] as const) {
      await page.goto(P(lang, 'search/'));
      await hydrated(page);
      await typeIn(page, q);
      await expect(page.locator('[data-goto-result]').first()).toBeVisible();
      await page.locator('[data-goto-input]').press('Enter');
      await expect(page).toHaveURL(new RegExp(`${url.replace(/[/]/g, '\\/')}$`));
    }
    await page.goto(P(lang, ''));
    await hydrated(page);
    await typeIn(page, '36');
    await page.locator('[data-home-goto] [data-goto-input]').press('Enter');
    await expect(page).toHaveURL(new RegExp(`${P(lang, '36/')}$`));
    expect(searches(seen, from).length).toBe(0);
  });

  test(`V40-03 (D-213 A, AC66, FIND-CD): Enter with no direct result runs the word search once; one announcement; typing a reference clears the old answer; a box message sends nothing, ${lang}`, async ({ page, seen }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, 'search/'));
    await hydrated(page);
    const word = wordWithoutDirect();
    const from = seen.length;
    await typeIn(page, word);
    await expect(page.locator('[data-goto-result]')).toHaveCount(0);
    await page.locator('[data-goto-input]').press('Enter');
    await expect.poll(() => searches(seen, from).length).toBe(1);
    const post = searches(seen, from)[0] as { url: string; method: string; body: string | null };
    expect(post.method).toBe('POST');
    expect(post.url).not.toContain(encodeURIComponent(word));
    expect(JSON.parse(post.body!).q).toBe(word);
    await expect(page.locator('[data-search-status]')).not.toHaveText('');
    await expect(page.locator('[data-search-status]')).not.toHaveText(t(lang, 'searching'));
    await settle(page);
    // One live region speaks: the Go to status is empty.
    await expect(page.locator('[data-goto-status]')).toHaveText('');
    // Now a reference: its direct results, and the word search's old answer is gone (no "No results").
    await typeIn(page, '2:255');
    await expect(page.locator('[data-goto-result]')).toHaveCount(2);
    await expect(page.locator('[data-goto-status]')).toHaveText(t(lang, 'offerCount', { n: 2 }));
    await expect(page.locator('[data-search-status]')).toHaveText('');
    await expect(page.locator('[data-results]')).toHaveCount(0);
    // A reference out of range: the box says refMissing; Enter sends nothing and adds no message.
    await typeIn(page, `2:${n(2) + 1}`);
    await expect(page.locator('[data-goto-status]')).toHaveText(t(lang, 'refMissing'));
    await page.locator('[data-goto-input]').press('Enter');
    await page.waitForTimeout(400);
    expect(searches(seen, from).length).toBe(1);
    await expect(page.locator('[data-search-status]')).toHaveText('');
    await expect(page.locator('[data-goto-input]')).toBeFocused();
    // An empty box: the word search's own empty message, as RQ-002.
    await typeIn(page, '');
    await page.locator('[data-goto-input]').press('Enter');
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'empty'));
    expect(searches(seen, from).length).toBe(1);
  });

  test(`V40-04 (FIND-CE): the reader's Go to button opens the Go to screen with focus in the box (tap and keyboard), ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await page.locator('header [data-reader-goto]').click();
    await expect(page).toHaveURL(new RegExp(`${P(lang, 'search/')}$`));
    await expect(page.locator('main [data-goto-input]')).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    // Typing goes straight into the box.
    await page.keyboard.type('2:255');
    await expect(page.locator('[data-goto-result]').first()).toHaveAttribute('data-goto-ref', '2:255');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}$`));
    await hydrated(page);
    await page.locator('header [data-reader-goto]').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${P(lang, 'search/')}$`));
    await expect(page.locator('main [data-goto-input]')).toBeFocused();
    // The Search tab is unchanged: focus on the main content.
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await page.locator('nav[data-tabbar]:visible a[data-tab="search"]').click();
    await expect(page).toHaveURL(new RegExp(`${P(lang, 'search/')}$`));
    await expect(page.locator('main#content')).toBeFocused();
  });
}

const opacity = (page: Page, a: number) => page.locator(`button.ayah-act[data-act="${a}"]`).evaluate((b) => getComputedStyle(b).opacity);

for (const lang of LANGS) {
  test(`V40-05 (V39-H1, P-22, AC26, AC34): after a panel opened by a tap or click closes, focus is back on the actions button and it stays hidden; keyboard use shows it, ${lang}`, async ({ browser }) => {
    // A phone: touch, no hover.
    const ctx = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812', hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await page.locator('p.ayah[data-r="2:3"]').tap();
    await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
    await page.locator('dialog[data-ayah-panel] [data-act-close]').tap();
    await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', false);
    await expect(page.locator('button.ayah-act[data-act="3"]')).toBeFocused();
    expect(await opacity(page, 3)).toBe('0');
    // The same after the Tafseer panel (opened from the actions panel by a tap), and after a tap on
    // the (hidden) button itself.
    await page.locator('p.ayah[data-r="2:4"]').tap();
    await page.locator('dialog[data-ayah-panel] [data-act-tafseer]').tap();
    await expect(page.locator('dialog[data-tf-panel]')).toHaveJSProperty('open', true);
    await page.locator('dialog[data-tf-panel] [data-tfp-close]').tap();
    await expect(page.locator('dialog[data-tf-panel]')).toHaveJSProperty('open', false);
    await expect(page.locator('button.ayah-act[data-act="4"]')).toBeFocused();
    expect(await opacity(page, 4)).toBe('0');
    await page.locator('button.ayah-act[data-act="5"]').tap();
    await page.locator('dialog[data-ayah-panel] [data-act-close]').tap();
    await expect(page.locator('button.ayah-act[data-act="5"]')).toBeFocused();
    expect(await opacity(page, 5)).toBe('0');
    // A key pressed now shows it (the reader has started using the keyboard).
    await page.keyboard.press('Shift');
    expect(await opacity(page, 5)).toBe('1');
    await ctx.close();

    // A desktop: mouse click opens and closes; hidden after close until hovered; keyboard shows it.
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: 'http://127.0.0.1:8812' });
    const p2 = await c2.newPage();
    await p2.goto(P(lang, '2/'));
    await hydrated(p2);
    await p2.locator('p.ayah[data-r="2:3"]').click();
    await expect(p2.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
    await p2.locator('dialog[data-ayah-panel] [data-act-close]').click();
    await expect(p2.locator('button.ayah-act[data-act="3"]')).toBeFocused();
    await p2.mouse.move(5, 5);
    expect(await opacity(p2, 3)).toBe('0');
    await p2.locator('button.ayah-act[data-act="3"]').hover();
    expect(await opacity(p2, 3)).toBe('1');
    await p2.mouse.move(5, 5);
    // Keyboard: Tab to the button, Enter opens, Esc closes: focus back and the button shown (AC34).
    await p2.locator('button.ayah-act[data-act="2"]').focus();
    await p2.keyboard.press('Tab');
    await expect(p2.locator('button.ayah-act[data-act="3"]')).toBeFocused();
    expect(await opacity(p2, 3)).toBe('1');
    await p2.keyboard.press('Enter');
    await expect(p2.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
    await p2.keyboard.press('Escape');
    await expect(p2.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', false);
    await expect(p2.locator('button.ayah-act[data-act="3"]')).toBeFocused();
    expect(await opacity(p2, 3)).toBe('1');
    // Opened by keyboard, closed by the Close button with Enter: shown.
    await p2.keyboard.press('Enter');
    await expect(p2.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
    await p2.locator('dialog[data-ayah-panel] [data-act-close]').focus();
    await p2.keyboard.press('Enter');
    await expect(p2.locator('button.ayah-act[data-act="3"]')).toBeFocused();
    expect(await opacity(p2, 3)).toBe('1');
    // Hidden by a click, then Tab away and Shift+Tab back: shown (the quiet state ends with the focus).
    await p2.locator('p.ayah[data-r="2:6"]').click();
    await expect(p2.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
    await p2.locator('dialog[data-ayah-panel] [data-act-close]').click();
    await expect(p2.locator('button.ayah-act[data-act="6"]')).toBeFocused();
    await p2.mouse.move(5, 5);
    expect(await opacity(p2, 6)).toBe('0');
    await p2.keyboard.press('Tab');
    await p2.keyboard.press('Shift+Tab');
    await expect(p2.locator('button.ayah-act[data-act="6"]')).toBeFocused();
    expect(await opacity(p2, 6)).toBe('1');
    await c2.close();
  });
}

// ----- RQ-008 stage 4: first-visit tips -----
test.describe('tips', () => {
  test.use({ tipsSeen: false });
  const dlg = (page: Page) => page.locator('dialog[data-tips]');
  const blockStorage = (page: Page) => page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); });

  for (const lang of LANGS) {
    test(`V40-06 (AC79, AC80, AC82, AC83): a new device sees tip 1 of 3 on the first reader page only; Next, Done; focus moves in, stays in and returns; recorded once, ${lang}`, async ({ page, seen }) => {
      await page.setViewportSize(MOBILE);
      await page.goto(P(lang, ''));
      await hydrated(page);
      await page.waitForTimeout(800);
      await expect(dlg(page)).toHaveCount(0); // home: no tips
      const from = seen.length;
      await page.goto(P(lang, '2/'));
      await expect(page.locator('p.ayah[data-r="2:1"]')).toBeVisible();
      await expect(dlg(page)).toHaveJSProperty('open', true);
      // Modal: the page behind is inert (a native modal dialog).
      expect(await page.evaluate(() => document.querySelector('dialog[data-tips]')!.matches(':modal'))).toBe(true);
      await expect(dlg(page)).toHaveAccessibleName(`${t(lang, 'tipOf', { n: 1, m: 3 })} ${t(lang, 'tip1Title')}`.replace(/ +/g, ' '));
      await expect(dlg(page).locator('[data-tip-count]')).toHaveText(t(lang, 'tipOf', { n: 1, m: 3 }));
      await expect(dlg(page).locator('[data-tip-title]')).toHaveText(t(lang, 'tip1Title'));
      await expect(dlg(page).locator('[data-tip-body]')).toHaveText(t(lang, 'tip1Body'));
      await expect(dlg(page).locator('h2')).toBeFocused();
      for (const b of ['[data-tip-skip]', '[data-tip-next]']) { const bb = (await dlg(page).locator(b).boundingBox())!; expect(bb.height, b).toBeGreaterThanOrEqual(44); expect(bb.width, b).toBeGreaterThanOrEqual(44); }
      // Focus stays inside.
      for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[data-tips]'))).toBe(true); }
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[data-tips]'))).toBe(true);
      await dlg(page).locator('[data-tip-next]').click();
      await expect(dlg(page).locator('[data-tip-count]')).toHaveText(t(lang, 'tipOf', { n: 2, m: 3 }));
      await expect(dlg(page).locator('[data-tip-title]')).toHaveText(t(lang, 'tip2Title'));
      await expect(dlg(page).locator('[data-tip-body]')).toHaveText(t(lang, 'tip2Body'));
      await expect(dlg(page).locator('h2')).toBeFocused();
      await dlg(page).locator('[data-tip-next]').click();
      await expect(dlg(page).locator('[data-tip-title]')).toHaveText(t(lang, 'tip3Title'));
      await expect(dlg(page).locator('[data-tip-body]')).toHaveText(t(lang, 'tip3Body'));
      await expect(dlg(page).locator('[data-tip-next]')).toHaveCount(0);
      await expect(dlg(page).locator('[data-tip-done]')).toHaveText(t(lang, 'done'));
      await expect(dlg(page).locator('[data-tip-skip]')).toHaveText(t(lang, 'tipSkip'));
      await dlg(page).locator('[data-tip-done]').click();
      await expect(dlg(page)).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('rifq.tips'))).toBe('1');
      // AC87: nothing about the tips is sent.
      for (const s of seen.slice(from)) { expect(s.url).not.toContain('tip'); expect(s.body ?? '').not.toContain('tip'); }
      // Never again on this device, in either interface.
      for (const p of [P(lang, '3/'), P(lang === 'ar' ? 'en' : 'ar', '2/')]) {
        await page.goto(p);
        await hydrated(page);
        await page.waitForTimeout(800);
        await expect(dlg(page)).toHaveCount(0);
      }
    });
  }

  test('V40-07 (AC80, AC82): Skip and Esc close the tips and record them seen; focus returns to where it was', async ({ browser }) => {
    for (const how of ['skip', 'esc'] as const) {
      const ctx = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
      const page = await ctx.newPage();
      await page.goto('/2/');
      await expect(dlg(page)).toHaveJSProperty('open', true);
      if (how === 'skip') await dlg(page).locator('[data-tip-skip]').click(); else await page.keyboard.press('Escape');
      await expect(dlg(page)).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('rifq.tips'))).toBe('1');
      expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.id === 'content')).toBe(true);
      await page.reload();
      await hydrated(page);
      await page.waitForTimeout(800);
      await expect(dlg(page)).toHaveCount(0);
      await ctx.close();
    }
  });

  for (const lang of LANGS) {
    test(`V40-08 (AC85): Show tips again in Settings clears "tips seen", says so, and the tips show on the next reader page, ${lang}`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await page.goto(P(lang, '2/'));
      await expect(dlg(page)).toHaveJSProperty('open', true);
      await page.keyboard.press('Escape');
      await page.locator('nav[data-tabbar]:visible a[data-tab="settings"]').click();
      await expect(page).toHaveURL(/settings\/$/);
      await hydrated(page);
      const b = page.locator('[data-set-tips-again]');
      await expect(b).toHaveText(t(lang, 'tipsAgain'));
      const bb = (await b.boundingBox())!; expect(bb.height).toBeGreaterThanOrEqual(44);
      // AC70 order: after the reciter part (audio builds), before the device data.
      // Kit v43 (RQ-009 AC1): builds with page mode have the Reading view section after Text size.
      const v = await page.locator('.settings-screen > section[data-set-view]').count();
      expect(await page.evaluate(() => { const s = [...document.querySelectorAll('.settings-screen > section')]; return [s.findIndex((x) => x.hasAttribute('data-set-reciter')), s.findIndex((x) => x.hasAttribute('data-set-tips')), s.findIndex((x) => x.hasAttribute('data-set-data'))]; })).toEqual([3 + v, 4 + v, 5 + v]);
      await b.click();
      await expect(page.locator('[data-set-tips-status]')).toHaveText(t(lang, 'tipsAgainDone'));
      expect(await page.evaluate(() => localStorage.getItem('rifq.tips'))).toBeNull();
      await expect(dlg(page)).toHaveCount(0);
      // The next reader page, reached in place (no last position yet, so through the index).
      await page.locator('nav[data-tabbar]:visible a[data-tab="home"]').click();
      await page.locator('[data-home-juz-link="1"]').click();
      await expect(page).toHaveURL(new RegExp(`${P(lang, '1/')}`));
      await expect(dlg(page)).toHaveJSProperty('open', true);
      await expect(dlg(page).locator('[data-tip-count]')).toHaveText(t(lang, 'tipOf', { n: 1, m: 3 }));
    });
  }

  test('V40-09 (AC81): storage blocked: the tips never show by themselves; Settings opens them at once, and focus returns to the button', async ({ page }) => {
    await blockStorage(page);
    await page.setViewportSize(MOBILE);
    await page.goto('/2/');
    await hydrated(page);
    await page.waitForTimeout(1500);
    await expect(dlg(page)).toHaveCount(0);
    await page.goto('/settings/');
    await hydrated(page);
    await page.locator('[data-set-tips-again]').click();
    await expect(dlg(page)).toHaveJSProperty('open', true);
    await expect(dlg(page).locator('[data-tip-count]')).toHaveText(t('ar', 'tipOf', { n: 1, m: 3 }));
    await dlg(page).locator('[data-tip-skip]').click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator('[data-set-tips-again]')).toBeFocused();
    await expect(page.locator('[data-set-tips-status]')).toHaveText('');
  });

  test('V40-10 (AC84): opened on the Tafseer panel, the tips wait; while a recitation plays they wait; they show once both have ended', async ({ page }) => {
    const { serveAudio, audioState } = await import('./audio-helpers.ts');
    await serveAudio(page, (s) => n(s) * 5000);
    await page.setViewportSize(MOBILE);
    await page.goto('/2/#a3;tafseer');
    await expect(page.locator('dialog[data-tf-panel]')).toHaveJSProperty('open', true);
    await page.waitForTimeout(1500);
    await expect(dlg(page)).toHaveCount(0);
    // Play the ayah from the panel, then close the panel: still waiting while it plays.
    await page.locator('dialog[data-tf-panel] [data-tfp-play]').click();
    await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused; }).toBe(true);
    await page.locator('dialog[data-tf-panel] [data-tfp-close]').click();
    await expect(page.locator('dialog[data-tf-panel]')).toHaveJSProperty('open', false);
    await page.waitForTimeout(1500);
    await expect(dlg(page)).toHaveCount(0);
    await page.evaluate(() => (document.querySelector('audio[data-audio]') as HTMLAudioElement).pause());
    await expect(dlg(page)).toHaveJSProperty('open', true);
  });

  // QA FIND-CK (kit v42): the 200% text is now really applied (ROOT_200, checked: root font 32 px).
  // Layout shift is counted in two parts: the reader's own load with the tips opening (from the first
  // paint until 1.2 s after the tips show), and stepping through the tips. At 200% the load part is
  // the reader's known jump on load at large text (QA FIND-CJ, D-262; fixed in kit v43): it is
  // measured also without the tips (V40-11b).
  type TipsCls = { load: number; tips: number };
  const CLS_SCRIPT = () => { const x = window as unknown as { __cls: number }; x.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) x.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); };
  const clsNow = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  async function tipsRun(browser: Browser, lang: Lang, w: number, big: boolean): Promise<TipsCls> {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, baseURL: 'http://127.0.0.1:8812' });
    if (big) await ctx.addInitScript(ROOT_200);
    const page = await ctx.newPage();
    await page.addInitScript(CLS_SCRIPT);
    await page.goto(P(lang, '2/'));
    await expect(dlg(page)).toHaveJSProperty('open', true);
    expect(await rootFontPx(page), `${w} ${big}: root font`).toBe(big ? 32 : 16);
    await page.waitForTimeout(1200);
    const load = await clsNow(page);
    await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0; });
    for (let i = 0; i < 3; i++) {
      const r = await page.evaluate(() => { const d = document.querySelector('dialog[data-tips]')!.getBoundingClientRect(); return { l: d.left, r: d.right, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: innerWidth }; });
      expect(r.sw, `${w} ${big}`).toBeLessThanOrEqual(r.cw);
      expect(r.l).toBeGreaterThanOrEqual(0);
      expect(r.r).toBeLessThanOrEqual(r.iw);
      const next = dlg(page).locator('[data-tip-next]');
      if (await next.count()) await next.click();
    }
    await page.waitForTimeout(600);
    const tips = await clsNow(page);
    await ctx.close();
    return { load: Math.round(load * 10000) / 10000, tips: Math.round(tips * 10000) / 10000 };
  }
  // The reader's load alone at 200% (the tips already seen on this device), for comparison.
  async function readerLoadOnly(browser: Browser, lang: Lang, w: number): Promise<number> {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, baseURL: 'http://127.0.0.1:8812' });
    await ctx.addInitScript(TIPS_SEEN_SCRIPT);
    await ctx.addInitScript(ROOT_200);
    const page = await ctx.newPage();
    await page.addInitScript(CLS_SCRIPT);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    expect(await rootFontPx(page)).toBe(32);
    await expect(dlg(page)).toHaveCount(0);
    await page.waitForTimeout(1200);
    const v = await clsNow(page);
    await ctx.close();
    return Math.round(v * 10000) / 10000;
  }

  for (const lang of LANGS) {
    test(`V40-11 (AC91, AC92, AC93): the tips at 390 and 320 px, 100% and 200% text, light: inside the screen, no sideways scroll; layout shift of the tips 0.1 or less, and of the reader load with the tips 0.1 or less; ${lang}`, async ({ browser }, info) => {
      const out: Record<string, TipsCls> = {};
      for (const [w, big] of [[390, false], [320, false], [390, true], [320, true]] as const) {
        const r = await tipsRun(browser, lang, w, big);
        expect(r.tips, `tips ${w} ${big}`).toBeLessThanOrEqual(0.1);
        // Kit v43 (D-279 (4), FIND-CJ fixed): the load is asserted at 200% too.
        expect(r.load, `load ${w} ${big}`).toBeLessThanOrEqual(0.1);
        out[`${w} ${big ? 200 : 100}%`] = r;
      }
      info.annotations.push({ type: 'cls', description: JSON.stringify(out) });
    });
    // Kit v42 V40-11b was an expected failure (known D-262, QA FIND-CJ). Kit v43 (D-279 (1) FIND-CV,
    // D-279 (4)): FIND-CJ is fixed (the large-text class is set before the first paint, and the
    // interface font is fetched early), so V40-11b is an ordinary test: the reader's own load at 200%
    // text without the tips (tips seen), 390 and 320 px, has a layout shift of 0.1 or less, and the
    // root font really is 32 px.
    test(`V40-11b (AC93, QA FIND-CJ fixed in kit v43): the reader's load at 200% text without the tips, 390 and 320 px, has a layout shift of 0.1 or less, ${lang}`, async ({ browser }, info) => {
      const out: Record<string, number> = {};
      for (const w of [390, 320]) out[w] = await readerLoadOnly(browser, lang, w);
      info.annotations.push({ type: 'cls', description: JSON.stringify(out) });
      for (const w of [390, 320]) expect(out[w], `200% ${w}`).toBeLessThanOrEqual(0.1);
    });
  }
});
