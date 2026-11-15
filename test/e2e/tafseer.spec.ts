// RQ-005 Tafseer screen against the mock Quran Foundation API (127.0.0.1:8815, Worker only).
// The build must be made with --gate off and --fingerprints set to the e2e store made by
// test/mock/make-e2e-fingerprints.ts. Expected Quran bytes come from the source at run time;
// expected passages come from the mock's made-up text. No Tafseer is in this file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD, expect, sliceOf, src, test, utf8, hydrated } from './helpers.ts';
import { CASE, CLOSE, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID, OPEN, passageText } from '../mock/qf-mock.ts';
import { visibleText, sanitize } from '../../src/core/tafseer-html.ts';
import { STRINGS } from '../../src/core/strings.ts';
import { indexFromSource } from '../../src/core/tafseer-quotes.ts';
import { computeMarks, markedNodes, markedText } from '../../src/core/tafseer-marks.ts';
import { hitsIn, probesFrom, scanFolder } from '../../scripts/letters-scan.ts';

const shown = (page: import('@playwright/test').Page) => page.locator('.tf-row:not([hidden])');
async function ready(page: import('@playwright/test').Page) {
  await hydrated(page);
  await expect(page.locator('[data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
}

test('AC1, AC2, AC5, AC6, AC8, AC12: one tap from the reader opens labelled sections; only RIFQ is called', async ({ page, seen }) => {
  await page.goto('/2/#a20');
  await hydrated(page);
  await page.locator('li#a20 a[data-tf-link]').click();
  await expect(page).toHaveURL(/\/tafseer\/2\/#a20/);
  await ready(page);
  await expect(page.getByRole('region', { name: STRINGS.ar.quranSection })).toBeVisible();
  await expect(page.getByRole('region', { name: STRINGS.ar.tafseerSection })).toBeVisible();
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page).locator('[data-tf-ref]')).toContainText('2');
  await expect(shown(page).locator('[data-tf-ref]')).toContainText('20');
  const bytes = utf8(await shown(page).locator('p.ayah').textContent() ?? '');
  expect(bytes.equals(sliceOf(2, 20)), 'AC5: ayah bytes from the approved file').toBe(true);
  await expect(page.locator('[data-tf-text]')).toContainText('MOCK PASSAGE 2:20');
  await expect(page.locator('[data-tf-text]')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-tf-credit]')).toBeVisible();
  for (const s of seen) expect(new URL(s.url).port, 'AC12: the browser only calls RIFQ').toBe('8812');
  const api = seen.filter((s) => s.url.endsWith('/api/tafseer'));
  expect(api.length).toBe(1);
  expect(api[0].method).toBe('POST');
  expect(api[0].body).toBe('{"s":2,"a":20}');
  expect(Object.keys(api[0].headers).some((h) => h === 'cookie')).toBe(false);
});

test('AC4, AC13: every pre-live ayah is delivered byte for byte, with no credential', async ({ request }) => {
  let n = 0;
  for (const a of src.list.filter((x) => x.sora <= 2)) {
    const r = await request.post('/api/tafseer', { data: { s: a.sora, a: a.aya_no } });
    const raw = await r.text();
    expect(raw.includes(MOCK_CLIENT_SECRET) || raw.includes('mock-token-')).toBe(false);
    const want = passageText(MOCK_TAFSIR_ID, a.sora, a.aya_no, src);
    const d = JSON.parse(raw);
    if (want === null) { expect(d.status).toBe('none'); continue; }
    if (a.sora === 2 && [CASE.error500, CASE.rate429, CASE.slow].includes(a.aya_no as never)) { expect(d.status).toBe('unavailable'); continue; }
    if (a.sora === 2 && a.aya_no === CASE.changed) { expect(d.status).toBe('changed'); continue; }
    expect(Buffer.from(d.text, 'utf8').equals(Buffer.from(want, 'utf8')), `${a.sora}:${a.aya_no}`).toBe(true);
    n++;
  }
  expect(n).toBeGreaterThan(280);
});

test('AC7: source details show the API fields and "not stated" for the rest', async ({ page }) => {
  await page.goto('/tafseer/2/#a21');
  await ready(page);
  await page.locator('[data-tf-source] summary').click();
  await expect(page.locator('[data-tf-src-title]')).toHaveText('Mock Arabic Tafsir A');
  await expect(page.locator('[data-tf-src-author]')).toHaveText('Mock Author A');
  await expect(page.locator('[data-tf-src-edition]')).toHaveText(STRINGS.ar.notStated);
  await expect(page.locator('[data-tf-src-publisher]')).toHaveText(STRINGS.ar.notStated);
  await expect(page.locator('[data-tf-src-provider]')).toHaveText('Quran Foundation');
  // RQ-005 v1.1 AC26 (D-146, D-147): without a matching fingerprint there is no review line at all.
  await expect(page.locator('[data-tf-review]')).toHaveCount(0);
  await expect(page.locator('[data-tf-status]')).not.toContainText('D-012');
  // The same on the English interface (RQ-007).
  await page.goto('/en/tafseer/2/#a21');
  await ready(page);
  await expect(page.locator('[data-tf-source]')).toHaveCount(1);
  await expect(page.locator('[data-tf-review]')).toHaveCount(0);
  await expect(page.locator('[data-tf-status]')).not.toContainText('not been reviewed');
  await expect(page.locator('[data-tafseer-dev]')).toHaveText(STRINGS.en.tafseerDevNote);
});

test('AC3: a passage covering several ayat states its range, and stays the same inside it', async ({ page, seen }) => {
  await page.goto(`/en/tafseer/2/#a${CASE.grouped[0]}`);
  await ready(page);
  const range = page.locator('[data-tf-range]');
  await expect(range).toHaveText(`This passage covers surah 2, ayat ${CASE.grouped[0]} to ${CASE.grouped[2]}.`);
  const text = await page.locator('[data-tf-text]').textContent();
  await page.locator('[data-tf-next]').click();
  await expect(page.locator('[data-tf-view], [data-tf-ayah]').first()).toHaveAttribute('data-tf-ayah', `2:${CASE.grouped[1]}`);
  await expect(range).toHaveText(`This passage covers surah 2, ayat ${CASE.grouped[0]} to ${CASE.grouped[2]}.`);
  await expect(page.locator('[data-tf-text]')).toHaveText(text ?? '');
  expect(seen.filter((s) => s.url.endsWith('/api/tafseer')).length).toBe(1);
});

test('AC9, AC10, AC18: no passage and API failure messages; back returns to the same ayah; reading works', async ({ page }) => {
  await page.goto(`/tafseer/2/#a${CASE.none}`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="none"]')).toHaveText(STRINGS.ar.tafseerNone);
  await expect(page.locator('[data-tf-text]')).toHaveCount(0);
  await page.locator('[data-tf-next]').click();
  await expect(page.locator('[data-tf-msg="unavailable"]')).toBeVisible();
  await expect(page.locator('[data-tf-text]')).toHaveCount(0);
  const bytes = utf8(await shown(page).locator('p.ayah').textContent() ?? '');
  expect(bytes.equals(sliceOf(2, CASE.error500)), 'Quran text still shown').toBe(true);
  // Opened from the reader at ayah 7, so Back to reading returns to 2:7.
  await page.goto('/2/#a7');
  await hydrated(page);
  await page.locator('li#a7 a[data-tf-link]').click();
  await ready(page);
  await page.locator('[data-tf-next]').click();
  await expect(page.locator('a[data-back]')).toHaveAttribute('href', '/2/#a7');
  await page.locator('a[data-back]').click();
  await expect(page).toHaveURL(/\/2\/#a7$/);
  await expect(page.locator('li#a7')).toBeInViewport();
  await page.goto(`/tafseer/2/#a${CASE.rate429}`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="unavailable"]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/2\/#a7$/);
});

test('AC17: next and previous follow source order across surahs, with no skip or repeat', async ({ page }) => {
  await page.goto('/tafseer/1/#a1');
  await ready(page);
  await expect(page.locator('[data-tf-prev]')).toHaveCount(0);
  const visited: string[] = [];
  for (let i = 0; i < 9; i++) {
    visited.push(await page.locator('[data-tf-ayah]').getAttribute('data-tf-ayah') ?? '');
    const ref = await shown(page).locator('p.ayah').getAttribute('data-r');
    expect(ref).toBe(visited[visited.length - 1]);
    await page.locator('[data-tf-next]').click();
    // Across the surah edge the next page now opens in place (RQ-006 v1.3), with no navigation for
    // the test to wait on: wait for the shown ayah to change.
    await expect(page.locator('[data-tf-ayah]')).not.toHaveAttribute('data-tf-ayah', visited[visited.length - 1]);
    await ready(page);
  }
  const n1 = src.list.filter((x) => x.sora === 1).length;
  const want = [...Array.from({ length: n1 }, (_, i) => `1:${i + 1}`), '2:1', '2:2'].slice(0, 9);
  expect(visited).toEqual(want);
  await page.goto('/tafseer/2/#a1');
  await ready(page);
  await page.locator('[data-tf-prev]').click();
  await expect(page).toHaveURL(new RegExp(`/tafseer/1/#a${n1}`));
  await ready(page);
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', `1:${n1}`);
});

test('AC19: switching language keeps the ayah; Quran and Tafseer text keep their direction and bytes', async ({ page }) => {
  await page.goto('/tafseer/2/#a22');
  await ready(page);
  await page.locator('#lang-switch').click();
  await expect(page).toHaveURL(/\/en\/tafseer\/2\/#a22/);
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('region', { name: 'Quran text' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tafseer' })).toBeVisible();
  expect(utf8(await shown(page).locator('p.ayah').textContent() ?? '').equals(sliceOf(2, 22))).toBe(true);
  await expect(shown(page).locator('p.ayah')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-tf-text]')).toHaveAttribute('dir', 'rtl');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  expect(sw).toBe(true);
});

test('AC20: text size and night mode change both sections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/tafseer/2/#a23');
  await ready(page);
  const sizes = () => page.evaluate(() => [getComputedStyle(document.querySelector('.tf-row:not([hidden]) p.ayah')!).fontSize, getComputedStyle(document.querySelector('[data-tf-text]')!).fontSize]);
  const before = await sizes();
  await page.locator('[data-larger]').click();
  const after = await sizes();
  expect(parseFloat(after[0])).toBeGreaterThan(parseFloat(before[0]));
  expect(parseFloat(after[1])).toBeGreaterThan(parseFloat(before[1]));
  await page.locator('[data-night]').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const colors = await page.evaluate(() => [getComputedStyle(document.querySelector('[data-tf-text]')!).color, getComputedStyle(document.body).backgroundColor]);
  // D-102 dark palette: text #E9F0EC on background #0E1714.
  expect(colors).toEqual(['rgb(233, 240, 236)', 'rgb(14, 23, 20)']);
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', '2:23');
});

test('AC21: keyboard reaches every control with visible focus; the reference gets focus after a move', async ({ page }) => {
  await page.goto('/en/tafseer/2/#a24');
  await ready(page);
  const names: string[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return { n: e.getAttribute('aria-label') || e.textContent?.trim() || '', o: getComputedStyle(e).outlineStyle }; });
    if (f.n) { names.push(f.n); expect(f.o, f.n).not.toBe('none'); }
    if (f.n === 'Next ayah') break;
  }
  for (const want of ['Back to reading', 'Tafseer source details', 'Previous ayah', 'Next ayah']) expect(names).toContain(want);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', '2:25');
  const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-tf-ref') && document.activeElement.closest('.tf-row')?.getAttribute('data-a'));
  expect(focused).toBe('25');
  await expect(page.locator('[aria-live="polite"]').filter({ has: page.locator('[data-tf-text]') })).toHaveCount(1);
});

test('AC23: hostile markup runs no script and loads nothing; the words still match', async ({ page, seen }) => {
  await page.goto(`/tafseer/2/#a${CASE.hostile}`);
  await ready(page);
  const el = page.locator('[data-tf-text]');
  await expect(el).toContainText('MOCK HOSTILE');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  for (const tag of ['script', 'img', 'iframe', 'svg', 'a', 'style', '[style]', '[onclick]']) await expect(el.locator(tag)).toHaveCount(0);
  await expect(el.locator('b')).toHaveText('bold');
  expect(seen.some((s) => s.url.includes('example.invalid'))).toBe(false);
  const want = visibleText(sanitize(passageText(MOCK_TAFSIR_ID, 2, CASE.hostile)!));
  expect(await el.evaluate((x) => x.textContent)).toBe(want);
});

test('D-079: a passage changed since review shows the notice; a matching one says so', async ({ page }) => {
  await page.goto(`/en/tafseer/2/#a${CASE.changed}`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="changed"]')).toContainText('updated since it was reviewed on 2026-11-02');
  await expect(page.locator('[data-tf-text]')).toHaveCount(0);
  await page.locator('[data-tf-next]').click();
  await ready(page);
  await expect(page.locator('[data-tf-review]')).toHaveText('This text matches the text reviewed on 2026-11-01.');
});

test('AC14: no passage from the API is in the build output', async () => {
  const hits: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { if (n.startsWith('.wrangler') || n.startsWith('test-results') || n === 'reports') continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (readFileSync(p).includes('MOCK PASSAGE')) hits.push(p); } };
  walk(BUILD);
  expect(hits).toEqual([]);
});

// ----- D-149 bracket display (RQ-005 v1.1 AC29 to AC37; D-153 C; D-156 A) -----
// The mock's quote cases hold phrases cut by program from the source at run time. The expected
// class of each phrase comes from the same check run here on the same source (AC31).
const QIX = indexFromSource(src.list);
const D084 = [CASE.quoteExact, CASE.quoteAltered, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.quoteUnmatched, CASE.braces, CASE.tooShort, CASE.wasla, CASE.apiAlef];
const expected = (a: number) => computeMarks(QIX, passageText(MOCK_TAFSIR_ID, 2, a, src)!, { s: 2, from: a, to: a }, true);
const BR = new RegExp(`[(){}${OPEN}${CLOSE}]`, 'g');
const NAMES: Record<string, string> = { O: 'own', A: 'other', P: 'plain' };

test('TB-01 (AC29, AC30, AC31, AC4): each phrase gets the class the check gives, and only its brackets change', async ({ page, request }) => {
  for (const a of D084) {
    const want = expected(a);
    const d = await (await request.post('/api/tafseer', { data: { s: 2, a } })).json();
    expect(d.marks, `2:${a} marks from the Worker`).toEqual(want);
    expect(Buffer.from(d.text, 'utf8').equals(Buffer.from(passageText(MOCK_TAFSIR_ID, 2, a, src)!, 'utf8')), 'AC4').toBe(true);
    await page.goto(`/tafseer/2/#a${a}`);
    await ready(page);
    const el = page.locator('[data-tf-text]');
    await expect(el).toHaveAttribute('data-tf-marked', '1');
    const got = await el.locator('[data-tfq]').evaluateAll((xs) => xs.map((x) => (x as HTMLElement).dataset.tfq));
    expect(got, `2:${a}`).toEqual([...want.c].filter((c) => c !== 'N').map((c) => NAMES[c]));
    // AC30: with the bracket marks of both texts removed, the words are byte-identical.
    const shown = (await el.evaluate((x) => x.textContent)) ?? '';
    const delivered = visibleText(sanitize(d.text));
    expect(shown.length).toBe(delivered.length);
    expect(utf8(shown.replace(BR, '')).equals(utf8(delivered.replace(BR, '')))).toBe(true);
    // Brackets: { } for own ayah, ( ) for the rest.
    for (const s of await el.locator('[data-tfq]').all()) {
      const k = await s.getAttribute('data-tfq');
      const tx = (await s.textContent()) ?? '';
      expect([tx[0], tx[tx.length - 1]].join(''), `2:${a} ${k}`).toBe(k === 'own' ? '{}' : '()');
    }
  }
});

test('TB-02 (AC33, AC34, AC35, D-153 C): colours in light and dark mode with contrast; font and brackets tell styles apart; quotations with no added words', async ({ page }) => {
  await page.goto(`/tafseer/2/#a${CASE.braces}`);
  await ready(page);
  const look = () => page.evaluate(() => {
    const css = (sel: string) => { const e = document.querySelector<HTMLElement>(sel); return e ? { color: getComputedStyle(e).color, font: getComputedStyle(e).fontFamily, bg: getComputedStyle(e.closest('.tf-section') ?? document.body).backgroundColor } : null; };
    return { own: css('[data-tfq="own"]'), plain: css('[data-tfq="plain"]'), text: css('[data-tf-text]') };
  });
  const lum = (rgb: string) => { const v = rgb.match(/\d+/g)!.slice(0, 3).map(Number).map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  let l = await look();
  expect(l.own!.color).toBe('rgb(23, 77, 60)'); // #174D3C
  expect(l.own!.font).toContain('Noto Naskh Arabic');
  expect(l.plain!.font).toBe(l.text!.font);
  expect(l.plain!.color).toBe(l.text!.color);
  expect(ratio(l.own!.color, l.own!.bg)).toBeGreaterThanOrEqual(4.5);
  // Other-ayah style, light and dark.
  await page.goto(`/tafseer/2/#a${CASE.quoteElsewhere}`);
  await ready(page);
  const other = () => page.evaluate(() => { const e = document.querySelector<HTMLElement>('[data-tfq="other"]')!; return { color: getComputedStyle(e).color, font: getComputedStyle(e).fontFamily, bg: getComputedStyle(e.closest('.tf-section')!).backgroundColor, page: getComputedStyle(document.body).backgroundColor }; });
  let o = await other();
  expect(o.color).toBe('rgb(122, 90, 30)'); // #7A5A1E
  expect(o.font).toContain('Noto Naskh Arabic');
  expect(ratio(o.color, o.bg)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(o.color, o.page)).toBeGreaterThanOrEqual(4.5);
  await page.locator('[data-night]').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  o = await other();
  expect(o.color).toBe('rgb(217, 174, 110)'); // #D9AE6E
  expect(ratio(o.color, o.bg)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(o.color, o.page)).toBeGreaterThanOrEqual(4.5);
  await page.goto(`/tafseer/2/#a${CASE.quoteExact}`);
  await ready(page);
  l = await look();
  expect(l.own!.color).toBe('rgb(124, 201, 172)'); // #7CC9AC
  expect(ratio(l.own!.color, l.own!.bg)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', `2:${CASE.quoteExact}`);
  // D-153 C: own and other ayah phrases are q elements; nothing is added to the text, and the q
  // shows no quotation marks of its own.
  const q = page.locator('[data-tfq="own"] q');
  await expect(q).toHaveCount(1);
  expect(await q.evaluate((e) => [getComputedStyle(e, '::before').content, getComputedStyle(e, '::after').content])).toEqual(['none', 'none']);
  const words = await page.locator('[data-tf-text]').evaluate((e) => (e as HTMLElement).innerText);
  expect(words.replace(BR, '').replace(/\s+/g, ' ').trim()).toBe(visibleText(sanitize(passageText(MOCK_TAFSIR_ID, 2, CASE.quoteExact, src)!)).replace(BR, '').replace(/\s+/g, ' ').trim());
  await expect(page.locator('[data-tf-text] [aria-label], [data-tf-text] [aria-hidden], [data-tf-text] .sr-only')).toHaveCount(0);
  // AC34 in forced colours: the brackets and the font stay.
  await page.emulateMedia({ forcedColors: 'active' });
  const fc = await page.evaluate(() => { const e = document.querySelector<HTMLElement>('[data-tfq="own"]')!; return { font: getComputedStyle(e).fontFamily, text: e.textContent ?? '' }; });
  expect(fc.font).toContain('Noto Naskh Arabic');
  expect(fc.text.startsWith('{') && fc.text.endsWith('}')).toBe(true);
});

test('TB-03 (AC36): at 390 px and the largest text size, styled phrases grow with the text, stay inline and nothing overflows', async ({ page }) => {
  // The size buttons are in the header at desktop width (as in AC20); the check is then at 390 px.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/tafseer/2/#a${CASE.braces}`);
  await ready(page);
  const size = () => page.evaluate(() => [getComputedStyle(document.querySelector('[data-tfq="own"]')!).fontSize, getComputedStyle(document.querySelector('[data-tf-text]')!).fontSize].map(parseFloat));
  const before = await size();
  for (let i = 0; i < 6; i++) { const b = page.locator('[data-larger]'); if (await b.isDisabled()) break; await b.click(); }
  await expect(page.locator('[data-larger]')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  const after = await size();
  expect(after[0]).toBeGreaterThan(before[0]);
  expect(after[0] / after[1]).toBeCloseTo(before[0] / before[1], 2);
  const box = await page.evaluate(() => {
    const e = document.querySelector<HTMLElement>('[data-tfq="own"]')!;
    return { display: getComputedStyle(e).display, sw: document.documentElement.scrollWidth, iw: innerWidth, overflow: e.closest<HTMLElement>('[data-tf-text]')!.scrollWidth - e.closest<HTMLElement>('[data-tf-text]')!.clientWidth };
  });
  expect(box.display).toBe('inline');
  expect(box.sw).toBeLessThanOrEqual(box.iw + 1);
  expect(box.overflow).toBeLessThanOrEqual(1);
});

test('TB-04 (AC37): missing, broken, wrong-version or wrong-count marks show the passage exactly as delivered, with no message', async ({ page }) => {
  const breakers: ((m: Record<string, unknown>) => unknown)[] = [() => undefined, () => 'OOP', (m) => ({ ...m, v: 9 }), (m) => ({ ...m, n: (m.n as number) + 1 }), (m) => ({ ...m, c: 'Z'.repeat(m.n as number) })];
  for (const [i, f] of breakers.entries()) {
    await page.route('**/api/tafseer', async (route) => {
      const r = await route.fetch();
      const d = await r.json();
      const m = f(d.marks);
      if (m === undefined) delete d.marks; else d.marks = m;
      await route.fulfill({ response: r, body: JSON.stringify(d) });
    });
    await page.goto(`/tafseer/2/#a${CASE.braces}`);
    await ready(page);
    const el = page.locator('[data-tf-text]');
    await expect(el, `case ${i}`).toHaveAttribute('data-tf-marked', '0');
    await expect(el.locator('[data-tfq]')).toHaveCount(0);
    expect(await el.evaluate((x) => x.textContent)).toBe(visibleText(sanitize(passageText(MOCK_TAFSIR_ID, 2, CASE.braces, src)!)));
    await expect(page.locator('[data-tf-msg]')).toHaveCount(0);
    await page.unroute('**/api/tafseer');
  }
});

test('TB-05 (D-157): no static file of the build holds the letters-only matching data; the Worker data module does', async () => {
  const p = probesFrom(src.list);
  const site = scanFolder(join(BUILD, 'site'), p);
  expect(site.files).toBeGreaterThan(100);
  expect(site.hits).toEqual([]);
  // Positive control: the scan finds the data where it is meant to be, in the Worker's own data
  // module (kit v32: worker-data.bin, letters as UTF-16 code units; read as UTF-16 for the scan).
  expect(hitsIn(readFileSync(join(BUILD, 'worker-data.bin')).toString('utf16le'), p)).toBeGreaterThan(1000);
  expect(hitsIn(readFileSync(join(BUILD, 'worker-config.json'), 'utf8'), p)).toBe(0);
});

test('TB-06 (AC4, AC30): every pre-live passage on screen equals the delivered text except for swapped bracket marks, character by character', async ({ page, request }) => {
  test.setTimeout(600_000);
  const brackets = new Set(['(', ')', '{', '}', OPEN, CLOSE]);
  let pages = 0, styled = 0, swapped = 0;
  const done = new Set<string>();
  for (const a of src.list.filter((x) => x.sora <= 2)) {
    const d = await (await request.post('/api/tafseer', { data: { s: a.sora, a: a.aya_no } })).json();
    if (d.status !== 'ok') continue;
    const key = `${d.range.s}:${d.range.from}-${d.range.to}`;
    if (done.has(key)) continue;
    done.add(key);
    expect(Buffer.from(d.text, 'utf8').equals(Buffer.from(passageText(MOCK_TAFSIR_ID, a.sora, a.aya_no, src)!, 'utf8')), 'AC4: the text field is what the API gave').toBe(true);
    const delivered = visibleText(sanitize(d.text));
    const m = markedNodes(d.text, d.marks);
    const want = m ? markedText(m.nodes) : delivered;
    await page.goto(`/tafseer/${a.sora}/#a${a.aya_no}`);
    await ready(page);
    const shown = (await page.locator('[data-tf-text]').evaluate((x) => x.textContent)) ?? '';
    expect(utf8(shown).equals(utf8(want)), `${a.sora}:${a.aya_no} shown as computed from the delivered text`).toBe(true);
    // Strip the styling: position by position, the only differences are bracket marks.
    expect(shown.length).toBe(delivered.length);
    for (let i = 0; i < shown.length; i++) {
      if (shown[i] === delivered[i]) continue;
      expect(brackets.has(shown[i]) && brackets.has(delivered[i]), `${a.sora}:${a.aya_no} position ${i}`).toBe(true);
      swapped++;
    }
    styled += await page.locator('[data-tf-text] [data-tfq]').count();
    pages++;
  }
  test.info().annotations.push({ type: 'tb-06', description: `${pages} passages, ${styled} styled phrases, ${swapped} bracket marks swapped` });
  expect(pages).toBeGreaterThan(280);
  expect(styled).toBeGreaterThan(5);
});
