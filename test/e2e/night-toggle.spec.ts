// Night mode control. Kit v37 (RQ-008 AC71, AC72; Hamzeh, 21 Nov): the header night button was
// removed; the light/dark switch is on the Settings screen. It is one control with the visible
// label night, role="switch" and aria-checked; the state persists after a reload and applies on
// every page before paint; no page header has a night or theme button; without JavaScript the
// switch is disabled (no control that does nothing).
import { test, expect, MOBILE, DESKTOP, hydrated, noOverflow } from './helpers.ts';
import { t } from '../../src/core/strings.ts';

const settings = (lang: 'ar' | 'en') => (lang === 'ar' ? '/settings/' : '/en/settings/');

for (const lang of ['ar', 'en'] as const) for (const vp of [MOBILE, DESKTOP]) {
  test(`NT-01: the switch state changes on each click and after reload, and applies on other pages, ${lang} ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    const pre = lang === 'ar' ? '/' : '/en/';
    await page.goto(settings(lang));
    await hydrated(page);
    const b = page.locator('[data-night-switch]');
    await expect(b).toBeVisible();
    await expect(b).toHaveAccessibleName(t(lang, 'night'));
    const check = async (dark: boolean) => {
      await expect(b).toHaveAttribute('aria-checked', String(dark));
      if (dark) await expect(page.locator('html')).toHaveClass(/dark/); else await expect(page.locator('html')).not.toHaveClass(/dark/);
    };
    await check(false);
    await b.click();
    await check(true);
    await page.reload();
    await hydrated(page);
    await check(true);
    await page.goto(`${pre}2/`);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.goto(settings(lang));
    await hydrated(page);
    await b.click();
    await check(false);
    await page.reload();
    await hydrated(page);
    await check(false);
    await noOverflow(page);
  });
}

test('NT-02: the switch: 44 px target, visible focus, track border and focus ring 3:1 in both modes; no header night button', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  for (const p of ['/', '/2/', '/surahs/', '/settings/', '/en/2/']) {
    await page.goto(p);
    await expect(page.locator('.site-header [data-night], .site-header .night-btn')).toHaveCount(0);
  }
  await page.goto('/settings/');
  await hydrated(page);
  const b = page.locator('[data-night-switch]');
  const box = (await b.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(await b.locator('.switch-track').getAttribute('aria-hidden')).toBe('true');
  const out: Record<string, number> = {};
  for (const mode of ['light', 'dark']) {
    if (mode === 'dark') await b.click();
    await b.focus();
    const r = await b.evaluate((el) => {
      const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = (a: string, c: string) => { const [x, y] = [lum(a), lum(c)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bgOf = (e: Element | null): string => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
      const cs = getComputedStyle(el), track = el.querySelector('.switch-track')!, bg = bgOf(el);
      return { label: ratio(cs.color, bg), track: ratio(getComputedStyle(track).borderTopColor, bg), focus: ratio(cs.outlineColor, bg), outline: cs.outlineStyle };
    });
    expect(r.outline).not.toBe('none');
    expect(r.label, `${mode} label`).toBeGreaterThanOrEqual(4.5);
    expect(r.track, `${mode} track border`).toBeGreaterThanOrEqual(3);
    expect(r.focus, `${mode} focus`).toBeGreaterThanOrEqual(3);
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') out[`${mode}.${k}`] = Math.round(v * 100) / 100;
  }
  test.info().annotations.push({ type: 'contrast', description: JSON.stringify(out) });
});

test('NT-03: without JavaScript the pages render and the switch is disabled (no dead control)', async ({ browser }) => {
  for (const path of ['/', '/en/2/', '/settings/']) {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE });
    const page = await ctx.newPage();
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.site-header [data-night]')).toHaveCount(0);
    if (path === '/settings/') await expect(page.locator('[data-night-switch]')).toBeDisabled();
    await noOverflow(page);
    await ctx.close();
  }
});

test('NT-04: with a dark setting saved, the page is dark before paint and the switch shows on, before and after the island loads', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('rifq.settings', '{"dark":true}'); } catch { /* none */ } });
  await page.goto('/settings/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  const knob = () => page.locator('.switch-thumb').evaluate((e) => { const r = e.getBoundingClientRect(), t = e.parentElement!.getBoundingClientRect(); return (r.left + r.right) / 2 < (t.left + t.right) / 2 ? 'left' : 'right'; });
  // Arabic (RTL): "on" puts the knob at the inline end, the left.
  expect(await knob()).toBe('left');
  await hydrated(page);
  await expect(page.locator('[data-night-switch]')).toHaveAttribute('aria-checked', 'true');
  expect(await knob()).toBe('left');
});
