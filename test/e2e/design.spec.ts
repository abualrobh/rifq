// Design round 1 (D-102): the light (cream) and dark palettes as CSS custom properties, the night
// reading setting switching between them, the self-hosted Tajawal interface font, the unchanged
// Quran font (D-069), contrast in both modes, and the phone, tablet and desktop layouts.
import { test, expect, MOBILE, hydrated, noOverflow } from './helpers.ts';

const TABLET = { width: 834, height: 1194 };
const WIDE = { width: 1440, height: 960 };
const LIGHT = { bg: '#F7F4EC', surface: '#FFFFFF', surface2: '#EFEADD', primary: '#174D3C', 'on-primary': '#FFFFFF', link: '#2E7D62', gold: '#C9A64B', fg: '#17372F', muted: '#4E6159', line: '#E2DCCB' };
const DARK = { bg: '#0E1714', surface: '#15221D', surface2: '#1B2B25', primary: '#3E9C7B', 'on-primary': '#06110D', link: '#7CC9AC', gold: '#D4B45C', fg: '#E9F0EC', muted: '#A9BAB2', line: '#26372F' };

const tokens = (page: import('@playwright/test').Page, names: string[]) => page.evaluate((ns) => {
  const cs = getComputedStyle(document.documentElement);
  // The CSS minifier may write #FFFFFF as #FFF; expand it before comparing.
  const full = (v: string) => (/^#[0-9A-F]{3}$/.test(v) ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v);
  return Object.fromEntries(ns.map((n) => [n, full(cs.getPropertyValue('--' + n).trim().toUpperCase())]));
}, names);

const ratio = (a: string, b: string) => {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('DS-01: light is the default palette; the night setting switches to the dark palette and back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/2/');
  await hydrated(page);
  // prefers-color-scheme is not used: the mode follows the reading setting only, as before.
  expect(await tokens(page, Object.keys(LIGHT))).toEqual(LIGHT);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(247, 244, 236)');
  await page.click('[data-night]');
  expect(await tokens(page, Object.keys(DARK))).toEqual(DARK);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 23, 20)');
  await page.goto('/');
  await hydrated(page);
  expect(await tokens(page, ['bg'])).toEqual({ bg: DARK.bg });
  await page.click('[data-night]');
  expect(await tokens(page, ['bg'])).toEqual({ bg: LIGHT.bg });
});

test('DS-02: body text and links meet 4.5:1 on background and surface in both modes', async ({ page }) => {
  const out: Record<string, number> = {};
  for (const [mode, P] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const fg of ['fg', 'link', 'muted'] as const) for (const bg of ['bg', 'surface'] as const) {
      const r = ratio(P[fg], P[bg]);
      out[`${mode}.${fg}/${bg}`] = Math.round(r * 100) / 100;
      expect(r, `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    out[`${mode}.on-primary/primary`] = Math.round(ratio(P['on-primary'], P.primary) * 100) / 100;
    expect(ratio(P['on-primary'], P.primary)).toBeGreaterThanOrEqual(4.5);
  }
  // The same check on rendered elements: body text, a link, the continue card and a surface box.
  await page.addInitScript(() => { try { localStorage.setItem('rifq.saves', '{"v":1,"b":[[1,1]],"l":[2,40]}'); } catch { /* none */ } });
  for (const mode of ['light', 'dark']) {
    await page.goto('/');
    await hydrated(page);
    if (mode === 'dark') await page.click('[data-night]');
    await expect(page.locator('[data-continue]')).toBeVisible();
    await expect(page.locator('[data-bm-link]')).toBeVisible();
    const r = await page.evaluate(() => {
      const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const lum = (c: string) => { const m = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bg = (el: Element | null): string => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c; } return getComputedStyle(document.documentElement).backgroundColor; };
      const o: Record<string, number> = {};
      for (const [k, s] of Object.entries({ title: '.home-title', link: '.footer-links a', bookmark: '[data-bm-link]', continue: '[data-continue]', index: '.index-card-title', hint: '.hint', button: '[data-clear-last]' })) {
        const el = document.querySelector(s);
        if (el) o[k] = ratio(getComputedStyle(el).color, bg(el));
      }
      return o;
    });
    for (const [k, v] of Object.entries(r)) { out[`${mode}.page.${k}`] = Math.round(v * 100) / 100; expect(v, `${mode} ${k}`).toBeGreaterThanOrEqual(4.5); }
    expect(Object.keys(r).length).toBe(7);
  }
  test.info().annotations.push({ type: 'contrast', description: JSON.stringify(out) });
});

test('DS-03: Tajawal is the interface font, self-hosted; the Quran text keeps Noto Naskh Arabic', async ({ page, seen }) => {
  await page.goto('/2/');
  await hydrated(page);
  const r = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('700 16px Tajawal', 'ab');
    await document.fonts.load('16px Tajawal', String.fromCodePoint(0x628));
    return {
      body: getComputedStyle(document.body).fontFamily,
      ayah: getComputedStyle(document.querySelector('p.ayah')!).fontFamily,
      faces: [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Tajawal').map((f) => `${f.weight}:${f.status}`),
    };
  });
  expect(r.body).toMatch(/^"?Tajawal"?, system-ui, sans-serif$/);
  expect(r.ayah).toMatch(/^"?Noto Naskh Arabic"?, "?Scheherazade New"?, serif$/);
  expect(new Set(r.faces.map((f) => f.split(':')[0]))).toEqual(new Set(['400', '500', '700']));
  expect(r.faces).toContain('400:loaded');
  const fonts = seen.filter((x) => x.url.includes('/fonts/'));
  expect(fonts.some((x) => new URL(x.url).pathname.startsWith('/fonts/tajawal/'))).toBe(true);
  for (const x of seen) expect(new URL(x.url).hostname).toBe('127.0.0.1');
});

test('DS-04: Tajawal files and licence are served from this site; the policy allows own fonts only', async ({ request }) => {
  for (const sub of ['arabic', 'latin']) for (const w of [400, 500, 700]) {
    const r = await request.get(`/fonts/tajawal/tajawal-${sub}-${w}-normal.woff2`);
    expect(r.status()).toBe(200);
  }
  const lic = await request.get('/fonts/tajawal/OFL.txt');
  expect(lic.status()).toBe(200);
  expect(await lic.text()).toContain('SIL Open Font License');
  const csp = (await request.get('/')).headers()['content-security-policy'];
  expect(csp).toContain("font-src 'self'");
  expect(csp).not.toContain('fonts.googleapis.com');
  expect(csp).not.toContain('unsafe-inline');
});

for (const vp of [MOBILE, TABLET, WIDE]) {
  for (const lang of ['ar', 'en'] as const) {
    test(`DS-05: home, index, reader and privacy fit at ${vp.width}px with 44 px targets, ${lang}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.addInitScript(() => { try { localStorage.setItem('rifq.saves', '{"v":1,"b":[[1,1],[2,5]],"l":[2,40]}'); } catch { /* none */ } });
      const pre = lang === 'ar' ? '/' : '/en/';
      for (const path of [pre, `${pre}surahs/`, `${pre}2/`, `${pre}privacy/`]) {
        await page.goto(path);
        await hydrated(page);
        if (path === pre) await expect(page.locator('[data-continue]')).toBeVisible();
        if (path.endsWith('surahs/')) await expect(page.locator('#sq')).toBeVisible();
        await noOverflow(page);
        const small = await page.$$eval('.site-header a, .site-header button, .btn, .surah-nav a, [data-index-link], [data-continue], [data-surah-link], .bookmarks a', (els) => els
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => [e.className || e.tagName, Math.round(e.getBoundingClientRect().height)] as [string, number])
          .filter(([, h]) => h < 44));
        expect(small, path).toEqual([]);
      }
    });
  }
}

test('DS-06: the gold colour is never used for text', async ({ page }) => {
  for (const mode of ['light', 'dark']) {
    await page.goto('/2/');
    await hydrated(page);
    if (mode === 'dark') await page.click('[data-night]');
    const gold = mode === 'light' ? 'rgb(201, 166, 75)' : 'rgb(212, 180, 92)';
    for (const path of ['/', '/surahs/', '/2/']) {
      await page.goto(path);
      await hydrated(page);
      const hits = await page.evaluate((g) => [...document.querySelectorAll('body *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && getComputedStyle(e).color === g).length, gold);
      expect(hits, `${mode} ${path}`).toBe(0);
    }
  }
});
