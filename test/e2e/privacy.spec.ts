// D-099 privacy page (/privacy/ and /en/privacy/), approved text "for now"; the Arabic awaits the
// B-09 review. The page holds no Quran text. Expected text comes from src/core/strings.ts.
import { test, expect, MOBILE, hydrated, noOverflow } from './helpers.ts';
import { t, privacyPath, CLOUDFLARE_PRIVACY_URL, PRIVACY_ITEMS, type Lang } from '../../src/core/strings.ts';

const LANGS = ['ar', 'en'] as const;
// Built from code point numbers, because Arabic script may appear only in src/core/strings.ts:
// the Arabic words for cookie (transliterated and the formal term), and Arabic-Indic digits.
const ch = (...c: number[]) => String.fromCharCode(...c);
const NO_COOKIE = new RegExp(`cookie|${ch(0x643, 0x648, 0x643, 0x64a)}|${ch(0x627, 0x644, 0x627, 0x631, 0x62a, 0x628, 0x627, 0x637)}`, 'i');
const NOT_LATIN_DIGIT = new RegExp(`[${ch(0x660)}-${ch(0x669)}${ch(0x6f0)}-${ch(0x6f9)}]`);
const ORIGIN = 'http://127.0.0.1:8812';
const items = (lang: Lang) => PRIVACY_ITEMS.map(([l, x]) => l === 'hosting'
  ? `${t(lang, 'pvHostingL')}: ${t(lang, 'pvHostingBefore')}${t(lang, 'pvHostingLink')}${t(lang, 'pvHostingAfter')}`
  : `${t(lang, l)}: ${t(lang, x)}`);
const labels = (lang: Lang) => PRIVACY_ITEMS.map(([l]) => `${t(lang, l === 'hosting' ? 'pvHostingL' : l)}:`);

for (const lang of LANGS) {
  test(`PV-01: the privacy page shows the approved text with the site headers, ${lang}`, async ({ page, request }) => {
    const res = await page.goto(privacyPath(lang));
    expect(res!.status()).toBe(200);
    await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    await expect(page).toHaveTitle(t(lang, 'pvTitle'));
    await expect(page.locator('h1')).toHaveText(t(lang, 'pvTitle'));
    await expect(page.locator('.pv-lead')).toHaveText(t(lang, 'pvLead'));
    const li = page.locator('.pv-list > li');
    await expect(li).toHaveCount(9);
    expect((await li.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())).toEqual(items(lang));
    expect(await page.locator('.pv-list > li > strong').allInnerTexts()).toEqual(labels(lang));
    await expect(page.locator('[data-pv-updated]')).toHaveText(t(lang, 'pvUpdated'));
    // The alternate-language link goes to the other privacy page.
    await expect(page.locator('#lang-switch')).toHaveAttribute('href', privacyPath(lang === 'ar' ? 'en' : 'ar'));
    const body = await page.locator('body').innerText();
    expect(NO_COOKIE.test(body), 'no cookie claim').toBe(false);
    expect(NOT_LATIN_DIGIT.test(body), 'Latin digits only (D-065)').toBe(false);
    // Same headers as every page: noindex (D-066) and the unchanged site CSP.
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex,nofollow');
    const h = res!.headers();
    expect(h['x-robots-tag']).toBe('noindex, nofollow');
    const home = await request.get(lang === 'ar' ? '/' : '/en/');
    expect(h['content-security-policy']).toBeTruthy();
    expect(h['content-security-policy']).toBe(home.headers()['content-security-policy']);
    expect(h['content-security-policy']).not.toMatch(/unsafe-inline|cloudflare/);
  });

  test(`PV-02: the privacy page works without JavaScript, ${lang}`, async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: ORIGIN });
    const page = await ctx.newPage();
    expect((await page.goto(privacyPath(lang)))!.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(t(lang, 'pvTitle'));
    expect((await page.locator('.pv-list > li').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())).toEqual(items(lang));
    await expect(page.locator('[data-pv-external]')).toHaveAttribute('href', CLOUDFLARE_PRIVACY_URL);
    await expect(page.locator('.site-footer a[data-privacy-link]')).toHaveAttribute('href', privacyPath(lang));
    await ctx.close();
  });

  test(`PV-03: the footer links to the privacy page on home, reader and Tafseer pages, ${lang}`, async ({ page }) => {
    const pre = lang === 'ar' ? '/' : '/en/';
    for (const p of [pre, `${pre}2/`, `${pre}tafseer/2/`, privacyPath(lang)]) {
      await page.goto(p);
      const a = page.locator('footer.site-footer a[data-privacy-link]');
      await expect(a, p).toHaveCount(1);
      await expect(a, p).toHaveAttribute('href', privacyPath(lang));
      await expect(a, p).toHaveText(t(lang, 'privacyLink'));
    }
    await page.goto(`${pre}2/`);
    await page.click('footer.site-footer a[data-privacy-link]');
    await expect(page).toHaveURL(ORIGIN + privacyPath(lang));
    await expect(page.locator('h1')).toHaveText(t(lang, 'pvTitle'));
  });

  test(`PV-04: the Cloudflare policy is the only external link, and nothing is loaded from another site, ${lang}`, async ({ page }) => {
    await page.goto(privacyPath(lang));
    const r = await page.evaluate(() => ({
      links: [...document.querySelectorAll('a[href]')].map((a) => ({ href: (a as HTMLAnchorElement).href, rel: a.getAttribute('rel') ?? '' })),
      res: [...document.querySelectorAll('[src], link[href]')].map((e) => (e as HTMLLinkElement).href || (e as HTMLScriptElement).src),
      origin: location.origin,
    }));
    const ext = r.links.filter((l) => new URL(l.href).origin !== r.origin);
    expect(ext.map((l) => l.href)).toEqual([CLOUDFLARE_PRIVACY_URL]);
    expect(ext[0].rel.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer']);
    for (const u of r.res) expect(new URL(u).origin, u).toBe(r.origin);
  });

  test(`PV-05: loading the privacy page sends no request off the origin, 390 px, night mode, ${lang}`, async ({ page, seen }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => { try { localStorage.setItem('rifq.settings', '{"dark":true}'); } catch {} });
    await page.goto(privacyPath(lang));
    await hydrated(page);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await noOverflow(page);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(new URL(s.url).origin, s.url).toBe(ORIGIN);
  });
}
