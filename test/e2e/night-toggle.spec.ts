// Night toggle icon button (Hamzeh's 12 Nov report: the old text button looked the same in both
// modes). The button names the action it will take; its label, title and icon change with the
// state, the state persists after a reload, and without JavaScript no dead control is shown.
import { test, expect, MOBILE, DESKTOP, hydrated, noOverflow } from './helpers.ts';
import { t } from '../../src/core/strings.ts';

const shown = (page: import('@playwright/test').Page) => page.$$eval('[data-night] svg[data-icon]', (ss) => ss.filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.getAttribute('data-icon')));

for (const lang of ['ar', 'en'] as const) for (const vp of [MOBILE, DESKTOP]) {
  test(`NT-01: label, title and icon change on each click and after reload, ${lang} ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    const pre = lang === 'ar' ? '/' : '/en/';
    await page.goto(`${pre}2/`);
    await hydrated(page);
    const b = page.locator('[data-night]');
    await expect(b).toBeVisible();
    const check = async (dark: boolean) => {
      const label = t(lang, dark ? 'toLight' : 'toDark');
      await expect(b).toHaveAttribute('aria-label', label);
      await expect(b).toHaveAttribute('title', label);
      await expect(b).toHaveAttribute('data-mode', dark ? 'dark' : 'light');
      expect(await b.getAttribute('aria-pressed')).toBeNull();
      expect(await shown(page)).toEqual([dark ? 'sun' : 'moon']);
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/); else await expect(page.locator('html')).not.toHaveClass(/dark/);
    };
    await check(false);
    await b.click();
    await check(true);
    await page.reload();
    await hydrated(page);
    await check(true);
    await page.goto(pre);
    await hydrated(page);
    await check(true);
    await page.locator('[data-night]').click();
    await check(false);
    await page.reload();
    await hydrated(page);
    await check(false);
    await noOverflow(page);
  });
}

test('NT-02: icon-only button: 44 px target, SVG hidden from screen readers, visible focus, contrast in both modes', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/2/');
  await hydrated(page);
  const b = page.locator('[data-night]');
  const box = (await b.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect((await b.innerText()).trim()).toBe('');
  for (const s of await b.locator('svg').all()) {
    await expect(s).toHaveAttribute('aria-hidden', 'true');
    expect(await s.evaluate((e) => [...e.querySelectorAll('[stroke]')].every((x) => x.getAttribute('stroke') === 'currentColor'))).toBe(true);
  }
  // Always in the header, also at phone width, without the Display panel opened.
  await expect(page.locator('[data-display-panel] [data-night]')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('.site-header')!.getBoundingClientRect().height)).toBeLessThanOrEqual(64);
  const out: Record<string, number> = {};
  for (const mode of ['light', 'dark']) {
    if (mode === 'dark') await b.click();
    await b.focus();
    const r = await b.evaluate((el) => {
      const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = (a: string, c: string) => { const [x, y] = [lum(a), lum(c)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bgOf = (e: Element | null): string => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
      const cs = getComputedStyle(el), bg = bgOf(el);
      return { icon: ratio(cs.color, bg), border: ratio(cs.borderTopColor, bgOf(el.parentElement)), focus: ratio(cs.outlineColor, bgOf(el.parentElement)), outline: cs.outlineStyle };
    });
    expect(r.outline).not.toBe('none');
    expect(r.icon, `${mode} icon`).toBeGreaterThanOrEqual(3);
    expect(r.border, `${mode} border`).toBeGreaterThanOrEqual(3);
    expect(r.focus, `${mode} focus`).toBeGreaterThanOrEqual(3);
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') out[`${mode}.${k}`] = Math.round(v * 100) / 100;
  }
  test.info().annotations.push({ type: 'contrast', description: JSON.stringify(out) });
});

test('NT-03: without JavaScript the page renders and shows no dead night button', async ({ browser }) => {
  for (const path of ['/', '/en/2/']) {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE });
    const page = await ctx.newPage();
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('[data-night]')).toBeHidden();
    await noOverflow(page);
    await ctx.close();
  }
});

test('NT-04: with a dark setting saved, the sun icon shows before and after the island loads', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('rifq.settings', '{"dark":true}'); } catch { /* none */ } });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await shown(page)).toEqual(['sun']);
  await hydrated(page);
  await expect(page.locator('[data-night]')).toHaveAttribute('aria-label', t('ar', 'toLight'));
  expect(await shown(page)).toEqual(['sun']);
});
