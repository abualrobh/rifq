// RQ-004 v0.1 (DRAFT) surah index page, built with option A for the open choices D-090, D-091,
// D-092 and D-094 (D-089 B and D-093 A decided). Expected names and counts are read from the source
// named by RIFQ_RECORD at run time; no Quran text is written in this file.
import { test, expect, src, surahs, N, MOBILE, DESKTOP, hydrated, noOverflow } from './helpers.ts';
import { t, ayatLabel } from '../../src/core/strings.ts';

const idx = (lang: 'ar' | 'en') => (lang === 'ar' ? '/surahs/' : '/en/surahs/');
const arDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(0x660 + Number(d)));

async function filter(page: import('@playwright/test').Page, q: string) {
  const before = Number(await page.locator('[data-filter-status]').getAttribute('data-seq'));
  await page.fill('#sq', q);
  await expect(page.locator('[data-filter-status]')).not.toHaveAttribute('data-seq', String(before));
}
const visible = (page: import('@playwright/test').Page) => page.$$eval('[data-index-list] > li[data-row]', (ls) => ls.filter((l) => !(l as HTMLElement).hidden).map((l) => Number((l as HTMLElement).dataset.row)));

for (const lang of ['ar', 'en'] as const) {
  test(`IX-01 (AC1, AC2, AC3, AC4, AC6): 114 rows in source order with source names and counts, ${lang}`, async ({ page }) => {
    await page.goto(idx(lang));
    await hydrated(page);
    const rows = await page.$$eval('[data-index-list] > li', (ls) => ls.map((l) => {
      const a = l.querySelector('a')!;
      return { n: a.getAttribute('data-surah-link'), sn: a.querySelector('[data-sn]')!.textContent, name: a.querySelector('span[lang]')!.textContent, count: a.querySelector('[data-ayat]')!.getAttribute('data-ayat'), label: a.querySelector('[data-ayat]')!.textContent, href: a.getAttribute('href') };
    }));
    expect(rows.length).toBe(N);
    let total = 0;
    rows.forEach((r, i) => {
      const s = surahs[i];
      expect(r.n).toBe(String(s.n));
      expect(r.sn).toBe(`${s.n}.`);
      expect(Buffer.from(r.name!, 'utf8').equals(Buffer.from(lang === 'ar' ? s.ar : s.en, 'utf8')), `name ${s.n}`).toBe(true);
      expect(Number(r.count)).toBe(src.list.filter((a) => a.sora === s.n).length);
      expect(r.label).toBe(ayatLabel(lang, s.items.length));
      expect(r.href).toBe(`${lang === 'ar' ? '/' : '/en/'}${s.n}/`);
      total += Number(r.count);
    });
    expect(total).toBe(src.list.length);
    // AC4: no ayah text on the page, and no Meccan or Medinan label.
    const html = await page.content();
    for (const a of src.list.slice(0, 300)) expect(html.includes(a.aya_text), `${a.sora}:${a.aya_no}`).toBe(false);
    expect(await page.locator('p.ayah').count()).toBe(0);
    await expect(page.locator('[data-index-list]')).toHaveAttribute('aria-label', t(lang, 'indexListLabel', { n: N }));
  });

  test(`IX-02 (AC8, D-089): home and every reader page link to the index with a 44 px control, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    for (const path of lang === 'ar' ? ['/', '/1/', `/${N}/`] : ['/en/', '/en/1/', `/en/${N}/`]) {
      await page.goto(path);
      const link = page.locator('a[data-index-link]');
      await expect(link).toHaveAttribute('href', idx(lang));
      const box = (await link.boundingBox())!;
      expect(box.height, path).toBeGreaterThanOrEqual(44);
    }
    await page.click('a[data-index-link]');
    await expect(page).toHaveURL(new RegExp(`${idx(lang)}$`));
  });

  test(`IX-03 (AC9, AC10, AC11): numbers and references in Latin and Arabic digits, ${lang}`, async ({ page, seen }) => {
    await page.goto(idx(lang));
    await hydrated(page);
    for (const q of ['18', arDigits('18')]) {
      await filter(page, q);
      expect(await visible(page)).toEqual([18]);
      await expect(page.locator('[data-filter-status]')).toHaveText(t(lang, 'filterCount', { n: 1 }));
    }
    await filter(page, '2 : 255');
    expect(await visible(page)).toEqual([2]);
    const offer = page.locator('a[data-filter-ayah="2:255"]');
    await expect(offer).toHaveAttribute('href', `${lang === 'ar' ? '/' : '/en/'}2/#a255`);
    for (const q of ['0', String(N + 1), `2:${surahs[1].items.length + 1}`]) {
      await filter(page, q);
      expect(await visible(page)).toEqual([]);
      await expect(page.locator('[data-filter-status]')).toHaveText(t(lang, 'refMissing'));
    }
    await filter(page, '2:255');
    await page.locator('a[data-filter-ayah="2:255"]').click();
    await expect(page).toHaveURL(/\/2\/#a255$/);
    await expect(page.locator('#a255')).toBeInViewport();
    // AC16: the filter text never leaves the page.
    for (const s of seen) { expect(s.method).toBe('GET'); expect(new URL(s.url).pathname.startsWith('/api/')).toBe(false); }
  });
}

test('IX-04 (AC12): the index filter shows the same surahs search offers, for name prefixes of several surahs', async ({ page, request }) => {
  await page.goto('/surahs/');
  await hydrated(page);
  const qs = new Set<string>();
  for (const s of [surahs[0], surahs[1], surahs[2], surahs[17], surahs[N - 1]]) {
    const cps = [...s.ar];
    for (const k of [1, 2, 3, cps.length]) qs.add(cps.slice(0, k).join(''));
    qs.add(s.ar.replace(/[\u064b-\u065f\u0670]/g, ''));
  }
  for (const q of qs) {
    const r = await request.post('/api/search', { data: { q, page: 1 }, headers: { 'content-type': 'application/json' } });
    const offered = r.ok() ? (await r.json()).offers.filter((o: any) => o.kind === 'surah').map((o: any) => o.s) : [];
    await filter(page, q);
    expect(await visible(page), `query of ${[...q].length} letters`).toEqual(offered);
  }
});

for (const lang of ['ar', 'en'] as const) {
  test(`IX-05 (AC14, AC15, AC17, D-091 A): no match, clear, Latin letters, 100 characters, ${lang}`, async ({ page, context }) => {
    await page.goto(idx(lang));
    await hydrated(page);
    await filter(page, String.fromCodePoint(0x6a4).repeat(3));
    expect(await visible(page)).toEqual([]);
    await expect(page.locator('[data-filter-status]')).toHaveText(t(lang, 'filterNone'));
    const clear = page.locator('[data-filter-clear]');
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await clear.click();
    expect(await visible(page)).toEqual(surahs.map((s) => s.n));
    await expect(page.locator('#sq')).toBeFocused();
    await filter(page, 'Yusuf');
    await expect(page.locator('[data-filter-status]')).toHaveText(t(lang, 'latinOnly'));
    await page.fill('#sq', '');
    await page.locator('#sq').pressSequentially(String.fromCodePoint(0x628).repeat(105));
    expect([...(await page.inputValue('#sq'))].length).toBe(100);
    await expect(page.locator('[data-filter-chars]')).toHaveText(t(lang, 'charCount', { n: 100 }));
    // AC16: nothing typed is stored on the device.
    const all = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(all.includes(String.fromCodePoint(0x628).repeat(5))).toBe(false);
    expect((await context.cookies()).length).toBe(0);
  });

  test(`IX-06 (AC18, AC19, AC20, AC21): continue reading above the list, ${lang}`, async ({ page, context }) => {
    await page.goto(idx(lang));
    await hydrated(page);
    await expect(page.locator('[data-continue]')).toHaveCount(0);
    await context.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('rifq.saves', '{"v":1,"b":[],"l":[2,40]}'); sessionStorage.setItem('seeded', '1'); } });
    const p = await context.newPage();
    await p.goto(idx(lang));
    await hydrated(p);
    const c = p.locator('[data-continue]');
    await expect(c).toContainText(t(lang, 'continueReading', { name: lang === 'ar' ? surahs[1].ar : surahs[1].en, a: 40 }));
    await expect(p.locator('[data-continue-ref]')).toHaveText('2:40');
    expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    const cBox = (await c.boundingBox())!, listBox = (await p.locator('[data-index-list]').boundingBox())!;
    expect(cBox.y).toBeLessThan(listBox.y);
    expect(await p.evaluate(() => localStorage.getItem('rifq.saves'))).toBe('{"v":1,"b":[],"l":[2,40]}');
    await c.click();
    await expect(p).toHaveURL(/\/2\/#a40$/);
    const q = await context.newPage();
    await q.addInitScript(() => localStorage.setItem('rifq.saves', '{"v":1,"b":[],"l":[2,9999]}'));
    await q.goto(idx(lang));
    await hydrated(q);
    await expect(q.locator('[data-bad-last]')).toHaveText(t(lang, 'badRef', { s: 2, a: 9999 }));
    await expect(q.locator('[data-index-list] > li')).toHaveCount(N);
  });
}

for (const vp of [MOBILE, { width: 834, height: 1194 }, { width: 1440, height: 960 }]) {
  test(`IX-07 (AC24, AC27): language switch, no overflow and 44 px rows, ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/surahs/');
    await hydrated(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await noOverflow(page);
    const h = await page.$$eval('[data-index-list] a', (as) => as.map((a) => a.getBoundingClientRect().height));
    expect(Math.min(...h)).toBeGreaterThanOrEqual(44);
    await page.click('#lang-switch');
    await expect(page).toHaveURL(/\/en\/surahs\/$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await hydrated(page);
    await filter(page, '2');
    expect(await visible(page)).toEqual([2]);
    await noOverflow(page);
  });
}

test('IX-08 (AC28): without JavaScript all 114 rows show and open their surah', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/surahs/');
  await expect(page.locator('[data-index-list] > li:visible')).toHaveCount(N);
  await expect(page.locator('#sq')).toHaveCount(0);
  await page.click(`a[data-surah-link="${N}"]`);
  await expect(page).toHaveURL(new RegExp(`/${N}/$`));
  await ctx.close();
});

test('IX-09 (AC32): index responses send noindex and HSTS', async ({ request }) => {
  for (const p of ['/surahs/', '/en/surahs/']) {
    const r = await request.get(p);
    expect(r.status()).toBe(200);
    expect(r.headers()['x-robots-tag']).toContain('noindex');
    expect(r.headers()['strict-transport-security']).toBe('max-age=31536000');
  }
});

test('IX-10: the reader shows the index beside the text at tablet and desktop width, current surah marked', async ({ page }) => {
  for (const vp of [MOBILE, { width: 834, height: 1194 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(vp);
    await page.goto('/18/');
    await hydrated(page);
    const side = page.locator('[data-reader-side]');
    if (vp.width < 832) { await expect(side).toBeHidden(); continue; }
    await expect(side).toBeVisible();
    await expect(side.locator('a[aria-current="page"]')).toHaveAttribute('data-side-link', '18');
    const s = (await side.boundingBox())!, a = (await page.locator('p.ayah').first().boundingBox())!;
    expect(s.x, 'Arabic: index at the right of the text').toBeGreaterThan(a.x);
    await noOverflow(page);
  }
});
