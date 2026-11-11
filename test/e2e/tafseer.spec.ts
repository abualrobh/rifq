// RQ-005 Tafseer screen against the mock Quran Foundation API (127.0.0.1:8815, Worker only).
// The build must be made with --gate off and --fingerprints set to the e2e store made by
// test/mock/make-e2e-fingerprints.ts. Expected Quran bytes come from the source at run time;
// expected passages come from the mock's made-up text. No Tafseer is in this file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD, expect, sliceOf, src, test, utf8, hydrated } from './helpers.ts';
import { CASE, MOCK_CLIENT_SECRET, MOCK_TAFSIR_ID, passageText } from '../mock/qf-mock.ts';
import { visibleText, sanitize } from '../../src/core/tafseer-html.ts';
import { STRINGS } from '../../src/core/strings.ts';

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
  await expect(page.locator('[data-tf-review]')).toHaveAttribute('data-tf-review', 'none');
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
