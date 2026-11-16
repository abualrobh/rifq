// RQ-007 v1.1 English Tafseer (kit v34) against the mock Quran Foundation API (127.0.0.1:8815,
// Worker only; TAFSIR_EN_ID 169 is the mock's made-up English work). The English passages are the
// mock's made-up "MOCK EN" test text, not Tafseer; any Arabic in them is cut by program from the
// source at run time. Expected values come from the source and the mock; no Tafseer is in this file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD, expect, hydrated, MOBILE, sliceOf, src, STRICT, test, utf8 } from './helpers.ts';
import { CASE, CLOSE, EN_CASE, enPassageText, MOCK_EN_ID, MOCK_TAFSIR_ID, OPEN, passageText } from '../mock/qf-mock.ts';
import { sanitize, visibleText } from '../../src/core/tafseer-html.ts';
import { STRINGS } from '../../src/core/strings.ts';
import { findPhrases, hasArabicLetters, indexFromSource } from '../../src/core/tafseer-quotes.ts';
import { computeMarks, markedNodes, markedText } from '../../src/core/tafseer-marks.ts';

const EN = STRINGS.en, AR = STRINGS.ar;
const shown = (page: import('@playwright/test').Page) => page.locator('.tf-row:not([hidden])');
async function ready(page: import('@playwright/test').Page) {
  await hydrated(page);
  await expect(page.locator('[data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
}
const en = (a: number, s = 2) => enPassageText(s, a, src)!;
const QIX = indexFromSource(src.list);
const BR = new RegExp(`[(){}${OPEN}${CLOSE}]`, 'g');
const NAMES: Record<string, string> = { O: 'own', A: 'other', P: 'plain' };
const EN_QUOTES = [CASE.quoteExact, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.quoteUnmatched, CASE.braces, CASE.tooShort, EN_CASE.mix, EN_CASE.mixed, EN_CASE.paragraphs];

test('EN-01 (AC1, AC6, AC7, AC12, AC19, AC23): one tap in the English reader opens the English passage, LTR, with the note; only RIFQ is called', async ({ page, seen }) => {
  await page.goto('/en/2/#a20');
  await hydrated(page);
  await page.locator('li#a20 a[data-tf-link]').click();
  await expect(page).toHaveURL(/\/en\/tafseer\/2\/#a20/);
  await ready(page);
  await expect(page.getByRole('region', { name: EN.quranSection })).toBeVisible();
  await expect(page.getByRole('region', { name: EN.tafseerSection })).toBeVisible();
  await expect(shown(page).locator('[data-tf-ref]')).toContainText('20');
  // AC6: the Quran section is the D-011 text, byte for byte, right to left.
  expect(utf8(await shown(page).locator('p.ayah').textContent() ?? '').equals(sliceOf(2, 20))).toBe(true);
  await expect(shown(page).locator('p.ayah')).toHaveAttribute('dir', 'rtl');
  const el = page.locator('[data-tf-text]');
  await expect(el).toHaveAttribute('lang', 'en');
  await expect(el).toHaveAttribute('dir', 'ltr');
  expect(await el.evaluate((x) => x.textContent)).toBe(visibleText(sanitize(en(20))));
  // AC7: the note, outside the passage.
  await expect(page.locator('[data-tf-en-note]')).toHaveText(EN.tafseerEnNote);
  expect(await page.locator('[data-tf-en-note]').evaluate((n) => !!n.closest('[data-tf-text]'))).toBe(false);
  // AC10: nothing of the Arabic work here.
  await expect(page.locator('main')).not.toContainText(`for tafsir ${MOCK_TAFSIR_ID}`);
  for (const s of seen) expect(new URL(s.url).port, 'only RIFQ is called').toBe('8812');
  const api = seen.filter((s) => s.url.endsWith('/api/tafseer'));
  expect(api.map((x) => x.body)).toEqual(['{"s":2,"a":20,"l":"en"}']);
  expect(Object.keys(api[0].headers).includes('cookie')).toBe(false);
});

test('EN-02 (AC2): the Arabic interface is unchanged: Arabic passage, no English note, control or text', async ({ page, seen }) => {
  await page.goto('/tafseer/2/#a20');
  await ready(page);
  const el = page.locator('[data-tf-text]');
  await expect(el).toHaveAttribute('dir', 'rtl');
  expect(await el.evaluate((x) => x.textContent)).toBe(visibleText(sanitize(passageText(MOCK_TAFSIR_ID, 2, 20)!)));
  await expect(page.locator('[data-tf-en-note], [data-tf-src-translator], [data-ar-run]')).toHaveCount(0);
  const body = await page.locator('main').innerText();
  for (const x of [EN.tafseerEnNote, 'MOCK EN', EN.tfTranslator, EN.tfAbridgement, AR.tafseerEnNote]) expect(body.includes(x), x).toBe(false);
  expect(seen.filter((s) => s.url.endsWith('/api/tafseer')).map((x) => x.body)).toEqual(['{"s":2,"a":20}']);
});

test('EN-03 (AC3): switching the interface language keeps the ayah and shows that interface\'s work', async ({ page }) => {
  await page.goto('/en/tafseer/2/#a22');
  await ready(page);
  await expect(page.locator('[data-tf-text]')).toContainText('MOCK EN PASSAGE 2:22');
  await page.locator('#lang-switch').click();
  await expect(page).toHaveURL(/\/tafseer\/2\/#a22/);
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', '2:22');
  await expect(page.locator('[data-tf-text]')).toContainText(`MOCK PASSAGE 2:22 for tafsir ${MOCK_TAFSIR_ID}`);
  await page.locator('#lang-switch').click();
  await expect(page).toHaveURL(/\/en\/tafseer\/2\/#a22/);
  await ready(page);
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', '2:22');
  await expect(page.locator('[data-tf-text]')).toContainText('MOCK EN PASSAGE 2:22');
});

test('EN-04 (AC4, AC10, AC16): every pre-live ayah of the English work is delivered byte for byte, with no review field', async ({ request }) => {
  let n = 0;
  for (const a of src.list.filter((x) => x.sora <= 2)) {
    const d = await (await request.post('/api/tafseer', { data: { s: a.sora, a: a.aya_no, l: 'en' } })).json();
    const want = enPassageText(a.sora, a.aya_no, src);
    if (want === null) { expect(d).toEqual({ status: 'none', lang: 'en', s: a.sora, a: a.aya_no }); continue; }
    if (a.sora === 2 && [CASE.error500, CASE.rate429, CASE.slow].includes(a.aya_no as never)) { expect(d.status).toBe('unavailable'); continue; }
    expect(d.status, `${a.sora}:${a.aya_no}`).toBe('ok');
    expect(d.source.tafsirId).toBe(MOCK_EN_ID);
    expect('review' in d).toBe(false);
    expect(Buffer.from(d.text, 'utf8').equals(Buffer.from(want, 'utf8')), `${a.sora}:${a.aya_no}`).toBe(true);
    n++;
  }
  expect(n).toBeGreaterThan(280);
});

test('EN-05 (AC5, AC13): the English range, next and previous with no skip or repeat, and back to the reader', async ({ page, seen }) => {
  await page.goto('/en/2/#a2');
  await hydrated(page);
  await page.locator('li#a2 a[data-tf-link]').click();
  await ready(page);
  const visited: string[] = [];
  for (let i = 0; i < 5; i++) {
    visited.push(await page.locator('[data-tf-ayah]').getAttribute('data-tf-ayah') ?? '');
    await page.locator('[data-tf-next]').click();
    await ready(page);
  }
  expect(visited).toEqual(['2:2', '2:3', '2:4', '2:5', '2:6']);
  // Now at 2:7; back three ayat to 2:4, inside the grouped passage.
  for (let i = 0; i < 3; i++) { await page.locator('[data-tf-prev]').click(); await ready(page); }
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', `2:${CASE.grouped[1]}`);
  await expect(page.locator('[data-tf-range]')).toHaveText(`This passage covers surah 2, ayat ${CASE.grouped[0]} to ${CASE.grouped[2]}.`);
  // The grouped passage was asked for once (AC3 as in RQ-005).
  const grouped = seen.filter((s) => s.url.endsWith('/api/tafseer') && /"a":[345],/.test(s.body ?? ''));
  expect(grouped.length).toBe(1);
  await expect(page.locator('a[data-back]')).toHaveAttribute('href', '/en/2/#a2');
  await page.locator('a[data-back]').click();
  await expect(page).toHaveURL(/\/en\/2\/#a2$/);
});

test('EN-06 (AC11, AC12): no passage and API failure messages in English; Quran text and reading keep working', async ({ page }) => {
  await page.goto(`/en/tafseer/2/#a${CASE.none}`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="none"]')).toHaveText(EN.tafseerNone);
  await expect(page.locator('[data-tf-text], [data-tf-en-note]')).toHaveCount(0);
  await page.locator('[data-tf-next]').click();
  await expect(page.locator('[data-tf-msg="unavailable"]')).toHaveText(EN.tafseerUnavailable);
  await expect(page.locator('[data-tf-text]')).toHaveCount(0);
  expect(utf8(await shown(page).locator('p.ayah').textContent() ?? '').equals(sliceOf(2, CASE.error500))).toBe(true);
  await page.goto(`/en/tafseer/2/#a${CASE.rate429}`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="unavailable"]')).toBeVisible();
  // The Arabic interface keeps working for an ayah the English work answers.
  await page.goto('/tafseer/2/#a21');
  await ready(page);
  await expect(page.locator('[data-tf-text]')).toContainText(`MOCK PASSAGE 2:21 for tafsir ${MOCK_TAFSIR_ID}`);
});

test('EN-07 (AC14, AC15, AC16): source details with Translator, Abridgement, Original work and English; credit; no review line', async ({ page }) => {
  await page.goto('/en/tafseer/2/#a21');
  await ready(page);
  await page.locator('[data-tf-source] summary').click();
  await expect(page.locator('[data-tf-src-title]')).toHaveText('Mock English Tafsir (abridged, made up)');
  await expect(page.locator('[data-tf-src-author]')).toHaveText('Mock English Author');
  for (const k of ['edition', 'publisher', 'translator', 'abridgement', 'original']) await expect(page.locator(`[data-tf-src-${k}]`), k).toHaveText(EN.notStated);
  await expect(page.locator('[data-tf-src-language]')).toHaveText(EN.langEnglish);
  await expect(page.locator('[data-tf-src-id]')).toHaveText(String(MOCK_EN_ID));
  await expect(page.locator('[data-tf-src-provider]')).toHaveText('Quran Foundation');
  const labels = await page.locator('[data-tf-source] dt').allTextContents();
  for (const l of [EN.tfTranslator, EN.tfAbridgement, EN.tfOriginal]) expect(labels).toContain(l);
  await expect(page.locator('[data-tf-credit]')).toHaveText(EN.tafseerCredit);
  await expect(page.locator('[data-tf-review]')).toHaveCount(0);
  const body = await page.locator('main').innerText();
  expect(/reviewed|review/i.test(body.replace(EN.tafseerDevNote, ''))).toBe(false);
});

test('EN-08 (AC8): with no English work set, development builds say so in English; the Arabic page is unchanged', async ({ page }) => {
  await page.goto(`${STRICT}/en/tafseer/2/#a20`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="not_configured"]')).toHaveText(EN.tafseerEnNotConfigured);
  await page.goto(`${STRICT}/tafseer/2/#a20`);
  await ready(page);
  await expect(page.locator('[data-tf-msg="not_configured"]')).toContainText(AR.tafseerNotConfigured.slice(0, 10));
  expect(utf8(await shown(page).locator('p.ayah').textContent() ?? '').equals(sliceOf(2, 20))).toBe(true);
});

test('EN-09 (AC20, AC33, AC34, AC35, AC37, P-11): Arabic runs marked Arabic; Arabic-letter phrases styled as in Arabic; English phrases as delivered', async ({ page, request }) => {
  let styled = 0, runs = 0, left = 0;
  for (const a of EN_QUOTES) {
    const d = await (await request.post('/api/tafseer', { data: { s: 2, a, l: 'en' } })).json();
    const want = computeMarks(QIX, en(a), { s: 2, from: a, to: a }, false);
    expect(d.marks, `2:${a} marks`).toEqual(want);
    await page.goto(`/en/tafseer/2/#a${a}`);
    await ready(page);
    const el = page.locator('[data-tf-text]');
    await expect(el).toHaveAttribute('data-tf-marked', '1');
    // AC37: each displayed phrase has the class the check gives.
    const got = await el.locator('[data-tfq]').evaluateAll((xs) => xs.map((x) => (x as HTMLElement).dataset.tfq));
    expect(got, `2:${a}`).toEqual([...want.c].filter((c) => c !== 'N').map((c) => NAMES[c]));
    styled += got.length;
    // AC35: the words are byte-identical with the bracket marks removed; the text shown is the
    // text computed from the delivered passage.
    const text = (await el.evaluate((x) => x.textContent)) ?? '';
    const delivered = visibleText(sanitize(en(a)));
    expect(utf8(text).equals(utf8(markedText(markedNodes(en(a), want)!.nodes)))).toBe(true);
    expect(utf8(text.replace(BR, '')).equals(utf8(delivered.replace(BR, '')))).toBe(true);
    // AC34: phrases with no Arabic letters keep their own brackets and are not styled.
    for (const p of findPhrases(en(a))) if (!hasArabicLetters(p.text) && !p.unclosed) { const br = p.bracket === '()' ? ['(', ')'] : p.bracket === '{}' ? ['{', '}'] : [OPEN, CLOSE]; expect(text.includes(br[0] + p.text + br[1]), `2:${a} "${p.text}"`).toBe(true); left++; }
    // AC20: every Arabic letter on screen sits in an element marked lang="ar"; nothing else does.
    const lang = await el.evaluate((root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let bad = 0, inAr = 0, latinInAr = 0;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.textContent ?? '';
        const l = (n.parentElement!.closest('[lang]') as HTMLElement).lang;
        if (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t.replace(/[\uFD3E\uFD3F]/g, '')) && l !== 'ar') bad++;
        if (l === 'ar') { inAr++; if (/[A-Za-z]/.test(t) && !n.parentElement!.closest('.tfq')) latinInAr++; }
      }
      return { bad, inAr, latinInAr, runs: root.querySelectorAll('[data-ar-run]').length };
    });
    expect(lang.bad, `2:${a} Arabic outside lang="ar"`).toBe(0);
    expect(lang.latinInAr, `2:${a} Latin inside a run`).toBe(0);
    runs += lang.runs;
    // Styled own/other phrases: Quran font, own language and direction, a q element; their
    // brackets show on screen as RTL (the opening mark at the right).
    for (const s of await el.locator('[data-tfq="own"], [data-tfq="other"]').all()) {
      await expect(s).toHaveAttribute('lang', 'ar');
      await expect(s).toHaveAttribute('dir', 'rtl');
      await expect(s.locator('q')).toHaveCount(1);
      const geo = await s.evaluate((e) => {
        const t = e.firstChild!, last = e.lastChild!;
        const r1 = document.createRange(); r1.setStart(t, 0); r1.setEnd(t, 1);
        const r2 = document.createRange(); r2.setStart(last, (last.textContent ?? '').length - 1); r2.setEnd(last, (last.textContent ?? '').length);
        return { open: r1.getBoundingClientRect().left, close: r2.getBoundingClientRect().left, font: getComputedStyle(e).fontFamily, dir: getComputedStyle(e).direction };
      });
      expect(geo.dir).toBe('rtl');
      expect(geo.open, `2:${a}: opening mark to the right`).toBeGreaterThan(geo.close);
      expect(geo.font).toContain('Noto Naskh Arabic');
    }
    // AC20: the English text and its plain phrases use Tajawal.
    expect(await el.evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Tajawal');
    for (const s of await el.locator('[data-tfq="plain"]').all()) expect(await s.evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Tajawal');
  }
  expect(styled).toBeGreaterThanOrEqual(6);
  expect(runs).toBeGreaterThanOrEqual(3);
  expect(left).toBeGreaterThanOrEqual(7);
  test.info().annotations.push({ type: 'en-09', description: `${styled} styled phrases, ${runs} Arabic runs, ${left} English-only phrases left as delivered` });
});

test('EN-10 (AC21, AC36): text size, night mode and 390 px with English passages and styled phrases', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/en/tafseer/2/#a${CASE.braces}`);
  await ready(page);
  const size = () => page.evaluate(() => [getComputedStyle(document.querySelector('[data-tf-text]')!).fontSize, getComputedStyle(document.querySelector('[data-tfq="own"]')!).fontSize].map(parseFloat));
  const before = await size();
  for (let i = 0; i < 6; i++) { const b = page.locator('[data-larger]'); if (await b.isDisabled()) break; await b.click(); }
  const after = await size();
  expect(after[0]).toBeGreaterThan(before[0]);
  expect(after[1] / after[0]).toBeCloseTo(before[1] / before[0], 2);
  await page.locator('[data-night]').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const c = await page.evaluate(() => ({ text: getComputedStyle(document.querySelector('[data-tf-text]')!).color, own: getComputedStyle(document.querySelector('[data-tfq="own"]')!).color, note: getComputedStyle(document.querySelector('[data-tf-en-note]')!).color, bg: getComputedStyle(document.querySelector('.tf-tafseer')!).backgroundColor }));
  expect(c.text).toBe('rgb(233, 240, 236)');
  expect(c.own).toBe('rgb(124, 201, 172)'); // #7CC9AC
  const lum = (rgb: string) => { const v = rgb.match(/\d+/g)!.slice(0, 3).map(Number).map((x) => { const y = x / 255; return y <= 0.03928 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const k of ['text', 'own', 'note'] as const) expect(ratio(c[k], c.bg), k).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', `2:${CASE.braces}`);
  await page.setViewportSize(MOBILE);
  for (const a of [CASE.braces, EN_CASE.mix, EN_CASE.paragraphs]) {
    await page.goto(`/en/tafseer/2/#a${a}`);
    await ready(page);
    const box = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, over: (() => { const e = document.querySelector<HTMLElement>('[data-tf-text]')!; return e.scrollWidth - e.clientWidth; })() }));
    expect(box.sw, `2:${a}`).toBeLessThanOrEqual(box.iw + 1);
    expect(box.over, `2:${a}`).toBeLessThanOrEqual(1);
  }
});

test('EN-11 (AC22): keyboard reaches every control with visible focus; note and passage are in the live region; quotations add no words', async ({ page }) => {
  await page.goto(`/en/tafseer/2/#a${CASE.quoteExact}`);
  await ready(page);
  const names: string[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return { n: e.getAttribute('aria-label') || e.textContent?.trim() || '', o: getComputedStyle(e).outlineStyle }; });
    if (f.n) { names.push(f.n); expect(f.o, f.n).not.toBe('none'); }
    if (f.n === EN.nextAyah) break;
  }
  for (const want of [EN.backToReading, EN.tafseerSourceDetails, EN.prevAyah, EN.nextAyah]) expect(names).toContain(want);
  const live = page.locator('[aria-live="polite"]');
  await expect(live.locator('[data-tf-en-note]')).toHaveCount(1);
  await expect(live.locator('[data-tf-text][lang="en"]')).toHaveCount(1);
  await expect(page.locator('[data-tf-text] [aria-label], [data-tf-text] [aria-hidden], [data-tf-text] .sr-only')).toHaveCount(0);
  await expect(page.locator('[data-tfq="own"] q')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-tf-ayah]')).toHaveAttribute('data-tf-ayah', `2:${CASE.quoteExact + 1}`);
});

test('EN-12 (AC28): hostile markup in an English passage runs no script and loads nothing; the words still match', async ({ page, seen }) => {
  await page.goto(`/en/tafseer/2/#a${CASE.hostile}`);
  await ready(page);
  const el = page.locator('[data-tf-text]');
  await expect(el).toContainText('MOCK HOSTILE');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  for (const tag of ['script', 'img', 'iframe', 'svg', 'a', 'style', '[style]', '[onclick]']) await expect(el.locator(tag)).toHaveCount(0);
  expect(seen.some((s) => s.url.includes('example.invalid'))).toBe(false);
  expect(await el.evaluate((x) => x.textContent)).toBe(visibleText(sanitize(en(CASE.hostile))));
});

test('EN-13 (AC30): with JavaScript off, the English Tafseer page shows the no-script message', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/en/tafseer/2/#a20');
  // The Tafseer section only (the page's Quran text is never printed by a failing check).
  const tf = await page.locator('[data-tf-tafseer]').evaluate((e) => ({ text: e.textContent ?? '', ns: e.querySelector('noscript')?.textContent ?? '' }));
  expect(tf.ns.includes(EN.tafseerNoScript) || tf.text.includes(EN.tafseerNoScript), JSON.stringify(tf)).toBe(true);
  await ctx.close();
});

test('EN-14 (AC24): no English mock passage is in the build output', async () => {
  const hits: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { if (n.startsWith('.wrangler') || n.startsWith('test-results') || n === 'reports') continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (readFileSync(p).includes('MOCK EN')) hits.push(p); } };
  walk(BUILD);
  expect(hits).toEqual([]);
});

// Waits for the start of a new minute so all 61 requests fall in one limiter window (as TP2-18).
test('EN-15 (AC27): Arabic and English Tafseer requests share one limit of 60 a minute; the 61st is refused', async ({ request }) => {
  test.setTimeout(180_000);
  const win = () => Math.floor(Date.now() / 60_000);
  await new Promise((x) => setTimeout(x, 60_000 - (Date.now() % 60_000) + 500));
  const start = win();
  const codes: number[] = [];
  for (let i = 0; i < 61; i++) codes.push((await request.post(`${STRICT}/api/tafseer`, { data: i % 2 ? { s: 2, a: 20, l: 'en' } : { s: 2, a: 20 } })).status());
  expect(win(), 'all 61 requests inside one limiter window').toBe(start);
  // The strict Worker has no Quran Foundation settings: allowed requests answer "not configured".
  expect(codes.slice(0, 60).every((c) => c === 503)).toBe(true);
  expect(codes[60]).toBe(429);
  const r = await request.post(`${STRICT}/api/tafseer`, { data: { s: 2, a: 20, l: 'en' } });
  expect(r.status()).toBe(429);
});
