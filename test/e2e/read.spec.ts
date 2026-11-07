// RQ-001 browser tests against the local build. Test IDs from qa-test-plans.md.
import { test, expect, src, surahs, N, MOBILE, DESKTOP, hydrated, noOverflow, topAyah, pageAyat, sha, NET4G } from './helpers.ts';
import { t, ACCOUNT_WORDS } from '../../src/core/strings.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD } from './helpers.ts';

const record = JSON.parse(readFileSync(join(BUILD, 'worker-config.json'), 'utf8')).record;

test('TP1-01: first visit, Arabic default, RTL, no sign-in wall or pop-up', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.locator('dialog[open], [role=dialog], input[type=password]').count()).toBe(0);
  expect(ACCOUNT_WORDS.test(await page.locator('body').innerText())).toBe(false);
  await expect(page.locator('[data-dev-banner]')).toHaveText(t('ar', 'devBanner'));
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP1-02: home at mobile width, ${lang}: no pop-up, no layout break, correct direction`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    expect(await page.locator('dialog[open], [role=dialog]').count()).toBe(0);
    await noOverflow(page);
  });
}

test('TP1-04: every surah opens from the home page in one click, desktop, Arabic', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const s of surahs) {
    await page.goto('/');
    await page.click(`a[data-surah-link="${s.n}"]`);
    await expect(page).toHaveURL(new RegExp(`/${s.n}/$`));
    await expect(page.locator('p.ayah[data-r]')).toHaveCount(s.items.length);
  }
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP1-05: every surah opens in one tap at mobile width, ${lang}, with its source name`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const home = lang === 'ar' ? '/' : '/en/';
    for (const s of surahs) {
      await page.goto(home);
      const link = page.locator(`a[data-surah-link="${s.n}"]`);
      await expect(link.locator('span[lang]')).toHaveText(lang === 'ar' ? s.ar : s.en);
      await link.tap();
      await expect(page).toHaveURL(new RegExp(`${home}${s.n}/$`));
      await expect(page.locator('p.ayah[data-r]')).toHaveCount(s.items.length);
    }
    await ctx.close();
  });
}

for (const lang of ['ar', 'en'] as const) {
  test(`TP1-07, TP1-09: forward walk with next surah, ${lang}: order equals the source, nothing skipped or repeated`, async ({ page }) => {
    const want = src.list.map((a) => `${a.sora}:${a.aya_no}`);
    const got: string[] = [];
    await page.goto(lang === 'ar' ? '/1/' : '/en/1/');
    expect(await page.locator('a[data-prev]').count(), 'no previous at the first surah').toBe(0);
    for (let s = 1; s <= N; s++) {
      await expect(page.locator('ol.ayat')).toHaveAttribute('data-surah', String(s));
      await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[s - 1].items.length);
      got.push(...(await pageAyat(page)).map((x) => x.ref));
      const next = page.locator('a[data-next]');
      if (s === N) { expect(await next.count(), 'no next at the last surah').toBe(0); break; }
      await next.click();
      await expect(page).toHaveURL(new RegExp(`/${s + 1}/$`));
    }
    expect(got.length).toBe(want.length);
    expect(got).toEqual(want);
  });
}

test('TP1-08: backward walk with previous surah: exact reverse of the source order', async ({ page }) => {
  const want = src.list.map((a) => `${a.sora}:${a.aya_no}`);
  const got: string[][] = [];
  await page.goto(`/${N}/`);
  for (let s = N; s >= 1; s--) {
    await expect(page.locator('ol.ayat')).toHaveAttribute('data-surah', String(s));
    await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[s - 1].items.length);
    got.push((await pageAyat(page)).map((x) => x.ref));
    if (s === 1) break;
    await page.locator('a[data-prev]').first().click();
    await expect(page).toHaveURL(new RegExp(`/${s - 1}/$`));
  }
  const backward = got.flatMap((g) => [...g].reverse());
  expect(backward).toEqual([...want].reverse());
});

for (const [lang, vp] of [['ar', DESKTOP], ['en', DESKTOP], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP1-17: source details show the record name and edition, ${lang}, ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto(lang === 'ar' ? '/2/' : '/en/2/');
    await page.locator('[data-source-details] summary').click();
    await expect(page.locator('[data-source-name]')).toHaveText(record.name);
    await expect(page.locator('[data-source-edition]')).toHaveText(record.edition);
    await expect(page.locator('[data-source-status]')).toHaveText(record.status);
    await expect(page.locator('[data-source-sha]')).toHaveText(src.sha256!);
    await noOverflow(page);
  });
}

for (const vp of [DESKTOP, MOBILE]) {
  test(`TP1-21: every font size step keeps the same ayah in view, ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/2/#a100');
    await hydrated(page);
    const before = await topAyah(page);
    expect(before).toBe(100);
    const sizes: string[] = [];
    for (const btn of ['[data-larger]', '[data-larger]', '[data-larger]', '[data-smaller]', '[data-smaller]', '[data-smaller]', '[data-smaller]', '[data-larger]']) {
      const b = page.locator(btn);
      if (await b.isDisabled()) continue;
      // dispatchEvent, not click(): Playwright's click() scrolls the page to the sticky header,
      // which a real tap does not do, and that scroll would move the reading place.
      await b.dispatchEvent('click');
      sizes.push(await page.evaluate(() => getComputedStyle(document.querySelector('p.ayah')!).fontSize));
      expect(await topAyah(page)).toBe(before);
    }
    expect(new Set(sizes).size).toBeGreaterThan(2);
  });
}

for (const lang of ['ar', 'en'] as const) {
  test(`TP1-22: night mode on and off keeps the same ayah in view, ${lang}`, async ({ page }) => {
    await page.goto(lang === 'ar' ? '/2/#a150' : '/en/2/#a150');
    await hydrated(page);
    const before = await topAyah(page);
    await page.locator('[data-night]').dispatchEvent('click');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('[data-night]')).toHaveAttribute('aria-pressed', 'true');
    expect(await topAyah(page)).toBe(before);
    await page.locator('[data-night]').dispatchEvent('click');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    expect(await topAyah(page)).toBe(before);
  });
}

test('TP1-23: text, controls and focus meet WCAG 2.2 AA contrast in both themes', async ({ page }) => {
  const results: Record<string, number> = {};
  for (const theme of ['light', 'dark']) {
    await page.goto('/2/');
    await hydrated(page);
    if (theme === 'dark') await page.click('[data-night]');
    await page.fill('#q', src.list[0].aya_text.split(' ')[0]);
    await page.press('#q', 'Enter');
    await page.waitForSelector('[data-results] mark');
    const r = await page.evaluate(() => {
      const lum = (c: string) => {
        const m = c.match(/[\d.]+/g)!.map(Number);
        const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
      };
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bg = (el: Element | null): string => {
        for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c; }
        return getComputedStyle(document.documentElement).backgroundColor;
      };
      const out: Record<string, number> = {};
      const sel: Record<string, string> = {
        ayah: 'p.ayah', body: '.surah-title', link: '.surah-nav a', button: '.btn', banner: '.banner', hint: '.hint', mark: '[data-results] mark', footer: '.site-footer summary', bookmark: 'button.bm',
      };
      for (const [k, s] of Object.entries(sel)) {
        const el = document.querySelector(s);
        if (el) out[k] = ratio(getComputedStyle(el).color, bg(el));
      }
      // Focus indicator: outline colour against the page background (non-text, 3:1).
      const b = document.querySelector<HTMLElement>('.surah-nav a')!;
      b.focus();
      out.focus = ratio(getComputedStyle(b).outlineColor, bg(b.parentElement));
      out.border = ratio(getComputedStyle(document.querySelector('.btn')!).borderTopColor, bg(document.querySelector('.btn')!.parentElement));
      return out;
    });
    for (const [k, v] of Object.entries(r)) {
      results[`${theme}.${k}`] = Math.round(v * 100) / 100;
      expect(v, `${theme} ${k}`).toBeGreaterThanOrEqual(k === 'focus' || k === 'border' ? 3 : 4.5);
    }
  }
  test.info().annotations.push({ type: 'contrast', description: JSON.stringify(results) });
});

for (const vp of [DESKTOP, MOBILE]) {
  test(`TP1-25: switching language flips RTL and LTR without breaking layout, ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/2/');
    await hydrated(page);
    await page.click('#lang-switch');
    await expect(page).toHaveURL(/\/en\/2\//);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await noOverflow(page);
    await hydrated(page);
    await page.click('#lang-switch');
    await expect(page).toHaveURL(/\/2\//);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await noOverflow(page);
  });
}

test('TP1-26: delivered ayah bytes are identical in both languages and stay right-to-left', async ({ page }) => {
  for (const s of [1, 2, N]) {
    const hashes: string[] = [];
    for (const path of [`/${s}/`, `/en/${s}/`]) {
      await page.goto(path);
      const ay = await pageAyat(page);
      ay.forEach((x, i) => expect(x.bytes.equals(src.slices[src.list.findIndex((a) => `${a.sora}:${a.aya_no}` === x.ref)]), `${x.ref}`).toBe(true));
      hashes.push(sha(Buffer.concat(ay.map((x) => x.bytes))));
      const dirs = await page.$$eval('p.ayah[data-r]', (ps) => [...new Set(ps.map((p) => getComputedStyle(p).direction))]);
      expect(dirs).toEqual(['rtl']);
    }
    expect(hashes[0]).toBe(hashes[1]);
  }
});

test('TP1-29: reading, settings and language change send no personal data and no settings', async ({ page, seen }) => {
  await page.goto('/');
  await hydrated(page);
  await page.click('a[data-surah-link="2"]');
  await hydrated(page);
  await page.click('[data-larger]');
  await page.click('[data-night]');
  await page.click('#lang-switch');
  await hydrated(page);
  expect(seen.length).toBeGreaterThan(0);
  for (const s of seen) {
    expect(s.method, s.url).toBe('GET');
    expect(s.body).toBeNull();
    expect(new URL(s.url).search, 'no query string').toMatch(/^(\?astro-retry=\d+)?$/);
    expect(s.headers.cookie).toBeUndefined();
  }
  expect(await page.context().cookies()).toEqual([]);
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP1-32: every control on home and reader has an accessible name in the interface language, ${lang}`, async ({ page }) => {
    for (const path of lang === 'ar' ? ['/', '/2/'] : ['/en/', '/en/2/']) {
      await page.goto(path);
      await hydrated(page);
      const names = await page.$$eval('a[href], button, input:not([type=hidden])', (els) => els.filter((e) => !(e as HTMLElement).hidden || e.matches('button.bm')).map((e) => {
        const el = e as HTMLElement;
        const lab = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null;
        return { id: el.id, cls: el.className, name: (el.getAttribute('aria-label') ?? lab ?? el.textContent ?? '').trim() };
      }));
      for (const n of names) {
        expect(n.name, JSON.stringify({ id: n.id, cls: n.cls })).not.toBe('');
        if (n.id === 'lang-switch') continue; // names the other language on purpose
        const arabic = /[\u0621-\u064a]/.test(n.name);
        if (lang === 'ar') expect(arabic, `ar label: ${n.id} ${n.cls}`).toBe(true);
        else expect(/[A-Za-z]/.test(n.name), `en label: ${n.id} ${n.cls}`).toBe(true);
      }
    }
  });
}

test('TP1-31 (automated part): keyboard focus is visible on every control reached by Tab', async ({ page }) => {
  await page.goto('/2/');
  await hydrated(page);
  let missing = 0, reached = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const o = await page.evaluate(() => { const a = document.activeElement as HTMLElement; if (!a || a === document.body) return null; const s = getComputedStyle(a); return { style: s.outlineStyle, w: parseFloat(s.outlineWidth) }; });
    if (!o) continue;
    reached++;
    if (o.style === 'none' || o.w < 2) missing++;
  }
  expect(reached).toBeGreaterThan(10);
  expect(missing).toBe(0);
});

test('TP1-38 (automated part): reduced motion respected; no media, sound or notification request', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { (window as any).__notif = 0; const N = (window as any).Notification; if (N) N.requestPermission = () => { (window as any).__notif++; return Promise.resolve('denied'); }; });
  for (const p of ['/', '/2/']) {
    await page.goto(p);
    await hydrated(page);
    expect(await page.locator('audio, video, iframe').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__notif)).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).not.toBe('smooth');
  }
  await ctx.close();
});

test('TP1-35 (local part): HSTS and security headers are sent; no unsafe-inline in the policy', async ({ request }) => {
  for (const p of ['/', '/2/', '/en/2/']) {
    const r = await request.get(p);
    const h = r.headers();
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['content-security-policy']).not.toContain('unsafe-inline');
    expect(h['x-content-type-options']).toBe('nosniff');
  }
});

test('RQ-001 AC4 dry run in the browser: every ayah of the longest surahs equals the source bytes', async ({ page }) => {
  const longest = [...surahs].sort((a, b) => b.items.length - a.items.length).slice(0, 3).map((s) => s.n);
  for (const s of longest) for (const path of [`/${s}/`, `/en/${s}/`]) {
    await page.goto(path);
    const ay = await pageAyat(page);
    let equal = 0;
    for (const x of ay) if (x.bytes.equals(src.slices[src.list.findIndex((a) => `${a.sora}:${a.aya_no}` === x.ref)])) equal++;
    expect(equal).toBe(surahs[s - 1].items.length);
  }
});

test('TP1-40 (measured, placeholder profile): surah open time with 4x CPU and placeholder 4G', async ({ browser }) => {
  const out: Record<string, number[]> = {};
  for (const s of [surahs.reduce((m, x) => (x.items.length > m.items.length ? x : m)).n, 1]) {
    out[s] = [];
    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', NET4G);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const t0 = Date.now();
      await page.goto(`/${s}/`, { waitUntil: 'commit' });
      await page.waitForFunction((n) => document.querySelectorAll('p.ayah[data-r]').length === n && document.readyState !== 'loading', surahs[s - 1].items.length);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      out[s].push(Date.now() - t0);
      await ctx.close();
    }
  }
  test.info().annotations.push({ type: 'timing-ms', description: JSON.stringify(out) });
  for (const v of Object.values(out)) expect(Math.max(...v)).toBeLessThan(3000);
});
