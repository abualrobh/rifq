// RQ-004 decisions D-090 D, D-091 B, D-092 B and D-094 B, and the bidi fix for decision IDs inside
// Arabic text (iPhone Safari report on the Tafseer dev notice). Expected names, juz and starts are
// read from the source named by RIFQ_RECORD at run time; no Quran text or name is in this file.
import { test, expect, src, surahs, N, MOBILE, hydrated, noOverflow, topAyah } from './helpers.ts';
import { t } from '../../src/core/strings.ts';
import { afterArticle, enKeys, foldName } from '../../src/core/surah-match.ts';

const idx = (lang: 'ar' | 'en') => (lang === 'ar' ? '/surahs/' : '/en/surahs/');
const visible = (page: import('@playwright/test').Page) => page.$$eval('[data-index-list] > li[data-row]', (ls) => ls.filter((l) => !(l as HTMLElement).hidden).map((l) => Number((l as HTMLElement).dataset.row)));
async function filter(page: import('@playwright/test').Page, q: string) {
  if ((await page.inputValue('#sq')) === q) return; // same query: nothing changes
  const before = Number(await page.locator('[data-filter-status]').getAttribute('data-seq'));
  await page.fill('#sq', q);
  await expect(page.locator('[data-filter-status]')).not.toHaveAttribute('data-seq', String(before));
}
// First record with each jozz value, in source order.
const juzStart = new Map<number, string>();
for (const a of src.list as { sora: number; aya_no: number; jozz?: number }[]) if (a.jozz && !juzStart.has(a.jozz)) juzStart.set(a.jozz, `${a.sora}:${a.aya_no}`);

for (const lang of ['ar', 'en'] as const) {
  test(`D090-01 (AC22): every row shows the juz its surah starts in, from the file, ${lang}`, async ({ page }) => {
    await page.goto(idx(lang));
    const rows = await page.$$eval('[data-index-list] > li', (ls) => ls.map((l) => { const j = l.querySelector('[data-juz]')!; return [j.getAttribute('data-juz'), j.textContent]; }));
    expect(rows.length).toBe(N);
    rows.forEach(([j, text], i) => {
      const want = (surahs[i].items[0] as { jozz?: number }).jozz!;
      expect(Number(j), `surah ${i + 1}`).toBe(want);
      expect(text).toBe(t(lang, 'juzOf', { n: want }));
    });
  });

  test(`D090-02 (AC23): the 30 juz open the reader at their first ayah in the file, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(idx(lang));
    const links = await page.$$eval('[data-juz-link]', (as) => as.map((a) => [Number(a.getAttribute('data-juz-link')), a.getAttribute('data-juz-start'), a.getAttribute('href'), a.textContent, Math.round(a.getBoundingClientRect().height)] as const));
    expect(juzStart.size).toBe(30);
    expect(links.map((l) => l[0])).toEqual([...juzStart.keys()].sort((a, b) => a - b));
    for (const [j, start, href, text, h] of links) {
      expect(start, `juz ${j}`).toBe(juzStart.get(j));
      const [s, a] = start!.split(':');
      expect(href).toBe(`${lang === 'ar' ? '/' : '/en/'}${s}/#a${a}`);
      expect(text).toBe(t(lang, 'juzOf', { n: j }));
      expect(h).toBeGreaterThanOrEqual(44);
    }
    for (const j of [2, 30]) {
      await page.goto(idx(lang));
      await page.click(`[data-juz-link="${j}"]`);
      const [s, a] = juzStart.get(j)!.split(':');
      await expect(page).toHaveURL(new RegExp(`/${s}/#a${a}$`));
      await expect(page.locator(`#a${a}`)).toBeInViewport();
      // v1.0 AC40: that exact ayah is at the top, under its own surah heading.
      await hydrated(page);
      expect(await topAyah(page)).toBe(Number(a));
      await expect(page.locator('h1.surah-title [data-sn]')).toHaveText(`${s}.`);
    }
    await expect(page.locator('[data-juz-list]')).toHaveCount(0);
    await page.goto(idx(lang));
    await noOverflow(page);
  });
}

test('D091-01 (AC13): the English interface filter matches English names, without marks or the article', async ({ page }) => {
  await page.goto('/en/surahs/');
  await hydrated(page);
  for (const s of surahs) {
    const [whole, rest] = enKeys(s.en);
    // The stored name as typed on a plain keyboard (no macrons, dots, marks or hyphens).
    for (const q of [s.en, whole.toUpperCase(), (rest || whole).slice(0, 3)]) {
      await filter(page, q);
      expect(await visible(page), `surah ${s.n}, query of ${q.length} letters`).toContain(s.n);
    }
  }
  await expect(page.locator('#sq-hint')).toHaveText(t('en', 'filterHintEn'));
});

test('D091-02: the Arabic interface keeps the D-050 message for Latin letters', async ({ page }) => {
  await page.goto('/surahs/');
  await hydrated(page);
  await filter(page, surahs[1].en);
  await expect(page.locator('[data-filter-status]')).toHaveText(t('ar', 'latinOnly'));
});

test('D092-01: two letters after the Arabic article find the surah in the index and in search offers', async ({ page, request }) => {
  const withArticle = surahs.filter((s) => afterArticle(foldName(s.ar)) !== '');
  expect(withArticle.length).toBeGreaterThan(50);
  for (const s of withArticle) {
    const q = [...afterArticle(foldName(s.ar))].slice(0, 2).join('');
    const r = await request.post('/api/search', { data: { q, page: 1 }, headers: { 'content-type': 'application/json' } });
    expect(r.status()).toBe(200);
    const offered = (await r.json()).offers.filter((o: { kind: string }) => o.kind === 'surah').map((o: { s: number }) => o.s);
    expect(offered, `surah ${s.n}`).toContain(s.n);
  }
  // In the browser: the index filter and the home search offers, for surah 2.
  const q2 = [...afterArticle(foldName(surahs[1].ar))].slice(0, 2).join('');
  await page.goto('/surahs/');
  await hydrated(page);
  await filter(page, q2);
  expect(await visible(page)).toContain(2);
  await page.goto('/');
  await hydrated(page);
  await page.fill('#q', q2);
  await page.press('#q', 'Enter');
  await expect(page.locator('a[data-offer="2"]')).toBeVisible();
});

test('D094-01: English rows show the English name and the Arabic name; Arabic rows the Arabic name only', async ({ page }) => {
  await page.goto('/en/surahs/');
  const rows = await page.$$eval('[data-index-list] > li a', (as) => as.map((a) => [a.querySelector('[data-name]')!.textContent, a.querySelector('[data-name-ar]')?.textContent, a.querySelector('[data-name-ar]')?.getAttribute('dir'), a.querySelector('[data-name-ar]')?.getAttribute('lang')]));
  rows.forEach(([en, ar, dir, lang], i) => {
    expect(Buffer.from(en!).equals(Buffer.from(surahs[i].en)), `en ${i + 1}`).toBe(true);
    expect(Buffer.from(ar!).equals(Buffer.from(surahs[i].ar)), `ar ${i + 1}`).toBe(true);
    expect([dir, lang]).toEqual(['rtl', 'ar']);
  });
  await page.setViewportSize(MOBILE);
  await noOverflow(page);
  await page.goto('/surahs/');
  await expect(page.locator('[data-name-ar]')).toHaveCount(0);
});

test('BIDI-01: decision IDs in Arabic text are isolated left to right and keep their order', async ({ page, request }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/tafseer/2/#a5');
  const note = page.locator('[data-tafseer-dev]');
  await expect(note).toHaveText(t('ar', 'tafseerDevNote'));
  const runs = await note.locator('bdi[dir="ltr"]').evaluateAll((bs) => bs.map((b) => [b.textContent, b.getBoundingClientRect().left]));
  expect(runs.map((r) => r[0])).toEqual(['D-076', 'D-012', 'D-008']);
  // Each ID stays whole on one line (it was split at its hyphen at 390 px before nowrap).
  expect(await note.locator('bdi[dir="ltr"]').evaluateAll((bs) => bs.map((b) => b.getClientRects().length))).toEqual([1, 1, 1]);
  // Right to left: each ID is to the left of the one before it, or on a later line.
  const tops = await note.locator('bdi[dir="ltr"]').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().top));
  for (let i = 1; i < runs.length; i++) if (tops[i] === tops[i - 1]) expect(runs[i][1] as number).toBeLessThan(runs[i - 1][1] as number);
  // The same isolation everywhere an Arabic string carries an ID or a Latin name.
  await page.goto('/');
  await expect(page.locator('[data-dev-banner]')).toHaveText(t('ar', 'devBanner'));
  await expect(page.locator('[data-dev-banner] bdi[dir="ltr"]')).toHaveText('D-045');
  await hydrated(page);
  await expect(page.locator('#q-hint bdi[dir="ltr"]')).toHaveText('D-027');
  // English pages are not changed.
  await page.goto('/en/tafseer/2/');
  await expect(page.locator('[data-tafseer-dev] bdi')).toHaveCount(0);
  // The Worker's no-JavaScript results page.
  const r = await request.post('/api/search', { form: { q: String.fromCodePoint(0x628, 0x633, 0x645), lang: 'ar' } });
  const html = await r.text();
  expect(html).toContain('<bdi dir="ltr">D-045</bdi>');
  expect(html).toContain('<bdi dir="ltr">D-027</bdi>');
});

test('v1.0 AC39: the juz list is a labelled list of 30, in order, and works without JavaScript', async ({ browser }) => {
  for (const lang of ['ar', 'en'] as const) {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE });
    const page = await ctx.newPage();
    await page.goto(idx(lang));
    const list = page.locator('[data-juz-list] ol');
    await expect(list).toHaveAttribute('aria-label', t(lang, 'juzListLabel', { n: 30 }));
    await expect(page.locator('#juz-h')).toHaveText(t(lang, 'juzTitle'));
    expect(await list.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('data-juz-link')))).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
    await page.click('[data-juz-link="2"]');
    const [s, a] = juzStart.get(2)!.split(':');
    await expect(page).toHaveURL(new RegExp(`/${s}/#a${a}$`));
    await ctx.close();
  }
});

test('v1.0 AC36: Arabic article queries give the same surahs in the index and in search', async ({ page, request }) => {
  const s2 = foldName(surahs[1].ar);
  const after2 = [...afterArticle(s2)].slice(0, 2).join('');
  const article = [...s2].slice(0, 2).join('');
  const withArticle = surahs.filter((s) => foldName(s.ar).startsWith(article)).map((s) => s.n);
  const cases: [string, number[] | null][] = [[after2, [2]], [article + after2, [2]], [article, withArticle], [[...after2][0], []]];
  await page.goto('/surahs/');
  await hydrated(page);
  for (const [q, want] of cases) {
    await filter(page, q);
    const shown = await visible(page);
    if (want) expect(shown, `query of ${[...q].length} letters`).toEqual(want);
    const r = await request.post('/api/search', { data: { q, page: 1 }, headers: { 'content-type': 'application/json' } });
    const offered = r.ok() ? (await r.json()).offers.filter((o: { kind: string }) => o.kind === 'surah').map((o: { s: number }) => o.s) : [];
    expect(offered, `search, query of ${[...q].length} letters`).toEqual(shown);
  }
});

test('v1.0 AC37, P-11: English article forms, spaces like hyphens, and surah 3 from its full name only', async ({ page }) => {
  await page.goto('/en/surahs/');
  await hydrated(page);
  const [whole2, rest2] = enKeys(surahs[1].en);
  const art2 = whole2.slice(0, whole2.length - rest2.length);
  const b = rest2.slice(0, 3);
  for (const q of [b, b.toUpperCase(), `${art2}-${b}`, `${art2[0].toUpperCase()}${art2.slice(1)} ${b}`, `${art2}${b}`]) {
    await filter(page, q);
    expect(await visible(page), q).toEqual([2]);
  }
  const withArticle = surahs.filter((s) => enKeys(s.en)[1] !== '');
  expect(withArticle.length).toBe(95);
  for (const s of withArticle) {
    await filter(page, enKeys(s.en)[1].slice(0, 2));
    expect(await visible(page), `surah ${s.n}`).toContain(s.n);
  }
  const [w3, r3] = enKeys(surahs[2].en);
  expect(r3).toBe('');
  for (const q of [w3.slice(0, 2), w3.slice(0, 3), surahs[2].en]) { await filter(page, q); expect(await visible(page), q).toContain(3); }
  await filter(page, w3.slice(2));
  expect(await visible(page)).not.toContain(3);
});

test('v1.0 AC34: English rows read number, English name, Arabic name, then count and juz, left to right', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/surahs/');
  const bad = await page.$$eval('[data-index-list] > li a', (as) => as.flatMap((a) => {
    const r = (s: string) => a.querySelector(s)!.getBoundingClientRect();
    const n = r('[data-sn]'), en = r('[data-name]'), ar = r('[data-name-ar]'), c = r('[data-ayat]'), j = r('[data-juz]');
    const sameLine = Math.abs(en.top - ar.top) < 8;
    const ok = n.right <= en.left && (sameLine ? en.right <= ar.left : ar.top > en.top) && Math.max(en.right, ar.right) <= Math.min(c.left, j.left);
    return ok ? [] : [a.getAttribute('data-surah-link')];
  }));
  expect(bad).toEqual([]);
});
