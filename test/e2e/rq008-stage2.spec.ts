// RQ-008 v1.0 stage 2 (kit v38): the ayah actions panel (AC26 to AC37), the Tafseer panel over the
// reader (AC38 to AC49), the Play surah row and the mini-player as the only player (AC51 to AC55,
// D-203 A), and the kit v38 fixes: QA v37 FIND-BM (tab bar at 200% zoom, AC7, AC91), FIND-BN (Back
// after a text-size change, AC73), FIND-BO (Saved screen layout shift, P-17), FIND-BP (the Read tab
// on a click with no pointer event, AC3), the home cards after the back-forward cache, and the
// Settings reciter row in both languages. Arabic and English, made-up data (the local mock), every
// test in a disposable profile; each removal goes through the product and is logged (D-051). No
// Arabic characters and no Quran text in this file: expected text comes from the source file and
// strings.ts. RIFQ_SHOTS (private folder, optional): R9-SHOTS writes screenshots there.
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, surahs, src, MOBILE, NET4G, hydrated, noOverflow, topAyah, utf8, sliceOf, openAyah, ayahAction, bookmarked, logRemoval } from './helpers.ts';
import { juzOfAyah } from '../../src/core/recent.ts';
import { juzStarts } from '../../src/core/source-adapter.ts';
import { t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { AR_WORD, MOCK_RECITER_NAMES } from '../mock/qf-mock.ts';

type L = Lang;
const LANGS: L[] = ['ar', 'en'];
const home = (l: L) => (l === 'ar' ? '/' : '/en/');
const P = (l: L, p: string) => home(l) + p;
const nameOf = (l: L, s: number) => (l === 'ar' ? surahs[s - 1].ar : surahs[s - 1].en);
const juz = juzStarts(src.list);
const n = (s: number) => surahs[s - 1].items.length;
const seed = (ctx: BrowserContext, kv: Record<string, unknown>) => ctx.addInitScript((x) => {
  if (sessionStorage.getItem('r9seeded')) return;
  for (const [k, v] of Object.entries(x)) localStorage.setItem(k, JSON.stringify(v));
  sessionStorage.setItem('r9seeded', '1');
}, kv);
const panel = (page: Page) => page.locator('dialog[data-ayah-panel]');
const tfPanel = (page: Page) => page.locator('dialog[data-tf-panel]');
const isOpen = (page: Page, sel: string) => page.locator(sel).evaluate((d) => (d as HTMLDialogElement).open);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? 'null'));
const bottomBar = (page: Page) => page.locator('nav[data-tabbar="bottom"]');
async function tfReady(page: Page) {
  await expect(tfPanel(page).locator('[data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
}

for (const lang of LANGS) {
  test(`R9-01 (AC26, AC33, AC34, AC35, AC36): the actions panel opens from the button (click, Enter, Space) and from the ayah; modal, named, focus kept inside and returned; no scroll, no position change, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/#a30'));
    await hydrated(page);
    // Let the D-062 rule save the place first, then compare it after the panel.
    await expect.poll(async () => (await stored(page))?.l?.[0], { timeout: 10_000 }).toBe(2);
    const before = (await stored(page)).l;
    const act = page.locator('button.ayah-act[data-act="31"]');
    await expect(act).toHaveAttribute('aria-label', t(lang, 'ayahActions', { a: 31 }));
    const ab = (await act.boundingBox())!;
    expect(ab.width).toBeGreaterThanOrEqual(44);
    expect(ab.height).toBeGreaterThanOrEqual(44);
    const y0 = await page.evaluate(() => scrollY);
    for (const how of ['click', 'Enter', 'Space', 'ayah'] as const) {
      if (how === 'click') await act.click();
      else if (how === 'ayah') await page.locator('p.ayah[data-r="2:31"]').click();
      else { await act.focus(); await page.keyboard.press(how); }
      await expect.poll(() => isOpen(page, 'dialog[data-ayah-panel]'), how).toBe(true);
      const d = panel(page);
      await expect(d).toHaveAttribute('aria-modal', 'true');
      await expect(d).toHaveAttribute('aria-label', t(lang, 'ayahActions', { a: 31 }));
      await expect(d.locator('[data-act-title]')).toBeFocused();
      expect(await page.evaluate(() => scrollY), `${how}: the reader does not move`).toBe(y0);
      // The page behind is inert (native modal): its controls cannot take focus.
      expect(await page.evaluate(() => { const a = document.querySelector<HTMLElement>('nav[data-tabbar="bottom"] a')!; a.focus(); return document.activeElement === a; })).toBe(false);
      await d.locator('[data-act-title]').focus();
      // Tab and Shift+Tab stay inside.
      for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); expect(await d.evaluate((x) => x.contains(document.activeElement))).toBe(true); }
      for (let i = 0; i < 9; i++) { await page.keyboard.press('Shift+Tab'); expect(await d.evaluate((x) => x.contains(document.activeElement))).toBe(true); }
      // Close: Esc, the Close button, then a tap on the dimmed area (each in turn).
      if (how === 'click') await page.keyboard.press('Escape');
      else if (how === 'Enter') { const c = d.locator('[data-act-close]'); const bb = (await c.boundingBox())!; expect(bb.width).toBeGreaterThanOrEqual(44); expect(bb.height).toBeGreaterThanOrEqual(44); await c.click(); }
      else await page.mouse.click(195, 60);
      await expect.poll(() => isOpen(page, 'dialog[data-ayah-panel]')).toBe(false);
      await expect(act).toBeFocused();
      expect(await page.evaluate(() => scrollY), `${how}: closing does not move the reader`).toBe(y0);
    }
    // AC35: the panel did not change the last reading position.
    expect((await stored(page)).l).toEqual(before);
    // A text selection on the ayah does not open the panel (AC26).
    await page.evaluate(() => { const p = document.querySelector('p.ayah[data-r="2:32"]')!; const r = document.createRange(); r.selectNodeContents(p); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
    await page.locator('p.ayah[data-r="2:32"]').dispatchEvent('click');
    expect(await isOpen(page, 'dialog[data-ayah-panel]')).toBe(false);
    // A long press does not open it either.
    const box = (await page.locator('p.ayah[data-r="2:33"]').boundingBox())!;
    await page.evaluate(() => getSelection()!.removeAllRanges());
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    expect(await isOpen(page, 'dialog[data-ayah-panel]')).toBe(false);
  });

  test(`R9-02 (AC27, AC36, D-192 A, AC31, AC30): heading, S:A and juz line (no page number), the five actions in order; bookmark add and remove with messages, mark and state, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await openAyah(page, 255);
    const d = panel(page);
    await expect(d.locator('[data-act-title]')).toHaveText(t(lang, 'ayahActionsTitle', { name: nameOf(lang, 2), a: 255 }));
    await expect(d.locator('[data-act-sub]')).toHaveText(t(lang, 'ayahActionsSub', { s: 2, a: 255, j: juzOfAyah(juz, 2, 255) }));
    // S:A is isolated left to right (AC36).
    await expect(d.locator('[data-act-ref]')).toHaveAttribute('dir', 'ltr');
    await expect(d.locator('[data-act-ref]')).toHaveText('2:255');
    const names = await d.locator('[data-act-list] button').evaluateAll((bs) => bs.map((b) => [...b.attributes].map((a) => a.name).find((x) => x.startsWith('data-act-'))));
    expect(names).toEqual(['data-act-play-from', 'data-act-tafseer', 'data-act-play-ayah', 'data-act-bookmark', 'data-act-copy']);
    await expect(d.locator('[data-act-list] button')).toHaveText([t(lang, 'playFromHere'), t(lang, 'tafseerTitle'), t(lang, 'audioPlayAyah', { a: 255 }), t(lang, 'addBookmark'), t(lang, 'copyRef', { s: 2, a: 255 })]);
    await expect(d.locator('[data-act-note]')).toHaveText(t(lang, 'bookmarkDeviceOnly'));
    // Bookmark: added on the device, announced, the panel stays open; the reader marks the ayah.
    const bm = d.locator('[data-act-bookmark]');
    await expect(bm).toHaveAttribute('aria-pressed', 'false');
    await bm.click();
    await expect(d.locator('[data-act-status]')).toHaveText(t(lang, 'saved'));
    await expect(d.locator('[data-act-status]')).toHaveAttribute('aria-live', 'polite');
    await expect(bm).toHaveAttribute('aria-pressed', 'true');
    await expect(bm).toHaveText(t(lang, 'removeBookmarkShort'));
    expect(await isOpen(page, 'dialog[data-ayah-panel]')).toBe(true);
    expect((await stored(page)).b).toEqual([[2, 255]]);
    await d.locator('[data-act-close]').click();
    expect(await bookmarked(page, 255)).toBe(true);
    // AC31: a mark that is not colour alone (an icon), with the hidden text "Bookmarked", outside the Quran text.
    const mark = page.locator('li#a255 [data-bm-mark]');
    await expect(mark.locator('svg')).toBeVisible();
    await expect(mark.locator('.sr-only')).toHaveText(t(lang, 'bookmarkedMark'));
    expect(await page.locator('li#a255 p.ayah [data-bm-mark]').count()).toBe(0);
    expect(utf8(await page.locator('p.ayah[data-r="2:255"]').textContent() ?? '').equals(sliceOf(2, 255))).toBe(true);
    // Remove.
    await openAyah(page, 255);
    await bm.click();
    logRemoval('R9-02', `removed bookmark 2:255 in the ayah actions panel, ${lang}, disposable profile`);
    await expect(d.locator('[data-act-status]')).toHaveText(t(lang, 'removed'));
    await expect(bm).toHaveAttribute('aria-pressed', 'false');
    await d.locator('[data-act-close]').click();
    expect(await bookmarked(page, 255)).toBe(false);
  });

  test(`R9-03 (AC32, D-189 A): Copy reference writes S:A only, announces it; a refused clipboard shows the reference as text; nothing is read, ${lang}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      const w = window as unknown as { __reads: number };
      w.__reads = 0;
      const c = navigator.clipboard;
      for (const k of ['read', 'readText'] as const) { const f = c[k].bind(c); (c as unknown as Record<string, unknown>)[k] = (...x: unknown[]) => { w.__reads++; return (f as (...y: unknown[]) => unknown)(...x); }; }
    });
    await page.goto(P(lang, '1/'));
    await hydrated(page);
    await ayahAction(page, 5, 'copy', false);
    await expect(panel(page).locator('[data-act-status]')).toHaveText(t(lang, 'copied', { s: 1, a: 5 }));
    expect(await page.evaluate(() => (window as unknown as { __reads: number }).__reads), 'RIFQ never reads the clipboard').toBe(0);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('1:5');
    await panel(page).locator('[data-act-close]').click();
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
    await ayahAction(page, 6, 'copy', false);
    await expect(panel(page).locator('[data-act-status]')).toHaveText(t(lang, 'copyFailed', { s: 1, a: 6 }));
  });
}

test('R9-04 (AC37, AC92, AC91): the actions panel at 390 and 320 px, 5 text sizes, light and dark, Arabic and English: every action shown, 44 px, 8 px apart, contrast, no sideways scroll', async ({ page }) => {
  test.setTimeout(240_000);
  for (const w of [390, 320]) for (const lang of LANGS) for (const dark of [false, true]) for (const size of [1.25, 1.5, 1.75, 2, 2.5]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.addInitScript(([s, d]) => { localStorage.setItem('rifq.settings', JSON.stringify({ size: s, dark: d })); }, [size, dark] as const);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await openAyah(page, 255);
    const r = await panel(page).evaluate((d) => {
      const bs = [...d.querySelectorAll('[data-act-list] button, [data-act-close]')].map((b) => b.getBoundingClientRect());
      const vw = innerWidth, vh = innerHeight;
      let gap = Infinity;
      const list = bs.slice(0, -1);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i], b = list[j]; gap = Math.min(gap, Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom)); }
      const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const contrasts = [...d.querySelectorAll<HTMLElement>('[data-act-list] button, [data-act-title], [data-act-sub], [data-act-note]')].map((e) => { let bg = 'rgb(255,255,255)'; for (let x: HTMLElement | null = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) { bg = c; break; } } return ratio(getComputedStyle(e).color, bg); });
      const borders = [...d.querySelectorAll<HTMLElement>('[data-act-list] button:not(.act-primary):not(.act-soft)')].map((e) => ratio(getComputedStyle(e).borderTopColor, getComputedStyle(d).backgroundColor));
      const inner = d.querySelector('.sheet-in')!;
      return { minH: Math.min(...bs.map((b) => b.height)), minW: Math.min(...bs.map((b) => b.width)), gap, inside: bs.every((b) => b.left >= -0.5 && b.right <= vw + 0.5), fits: d.getBoundingClientRect().bottom <= vh + 0.5, scrolls: inner.scrollHeight <= inner.clientHeight + 1 || getComputedStyle(inner).overflowY === 'auto', text: Math.min(...contrasts), border: Math.min(...borders), sw: document.documentElement.scrollWidth };
    });
    const tag = `${w} ${lang} ${dark ? 'dark' : 'light'} ${size}`;
    expect(r.minH, tag).toBeGreaterThanOrEqual(44);
    expect(r.minW, tag).toBeGreaterThanOrEqual(44);
    expect(r.gap, tag).toBeGreaterThanOrEqual(8);
    expect(r.inside, tag).toBe(true);
    expect(r.fits, tag).toBe(true);
    expect(r.scrolls, tag).toBe(true);
    expect(r.text, tag).toBeGreaterThanOrEqual(4.5);
    expect(r.border, tag).toBeGreaterThanOrEqual(3);
    expect(r.sw, tag).toBeLessThanOrEqual(w + 1);
    await page.keyboard.press('Escape');
  }
});

for (const lang of LANGS) {
  test(`R9-05 (AC38 to AC42, AC46, AC48, P-6, P-7): the Tafseer panel from the actions panel: same Quran text, labelled sections, credit and source details inside, only /api/tafseer, Back closes it and focus returns, ${lang}`, async ({ page, seen }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/#a20'));
    await hydrated(page);
    const before = await page.evaluate(() => history.length);
    seen.length = 0;
    await ayahAction(page, 20, 'tafseer');
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}#a20;tafseer$`));
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    expect(await isOpen(page, 'dialog[data-ayah-panel]')).toBe(false);
    const d = tfPanel(page);
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
    await tfReady(page);
    await expect(d).toHaveAttribute('aria-modal', 'true');
    await expect(d).toHaveAccessibleName(t(lang, 'tafseerPanelTitle', { name: nameOf(lang, 2), a: 20 }));
    await expect(d.locator('[data-tfp-title]')).toBeFocused();
    await expect(d.getByRole('region', { name: t(lang, 'quranSection') })).toBeVisible();
    await expect(d.getByRole('region', { name: t(lang, 'tafseerSection') })).toBeVisible();
    // AC40: the D-011 text, byte for byte, the same as the reader's.
    expect(utf8(await d.locator('[data-tfp-ayah]').textContent() ?? '').equals(sliceOf(2, 20))).toBe(true);
    await expect(d.locator('[data-tfp-ayah]')).toHaveAttribute('dir', 'rtl');
    await expect(d.locator('[data-tf-ref]')).toHaveText(`${nameOf(lang, 2)}${t(lang, 'resultRef', { s: 2, a: 20 })}`);
    await expect(d.locator('[data-tf-text]')).toContainText(lang === 'en' ? 'MOCK EN PASSAGE 2:20' : 'MOCK PASSAGE 2:20');
    // AC41: the credit is in the panel; source details open inside it.
    await expect(d.locator('[data-tf-credit]')).toBeVisible();
    await d.locator('[data-tf-source] summary').click();
    await expect(d.locator('[data-tf-src-provider]')).toBeVisible();
    expect(await isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
    // AC42: only RIFQ's /api/tafseer, by POST, with the same data as the page (s, a, and l in English).
    const api = seen.filter((s) => new URL(s.url).pathname.startsWith('/api/'));
    expect(api.map((s) => [new URL(s.url).pathname, s.method])).toEqual([['/api/tafseer', 'POST']]);
    expect(JSON.parse(api[0].body ?? '{}')).toEqual(lang === 'en' ? { s: 2, a: 20, l: 'en' } : { s: 2, a: 20 });
    for (const s of seen) expect(new URL(s.url).hostname).toBe('127.0.0.1');
    // AC43: next moves the panel and the reader behind it; the address follows (replaced, P-6).
    await d.locator('[data-tf-next]').click();
    await tfReady(page);
    await expect(d.locator('.tf-view')).toHaveAttribute('data-tf-ayah', '2:21');
    expect(utf8(await d.locator('[data-tfp-ayah]').textContent() ?? '').equals(sliceOf(2, 21))).toBe(true);
    await expect(page).toHaveURL(/#a21;tafseer$/);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await expect(page.locator('li#a21')).toBeInViewport();
    // Back closes the panel (P-6): focus returns to the actions button of the ayah last shown, in view (AC46, P-7).
    await page.goBack();
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(false);
    await expect(page.locator('button.ayah-act[data-act="21"]')).toBeFocused();
    await expect(page.locator('button.ayah-act[data-act="21"]')).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}#a20$`));
    // Forward opens it again; Close goes back to the same place.
    await page.goForward();
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
    await tfReady(page);
    await d.locator('[data-tfp-close]').click();
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(false);
    await expect(page.locator('button.ayah-act[data-act="21"]')).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}#a20$`));
    // AC48: the P-6 address opened directly shows the panel on that ayah; Esc closes it and the
    // reader stays on that ayah (no history entry to go back to: the address loses ";tafseer").
    await page.goto(P(lang, '2/#a7;tafseer'));
    await hydrated(page);
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
    await tfReady(page);
    await expect(d.locator('.tf-view')).toHaveAttribute('data-tf-ayah', '2:7');
    await expect(page.locator('[data-reader-status]')).toHaveText('');
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(false);
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}#a7$`));
    await expect(page.locator('button.ayah-act[data-act="7"]')).toBeFocused();
    await expect(page.locator('li#a7')).toBeInViewport();
    // The Tafseer page address still works (A1, AC48).
    await page.goto(P(lang, 'tafseer/2/#a7'));
    await hydrated(page);
    await expect(page.locator('.tf-row:not([hidden]) p.ayah')).toHaveAttribute('data-r', '2:7');
  });

  test(`R9-06 (AC39, A2): the panel and the page show the same Tafseer view, character for character, ${lang}`, async ({ page }) => {
    // The mock's cases in surah 2: grouped range, none, an error, quotations (own, other, plain).
    const view = async (url: string, sel: string) => {
      await page.goto(url);
      await hydrated(page);
      const root = page.locator(sel);
      await expect(root.locator('[data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
      // React's server render separates adjacent text nodes with empty comments; they are not shown.
      return root.evaluate((r) => ({ view: r.querySelector('.tf-view')!.outerHTML.replace(/<!--.*?-->/g, ''), quran: (r.querySelector('[data-tf-quran]') as HTMLElement).innerText }));
    };
    for (const a of [1, 3, 4, 7, 8, 20, 40, 41, 42, 43, 44]) {
      if (a > n(2)) continue;
      const pg = await view(P(lang, `tafseer/2/#a${a}`), 'main');
      const pn = await view(P(lang, `2/#a${a};tafseer`), 'dialog[data-tf-panel]');
      expect(pn.view, `2:${a}`).toBe(pg.view);
      expect(pn.quran, `2:${a}`).toBe(pg.quran);
    }
  });

  test(`R9-07 (AC43, AC44, P-8, AC75, D-181 C): edges of a surah and the language link in the panel, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, `1/#a${n(1)};tafseer`));
    await hydrated(page);
    const d = tfPanel(page);
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
    await tfReady(page);
    // Next on the last ayah: the next surah's reader, in place, with the panel on its first ayah.
    await page.evaluate(() => { (window as unknown as { __same: number }).__same = 1; });
    await d.locator('[data-tf-next]').click();
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/')}#a1;tafseer$`));
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]').catch(() => false)).toBe(true);
    await tfReady(page);
    await expect(d.locator('.tf-view')).toHaveAttribute('data-tf-ayah', '2:1');
    expect(await page.evaluate(() => (window as unknown as { __same?: number }).__same), 'in place').toBe(1);
    // Previous from 2:1: back to the last ayah of surah 1.
    await d.locator('[data-tf-prev]').click();
    await expect(page).toHaveURL(new RegExp(`${P(lang, '1/')}#a${n(1)};tafseer$`));
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]').catch(() => false)).toBe(true);
    await tfReady(page);
    // No previous on 1:1.
    await page.goto(P(lang, '1/#a1;tafseer'));
    await hydrated(page);
    await tfReady(page);
    await expect(d.locator('[data-tf-prev]')).toHaveCount(0);
    // The language link opens the same ayah's Tafseer in the other interface language.
    const other: L = lang === 'ar' ? 'en' : 'ar';
    const link = d.locator('[data-tfp-lang]');
    await expect(link).toHaveAttribute('href', `${P(other, '1/')}#a1;tafseer`);
    await expect(link).toHaveAttribute('hreflang', other);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${P(other, '1/')}#a1;tafseer$`));
    // The page changes in place; wait for the new page before checking its panel.
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(other);
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]').catch(() => false)).toBe(true);
    await tfReady(page);
    await expect(d.locator('.tf-view')).toHaveAttribute('data-tf-ayah', '1:1');
  });
}

test.describe('with a recitation (made-up silent file answered locally)', () => {
  test.use({ allowHosts: [AUDIO_HOST] });
  for (const lang of LANGS) {
    test(`R9-08 (AC28, AC45, AC51, AC52, AC53, AC54, AC55, D-203 A): play from the panels; the Play surah row and reciter button scroll with the page; the mini-player is the only player; it keeps playing across tabs, ${lang}`, async ({ page }) => {
      const { serveAudio, audioState } = await import('./audio-helpers.ts');
      await serveAudio(page, (s) => n(s) * 5000 + 2000);
      await page.setViewportSize(MOBILE);
      await page.goto(P(lang, '2/'));
      await hydrated(page);
      // AC51: the row below the title, not fixed; Play surah and the reciter button (no name before
      // any request: nothing is asked for before play or the list, RQ-006 AC3).
      const row = page.locator('[data-surah-audio]');
      expect(await row.evaluate((e) => getComputedStyle(e).position)).toBe('static');
      expect(await row.evaluate((e) => e.getBoundingClientRect().top < document.querySelector('ol.ayat')!.getBoundingClientRect().top)).toBe(true);
      await expect(page.locator('[data-play-surah]')).toHaveText(t(lang, 'audioPlaySurah'));
      await expect(page.locator('[data-reciter-btn]')).toHaveText(t(lang, 'audioReciter'));
      // AC55: no full player and none of its parts (D-203 A).
      await expect(page.locator('[data-player], [data-prev-ayah], [data-next-ayah], [data-go-current], [data-audio-help]')).toHaveCount(0);
      // AC28: Play from here starts the surah at that ayah, closes the panel, shows the mini-player.
      await ayahAction(page, 40, 'play-from');
      expect(await isOpen(page, 'dialog[data-ayah-panel]')).toBe(false);
      await expect(page.locator('button.ayah-act[data-act="40"]')).toBeFocused();
      await expect(page.locator('[data-mini-player]')).toBeVisible();
      await expect.poll(async () => { const a = await audioState(page); return !!a && !a.paused && a.ready >= 3; }).toBe(true);
      await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'surah');
      await expect.poll(() => page.$$eval('li.ap-current', (l) => l.map((x) => (x as HTMLElement).id))).toEqual(['a40']);
      // AC52: the reciter button now shows the name as Quran Foundation gives it, and opens the
      // list, the source details and the credit.
      await expect(page.locator('[data-reciter-btn]')).toHaveText(t(lang, 'reciterChip', { name: lang === 'ar' ? AR_WORD(7) : MOCK_RECITER_NAMES[7] }));
      // AC55: only two things are fixed on screen: the mini-player directly above the tab bar.
      const fixed = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > 0 && !(e instanceof HTMLDialogElement)).map((e) => (e as HTMLElement).dataset.miniPlayer !== undefined ? 'mini' : (e as HTMLElement).dataset.tabbar ?? e.tagName));
      expect(fixed.sort()).toEqual(['bottom', 'mini']);
      const mini = (await page.locator('[data-mini-player]').boundingBox())!, bar = (await bottomBar(page).boundingBox())!;
      expect(Math.abs(mini.y + mini.height - bar.y)).toBeLessThanOrEqual(1);
      // AC53, AC54: the playing ayah is marked and kept between the header and the mini-player.
      await page.evaluate(() => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = 59 * 5 + 1; });
      await expect.poll(() => page.$$eval('li.ap-current', (l) => l.map((x) => (x as HTMLElement).id))).toEqual(['a60']);
      await expect.poll(() => page.evaluate(() => { const r = document.getElementById('a60')!.getBoundingClientRect(); const top = document.querySelector('.site-header')!.getBoundingClientRect().bottom; const bot = document.querySelector('[data-mini-player]')!.getBoundingClientRect().top; return r.top >= top - 1 && r.bottom <= bot + 1; })).toBe(true);
      // AC45: the Tafseer panel's play button plays that ayah alone and becomes pause; the panel stays.
      await ayahAction(page, 61, 'tafseer');
      const d = tfPanel(page);
      await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
      const pb = d.locator('[data-tfp-play]');
      await pb.click();
      await expect(page.locator('[data-audio-player]')).toHaveAttribute('data-mode', 'ayah');
      await expect(pb).toHaveAttribute('aria-label', t(lang, 'audioPauseAyah', { a: 61 }));
      expect(await isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
      await pb.click();
      await expect.poll(async () => (await audioState(page))!.paused).toBe(true);
      await expect(pb).toHaveAttribute('aria-label', t(lang, 'audioPlayAyah', { a: 61 }));
      await page.keyboard.press('Escape');
      await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(false);
      // Across tabs (AC5): play the surah from 3 and move through the tab bar; it keeps playing.
      await ayahAction(page, 3, 'play-from');
      await expect.poll(async () => !(await audioState(page))!.paused).toBe(true);
      await page.evaluate(() => { (window as unknown as { __same: number }).__same = 1; });
      for (const id of ['home', 'saved', 'settings', 'read']) {
        await bottomBar(page).locator(`a[data-tab="${id}"]`).click();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => (window as unknown as { __same?: number }).__same)).toBe(1);
        expect(await page.evaluate(() => !(document.querySelector('audio[data-audio]') as HTMLAudioElement).paused)).toBe(true);
        await expect(page.locator('[data-mini-player]')).toBeVisible();
      }
      await noOverflow(page);
    });
  }

  test('R9-09 (Hamzeh, kit v37 test; AC70): the Settings reciter row shows the reciter name in Arabic and in English', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    for (const lang of LANGS) {
      await page.goto(P(lang, 'settings/'));
      await hydrated(page);
      await expect(page.locator('[data-set-reciter-name]')).toHaveText(lang === 'ar' ? AR_WORD(7) : MOCK_RECITER_NAMES[7]);
      await expect(page.locator('[data-set-reciter-now]')).toHaveText(t(lang, 'reciterChip', { name: lang === 'ar' ? AR_WORD(7) : MOCK_RECITER_NAMES[7] }));
    }
    // And after moving between them in place (the list of the new language is asked for).
    await page.locator('[data-set-lang-link="ar"]').click();
    await expect(page).toHaveURL(/\/settings\/$/);
    await hydrated(page);
    await expect(page.locator('[data-set-reciter-name]')).toHaveText(AR_WORD(7));
  });
});

for (const lang of LANGS) {
  test(`R9-10 (QA v37 FIND-BM, AC7, AC91): the tab bar at 200% text zoom and 200% page zoom: no overlap, nothing off-screen, no label broken inside a word, ${lang}`, async ({ browser }) => {
    for (const [kind, w, scale] of [['text', 390, 1], ['text', 320, 1], ['page', 195, 2], ['page', 160, 2], ['normal', 390, 1], ['normal', 320, 1]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: kind === 'page' ? 422 : 844 }, deviceScaleFactor: scale, baseURL: 'http://127.0.0.1:8812' });
      const page = await ctx.newPage();
      await page.goto(P(lang, 'saved/'));
      await hydrated(page);
      if (kind === 'text') await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const bar = document.querySelector('nav[data-tabbar="bottom"]')!;
        const items = [...bar.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
        let overlap = false;
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const A = items[i], B = items[j]; if (A.left < B.right - 0.5 && B.left < A.right - 0.5 && A.top < B.bottom - 0.5 && B.top < A.bottom - 0.5) overlap = true; }
        const lines = [...bar.querySelectorAll('.tab-label')].map((l) => { const rg = document.createRange(); rg.selectNodeContents(l); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; });
        return { overlap, off: items.some((x) => x.left < -0.5 || x.right > innerWidth + 0.5 || x.bottom > innerHeight + 0.5), lines: Math.max(...lines), minH: Math.min(...items.map((x) => x.height)), minW: Math.min(...items.map((x) => x.width)), rows: new Set(items.map((x) => Math.round(x.top))).size, sw: document.documentElement.scrollWidth };
      });
      const tag = `${kind} ${w}`;
      expect(r.overlap, tag).toBe(false);
      expect(r.off, tag).toBe(false);
      expect(r.lines, `${tag}: one line per label`).toBe(1);
      expect(r.minH, tag).toBeGreaterThanOrEqual(44);
      expect(r.minW, tag).toBeGreaterThanOrEqual(44);
      expect(r.sw, tag).toBeLessThanOrEqual(w + 1);
      if (kind === 'normal') expect(r.rows, `${tag}: one row at normal size`).toBe(1);
      // The footer and privacy link can still be read above the bar (AC6).
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => document.querySelector('[data-privacy-link]')!.getBoundingClientRect().bottom <= document.querySelector('nav[data-tabbar="bottom"]')!.getBoundingClientRect().top + 1), tag).toBe(true);
      await ctx.close();
    }
  });

  test(`R9-11 (QA v37 FIND-BN, AC73): Back to the reader after a text-size change in Settings returns to the same ayah, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/#a150'));
    await hydrated(page);
    await expect.poll(async () => (await stored(page))?.l?.[1], { timeout: 10_000 }).toBeGreaterThan(0);
    const before = await topAyah(page);
    await bottomBar(page).locator('a[data-tab="settings"]').click();
    await expect(page).toHaveURL(/settings\/$/);
    await hydrated(page);
    await page.locator('[data-set-larger]').click();
    await page.locator('[data-set-larger]').click();
    await page.goBack();
    await expect(page).toHaveURL(/\/2\/#a150$/);
    await expect.poll(() => topAyah(page)).toBe(before);
    // Also after a smaller size and two steps back.
    await bottomBar(page).locator('a[data-tab="settings"]').click();
    await hydrated(page);
    for (let i = 0; i < 3; i++) await page.locator('[data-set-smaller]').click();
    await bottomBar(page).locator('a[data-tab="saved"]').click();
    await expect(page).toHaveURL(/saved\/$/);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/2\/#a150$/);
    await expect.poll(() => topAyah(page)).toBe(before);
  });

  test(`R9-12 (QA v37 FIND-BP, AC3): the Read tab goes to the last reading position on a click with no pointer or key event, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '18/#a10'));
    await hydrated(page);
    await expect.poll(async () => (await stored(page))?.l?.[0], { timeout: 10_000 }).toBe(18);
    const last = (await stored(page)).l as [number, number];
    // Element.click() only, as some assistive technology and switch access send.
    await page.evaluate(() => (document.querySelector('nav[data-tabbar="bottom"] a[data-tab="read"]') as HTMLElement).click());
    await expect(page).toHaveURL(new RegExp(`${P(lang, '18/')}#a${last[1]}$`));
  });

  test(`R9-13 (kit v38): home cards, mySaved and recently read read the device again on pageshow from the back-forward cache and when the tab is shown, ${lang}`, async ({ page, context }) => {
    await seed(context, { 'rifq.saves': { v: 1, b: [[2, 3]], l: [48, 11] }, 'rifq.recent': { v: 1, s: [48] } });
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('[data-continue]')).toHaveAttribute('href', `${P(lang, '48/')}#a11`);
    // Another page of this tab saved a newer place meanwhile (as Hamzeh saw: 48:24 on Saved, 48:11
    // on home); storage events do not fire in the same tab.
    const write = () => page.evaluate(() => { localStorage.setItem('rifq.saves', JSON.stringify({ v: 1, b: [[2, 3], [48, 24]], l: [48, 24] })); localStorage.setItem('rifq.recent', JSON.stringify({ v: 1, s: [36, 48] })); });
    await write();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.locator('[data-continue]')).toHaveAttribute('href', `${P(lang, '48/')}#a24`);
    await expect(page.locator('[data-bm-card]')).toHaveCount(2);
    await expect(page.locator('[data-recent-chip]').first()).toHaveAttribute('data-recent-chip', '36');
    // The tab shown again.
    await page.evaluate(() => { localStorage.setItem('rifq.saves', JSON.stringify({ v: 1, b: [[2, 3]], l: [48, 29] })); });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('[data-continue]')).toHaveAttribute('href', `${P(lang, '48/')}#a29`);
    // The Saved screen and the Read tab do the same.
    await page.goto(P(lang, 'saved/'));
    await hydrated(page);
    await page.evaluate(() => { localStorage.setItem('rifq.saves', JSON.stringify({ v: 1, b: [[2, 3], [9, 9]], l: [48, 29] })); });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.locator('[data-bm="9:9"]')).toBeVisible();
    await expect(bottomBar(page).locator('a[data-tab="read"]')).toHaveAttribute('href', `${P(lang, '48/')}#a29`);
  });

  test(`R9-14 (P-17, D-202 A, AC93, QA v37 FIND-BO): layout shift of home, reader and Saved loads is 0.1 or less, at 1x and 4x CPU, with device data, ${lang}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const out: Record<string, number> = {};
    for (const cpu of [1, 4]) for (const data of [false, true]) for (const path of ['', '2/', 'saved/']) {
      const ctx = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
      if (data) await seed(ctx, { 'rifq.saves': { v: 1, b: Array.from({ length: 12 }, (_, i) => [2, i + 1]), l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2, 1] } });
      const page = await ctx.newPage();
      await page.addInitScript(() => { const w = window as unknown as { __cls: number }; w.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
      if (cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
      await page.goto(P(lang, path));
      await hydrated(page);
      await page.waitForTimeout(1200);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      out[`${path || 'home'} ${cpu}x ${data ? 'data' : 'empty'}`] = Math.round(cls * 1000) / 1000;
      expect(cls, `${path || 'home'} ${cpu}x ${data}`).toBeLessThanOrEqual(0.1);
      await ctx.close();
    }
    test.info().annotations.push({ type: 'cls', description: JSON.stringify(out) });
  });
}

for (const lang of LANGS) {
  test(`R9-16 (AC49, Chromium stand-in): the Tafseer panel's passage is readable within 3 s of the tap on the placeholder 4G profile with 4x CPU slowdown, ${lang}`, async ({ page, context }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    const c = await context.newCDPSession(page);
    await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions', NET4G);
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await openAyah(page, 20);
    const t0 = Date.now();
    await panel(page).locator('[data-act-tafseer]').click();
    await expect(tfPanel(page).locator('[data-tf-text]')).toBeVisible({ timeout: 10_000 });
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: 'tafseer-panel-ms', description: String(ms) });
    expect(ms).toBeLessThan(3000);
  });
}

test('R9-15 (AC48 RQ-006, AC97): without JavaScript no actions button or panel shows; development pages have neither', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
  const page = await ctx.newPage();
  await page.goto('/2/');
  await expect(page.locator('button.ayah-act').first()).toBeHidden();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('p.ayah[data-r]')).toHaveCount(n(2));
  await ctx.close();
});

test('R9-SHOTS: screenshots of each new screen (private folder, optional)', async ({ browser }) => {
  const dir = process.env.RIFQ_SHOTS;
  test.skip(!dir, 'RIFQ_SHOTS not set');
  test.setTimeout(300_000);
  mkdirSync(dir!, { recursive: true });
  const { serveAudio } = await import('./audio-helpers.ts');
  for (const width of [390, 320]) for (const lang of LANGS) for (const dark of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, baseURL: 'http://127.0.0.1:8812' });
    await seed(ctx, { 'rifq.saves': { v: 1, b: [[2, 3], [2, 255]], l: [2, 1] }, 'rifq.settings': { size: 1.5, dark } });
    const page = await ctx.newPage();
    await serveAudio(page, (s) => n(s) * 5000 + 2000);
    const tag = `${lang}-${dark ? 'dark' : 'light'}-${width}`;
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/reader-row-${tag}.png` });
    await openAyah(page, 5);
    await page.screenshot({ path: `${dir}/ayah-panel-${tag}.png` });
    await panel(page).locator('[data-act-tafseer]').click();
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(true);
    await tfReady(page);
    await page.screenshot({ path: `${dir}/tafseer-panel-${tag}.png` });
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page, 'dialog[data-tf-panel]')).toBe(false);
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('[data-reciter-btn]').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/reciter-open-${tag}.png` });
    await page.locator('[data-reciter-btn]').click();
    await ayahAction(page, 8, 'play-from');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${dir}/mini-player-${tag}.png` });
    await page.goto(P(lang, 'settings/'));
    await hydrated(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/settings-reciter-${tag}.png`, fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/tabbar-200-${tag}.png` });
    await ctx.close();
  }
});
