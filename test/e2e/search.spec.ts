// RQ-002 browser tests against the local build. Queries are picked from the source by program at
// run time (never typed by hand), and expected results come from a brute-force scan of the source.
// This is a dry run: QUERY-100 and the D-027 variant list do not exist yet.
import { test, expect, src, surahs, N, MOBILE, STRICT, hydrated, noOverflow, utf8, sliceOf, NET4G } from './helpers.ts';
import { foldPlaceholder, NOT_WORD, WORD_SPLIT } from '../../src/core/fold.ts';
import { t } from '../../src/core/strings.ts';
import type { Page } from '@playwright/test';

const words = (s: string) => s.split(WORD_SPLIT).filter((w) => w && !NOT_WORD.test(w)).map(foldPlaceholder);
const AYAH_WORDS = src.list.map((a) => words(a.aya_text));
function brute(q: string): string[] {
  const terms = foldPlaceholder(q).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  src.list.forEach((a, n) => {
    const w = AYAH_WORDS[n];
    for (let i = 0; i + terms.length <= w.length; i++) if (terms.every((x, k) => w[i + k].startsWith(x))) { out.push(`${a.sora}:${a.aya_no}`); return; }
  });
  return out;
}
// A whole word found in 120 to 300 ayat (for paging), and a 2-word phrase from one ayah.
const freq = new Map<string, Set<number>>();
AYAH_WORDS.forEach((w, n) => w.forEach((x) => (freq.get(x) ?? freq.set(x, new Set()).get(x)!).add(n)));
const COMMON = [...freq].filter(([, v]) => v.size >= 120 && v.size <= 300).map(([k]) => k).sort()[0];
const PHRASE = AYAH_WORDS[Math.min(300, src.list.length - 1)].slice(1, 3).join(' ');
const NOMATCH = String.fromCodePoint(0x638, 0x638, 0x638, 0x638, 0x638, 0x638);
const MARKER = String.fromCodePoint(0x636, 0x638, 0x63a, 0x636, 0x638, 0x63a);

// Waits for this search's own answer: the island's finished-search counter must move on.
async function searchUi(page: Page, q: string) {
  const st = page.locator('[data-search-status]');
  const before = Number(await st.getAttribute('data-seq'));
  await page.fill('#q', q);
  await page.press('#q', 'Enter');
  await expect(st).not.toHaveAttribute('data-seq', String(before));
}
const uiRefs = (page: Page) => page.$$eval('[data-results] li[data-res]', (ls) => ls.map((l) => l.getAttribute('data-res')!));

test.describe.configure({ mode: 'serial' });

test('picked queries are valid for this source', () => {
  expect(COMMON).toBeTruthy();
  expect(brute(COMMON).length).toBeGreaterThan(50);
  expect(brute(PHRASE).length).toBeGreaterThan(0);
  expect(brute(NOMATCH).length).toBe(0);
  expect(brute(MARKER).length).toBe(0);
});

test('prototype fix: a search sent before the island loads works, by POST, with no query in the URL', async ({ browser }) => {
  // Own context: island scripts are blocked on purpose here, so hydration errors are expected.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), headers: r.headers() }));
  await page.route('**/_astro/**', (r) => (r.request().url().endsWith('.js') ? r.abort() : r.continue()));
  await page.goto('/2/');
  await page.fill('#q', PHRASE);
  await page.press('#q', 'Enter');
  await page.waitForURL('**/api/search');
  const post = seen.find((s) => s.url.endsWith('/api/search'))!;
  expect(post.method).toBe('POST');
  expect(new URL(post.url).search).toBe('');
  expect(post.headers['content-type']).toContain('application/x-www-form-urlencoded');
  const refs = await page.$$eval('li[data-res]', (ls) => ls.map((l) => l.getAttribute('data-res')!));
  expect(refs).toEqual(brute(PHRASE).slice(0, 50));
  const texts = await page.$$eval('li[data-res] p.ayah', (ps) => ps.map((p) => p.textContent!));
  texts.forEach((x, i) => { const [s, a] = refs[i].split(':').map(Number); expect(utf8(x).equals(sliceOf(s, a)), refs[i]).toBe(true); });
  await expect(page.locator('.banner')).toHaveText(t('ar', 'devBanner'));
  expect(await page.locator('script').count()).toBe(0);
  for (const x of seen) expect(new URL(x.url).hostname).toBe('127.0.0.1');
  await ctx.close();
});

test('prototype fix: text typed before the island loads is kept and then searched by fetch', async ({ page, seen }) => {
  await page.route('**/_astro/Search.*.js', async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue(); });
  await page.goto('/en/2/');
  await page.fill('#q', PHRASE);
  await page.waitForFunction(() => ![...document.querySelectorAll('astro-island[ssr]')].some((i) => i.getAttribute('component-url')?.includes('Search')), null, { timeout: 15_000 });
  await expect(page.locator('#q')).toHaveValue(PHRASE);
  await page.press('#q', 'Enter');
  await expect(page.locator('[data-search-status]')).toHaveText(t('en', 'resultCount', { n: brute(PHRASE).length }));
  const post = seen.find((s) => s.url.endsWith('/api/search'))!;
  expect(post.headers['content-type']).toBe('application/json');
});

test('TP2-04, TP2-06, TP2-12: results open the exact ayah; highlighted text equals the source bytes', async ({ page, browser }) => {
  test.setTimeout(Number(process.env.T04 ?? 600_000));
  await page.goto('/');
  await hydrated(page);
  for (const q of [PHRASE, COMMON]) {
    await searchUi(page, q);
    const refs = await uiRefs(page);
    expect(refs).toEqual(brute(q).slice(0, 50));
    const rows = await page.$$eval('[data-results] li', (ls) => ls.map((l) => ({ ref: l.getAttribute('data-res')!, text: l.querySelector('p.ayah')!.textContent!, marks: l.querySelectorAll('mark').length, nameEl: l.querySelector('a span[lang=ar]')!.textContent! })));
    for (const r of rows) {
      const [s, a] = r.ref.split(':').map(Number);
      expect(utf8(r.text).equals(sliceOf(s, a)), r.ref).toBe(true);
      expect(r.marks).toBeGreaterThan(0);
      expect(r.nameEl).toBe(surahs[s - 1].ar);
    }
  }
  const refs = await uiRefs(page);
  // A new context for each result: 50 searches in one tab within a minute would correctly hit the
  // 30-per-minute browser counter (RQ-002 AC8), which is tested separately in TP2-18.
  for (const ref of refs.slice(0, 50)) {
    const [s, a] = ref.split(':').map(Number);
    const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:8812' });
    const p = await ctx.newPage();
    await p.goto('/');
    await hydrated(p);
    await searchUi(p, COMMON);
    await p.click(`[data-results] li[data-res="${ref}"] a`);
    await expect(p).toHaveURL(new RegExp(`/${s}/#a${a}$`));
    await expect(p.locator(`#a${a}`)).toBeInViewport();
    await ctx.close();
  }
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP2-05: tap a result at mobile width opens the exact ayah in view, ${lang}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    await searchUi(page, PHRASE);
    const ref = (await uiRefs(page))[0];
    const [s, a] = ref.split(':').map(Number);
    await page.locator(`[data-results] li[data-res="${ref}"] a`).tap();
    await expect(page).toHaveURL(new RegExp(`${lang === 'ar' ? '' : '/en'}/${s}/#a${a}$`));
    await expect(page.locator(`#a${a}`)).toBeInViewport();
    await ctx.close();
  });
}

for (const [lang, vp] of [['ar', null], ['en', null], ['ar', MOBILE], ['en', MOBILE]] as const) {
  test(`TP2-14, TP2-15: no-match message in the interface language, ${lang}${vp ? ' mobile' : ''}`, async ({ page }) => {
    if (vp) await page.setViewportSize(vp);
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    await searchUi(page, NOMATCH);
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'noResults'));
    expect(await page.locator('[data-results] li, [data-offer]').count()).toBe(0);
    await noOverflow(page);
  });
}

for (const lang of ['ar', 'en'] as const) {
  test(`TP2-16: search failure shows a clear error and reading stays available, ${lang}`, async ({ page }) => {
    await page.goto(lang === 'ar' ? '/2/' : '/en/2/');
    await hydrated(page);
    await page.route('**/api/search', (r) => r.fulfill({ status: 500, body: 'x' }));
    await searchUi(page, PHRASE);
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'searchError'));
    await page.unroute('**/api/search');
    await page.route('**/api/search', (r) => r.abort());
    await searchUi(page, COMMON);
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'searchError'));
    await page.click('a[data-next]');
    await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[2].items.length);
  });
}

test('TP2-17: the same query twice gives the same order, which is Mushaf order', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await searchUi(page, COMMON);
  const a = await uiRefs(page);
  await searchUi(page, PHRASE);
  await searchUi(page, COMMON);
  const b = await uiRefs(page);
  expect(a).toEqual(b);
  const pos = a.map((r) => src.list.findIndex((x) => `${x.sora}:${x.aya_no}` === r));
  expect(pos).toEqual([...pos].sort((x, y) => x - y));
});

for (const [lang, vp] of [['ar', null], ['en', MOBILE]] as const) {
  test(`TP2-18, TP2-19: browser counter: 30 searches pass, the next shows a wait message, reading continues, ${lang}`, async ({ page, seen }) => {
    if (vp) await page.setViewportSize(vp);
    await page.goto(lang === 'ar' ? '/2/' : '/en/2/');
    await hydrated(page);
    for (let i = 0; i < 30; i++) {
      await page.fill('#q', i % 2 ? PHRASE : COMMON);
      await page.press('#q', 'Enter');
      await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'resultCount', { n: brute(i % 2 ? PHRASE : COMMON).length }));
    }
    await page.fill('#q', PHRASE);
    await page.press('#q', 'Enter');
    await expect(page.locator('[data-search-status]')).toHaveText(new RegExp(t(lang, 'rateLimited', { s: 'XX' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('XX', '\\d+')));
    expect(seen.filter((s) => s.url.endsWith('/api/search')).length).toBe(30);
    await noOverflow(page);
    await page.click('a[data-next]');
    await expect(page.locator('p.ayah[data-r]')).toHaveCount(surahs[2].items.length);
  });
}

test('TP2-18 server backstop: the 31st direct request in a minute gets 429 with Retry-After', async ({ request }) => {
  const codes: number[] = [];
  for (let i = 0; i < 31; i++) codes.push((await request.post(`${STRICT}/api/search`, { data: { q: PHRASE } })).status());
  expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
  expect(codes[30]).toBe(429);
  const r = await request.post(`${STRICT}/api/search`, { data: { q: PHRASE } });
  expect(r.headers()['retry-after']).toBe('60');
  expect((await request.get(`${STRICT}/2/`)).status()).toBe(200);
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP2-22: the search input has a label in the interface language, ${lang}`, async ({ page }) => {
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await expect(page.getByLabel(t(lang, 'searchLabel'))).toHaveAttribute('id', 'q');
    await expect(page.locator('#q')).toHaveAttribute('dir', 'rtl');
  });
}

test('TP2-23 (browser part), TP2-24: query goes only in a POST body, with no identifier, and is not kept in the browser', async ({ page, seen }) => {
  await page.goto('/');
  await hydrated(page);
  await searchUi(page, MARKER);
  const posts = seen.filter((s) => s.url.includes('/api/search'));
  expect(posts.length).toBe(1);
  const p = posts[0];
  expect(p.method).toBe('POST');
  expect(new URL(p.url).search).toBe('');
  expect(Object.keys(JSON.parse(p.body!)).sort()).toEqual(['page', 'q']);
  expect(p.headers.cookie).toBeUndefined();
  expect(p.headers.referer ?? '', 'no referrer sent').toBe('');
  for (const s of seen) expect(decodeURIComponent(s.url)).not.toContain(MARKER);
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, performance.getEntries().map((e) => e.name), location.href, document.cookie]));
  expect(kept).not.toContain(MARKER);
  expect(decodeURIComponent(kept)).not.toContain(MARKER);
  await expect(page.locator('#q')).toHaveAttribute('autocomplete', 'off');
});

test('TP2-26: while a search is loading, a loading state shows and older results are not shown as new', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await searchUi(page, COMMON);
  await page.route('**/api/search', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
  await page.fill('#q', PHRASE);
  await page.press('#q', 'Enter');
  await expect(page.locator('[data-search-status]')).toHaveText(t('ar', 'searching'));
  expect(await page.locator('[data-results] li').count()).toBe(0);
  await expect(page.locator('[data-search-status]')).toHaveText(t('ar', 'resultCount', { n: brute(PHRASE).length }));
});

test('TP2-27 (dry run): whole word and start of word match; inside-word matches are not returned', async ({ request }) => {
  const word = [...freq].filter(([k, v]) => [...k].length >= 5 && v.size >= 3).map(([k]) => k).sort()[0];
  const start = [...word].slice(0, 3).join('');
  const inside = [...word].slice(2).join('');
  for (const q of [word, start, inside]) {
    const d = await (await request.post('/api/search', { data: { q } })).json();
    expect(d.total, q === inside ? 'inside' : 'whole/start').toBe(brute(q).length);
  }
  const insideHits = brute(inside);
  const wordHits = new Set(brute(word));
  // An ayah found only because the word contains the inner part must not be returned.
  for (const r of wordHits) {
    const n = src.list.findIndex((x) => `${x.sora}:${x.aya_no}` === r);
    if (!AYAH_WORDS[n].some((w) => w.startsWith(foldPlaceholder(inside)))) expect(insideHits).not.toContain(r);
  }
});

test('TP2-28: every surah name in Arabic is offered (API), and offers open the exact place (UI)', async ({ page, request }) => {
  for (const s of surahs) {
    const d = await (await request.post('/api/search', { data: { q: s.ar } })).json();
    expect(d.offers.some((o: any) => o.kind === 'surah' && o.s === s.n), `surah ${s.n}`).toBe(true);
    const bare = foldPlaceholder(s.ar);
    const d2 = await (await request.post('/api/search', { data: { q: bare } })).json();
    expect(d2.offers.some((o: any) => o.kind === 'surah' && o.s === s.n), `surah ${s.n} without marks`).toBe(true);
  }
  const ar = (x: string) => x.replace(/\d/g, (c) => String.fromCodePoint(0x660 + Number(c)));
  const last = surahs[1].items.length;
  for (const lang of ['ar', 'en'] as const) for (const q of [`2:${last}`, ar(`2:${last}`)]) {
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    await searchUi(page, q);
    expect(await page.locator('.msg.alert').count()).toBe(0);
    await page.click(`[data-offer="2:${last}"]`);
    await expect(page).toHaveURL(new RegExp(`/2/#a${last}$`));
    await expect(page.locator(`#a${last}`)).toBeInViewport();
  }
  await page.goto('/');
  await hydrated(page);
  await searchUi(page, surahs[1].ar);
  await page.click('[data-offer="2"]');
  await expect(page).toHaveURL(/\/2\/$/);
});

for (const lang of ['ar', 'en'] as const) {
  test(`TP2-29: a reference that does not exist offers nothing and opens nothing, ${lang}`, async ({ page }) => {
    const ar = (x: string) => x.replace(/\d/g, (c) => String.fromCodePoint(0x660 + Number(c)));
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    for (const q of [`${N + 1}`, ar(`${N + 1}:1`), `2:${surahs[1].items.length + 1}`, '0']) {
      await searchUi(page, q);
      await expect(page.locator('[data-ref-missing]')).toHaveText(t(lang, 'refMissing'));
      expect(await page.locator('[data-offer]').count()).toBe(0);
    }
  });
}

for (const [lang, vp] of [['ar', null], ['en', null], ['ar', MOBILE]] as const) {
  test(`TP2-30, TP2-31: Latin letters show the Arabic-only message; Arabic with Latin digits does not, ${lang}${vp ? ' mobile' : ''}`, async ({ page, seen }) => {
    if (vp) await page.setViewportSize(vp);
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    for (const q of ['mercy', surahs[1].en, '2:a']) {
      await searchUi(page, q);
      await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'latinOnly'));
      expect(await page.locator('[data-results] li, [data-offer]').count()).toBe(0);
    }
    expect(seen.filter((s) => s.url.endsWith('/api/search')).length, 'refused before sending').toBe(0);
    await searchUi(page, PHRASE.split(' ')[0] + ' 12');
    await expect(page.locator('[data-search-status]')).not.toHaveText(t(lang, 'latinOnly'));
    await noOverflow(page);
  });
}

test('TP2-32: 100 characters accepted, 101 shows the limit, and the server also refuses 101', async ({ page, seen, request }) => {
  const letters = AYAH_WORDS.flat().join(' ');
  const q100 = [...letters].slice(0, 100).join('').trim().padEnd(100, String.fromCodePoint(0x628));
  const q101 = q100 + String.fromCodePoint(0x628);
  expect([...q100].length).toBe(100);
  for (const lang of ['ar', 'en'] as const) {
    await page.goto(lang === 'ar' ? '/' : '/en/');
    await hydrated(page);
    await page.fill('#q', q100);
    await expect(page.locator('[data-count]')).toHaveText(t(lang, 'charCount', { n: 100 }));
    await page.press('#q', 'Enter');
    await expect(page.locator('[data-search-status]')).not.toHaveText(t(lang, 'tooLong', { n: 100 }));
    const before = seen.filter((s) => s.url.endsWith('/api/search')).length;
    await page.fill('#q', q101);
    await expect(page.locator('[data-count]')).toHaveText(t(lang, 'tooLong', { n: 101 }));
    await page.press('#q', 'Enter');
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'tooLong', { n: 101 }));
    expect(seen.filter((s) => s.url.endsWith('/api/search')).length).toBe(before);
  }
  expect((await request.post('/api/search', { data: { q: q101 } })).status()).toBe(400);
});

for (const vp of [null, MOBILE]) {
  test(`TP2-33, TP2-34: paging shows at most 50 per page; all pages equal the expected set in order${vp ? ', mobile' : ''}`, async ({ page }) => {
    if (vp) await page.setViewportSize(vp);
    await page.goto('/');
    await hydrated(page);
    await searchUi(page, COMMON);
    const want = brute(COMMON);
    const all: string[] = [];
    for (let p = 1; ; p++) {
      const refs = await uiRefs(page);
      expect(refs.length).toBeLessThanOrEqual(50);
      all.push(...refs);
      await expect(page.locator('[data-page-label]')).toHaveText(t('ar', 'resultsPage', { p, n: Math.ceil(want.length / 50) }));
      await noOverflow(page);
      const next = page.locator('[data-next-page]');
      if (await next.isDisabled()) break;
      await next.click();
      await expect(page.locator('[data-page-label]')).toHaveText(t('ar', 'resultsPage', { p: p + 1, n: Math.ceil(want.length / 50) }));
    }
    expect(all).toEqual(want);
  });
}

test('TP2-36: script and injection payloads run nothing and change nothing', async ({ page, request }) => {
  await page.goto('/');
  await hydrated(page);
  const B = String.fromCodePoint(0x628, 0x628);
  for (const q of ['<img src=x onerror=alert(1)>', `${B}"><svg/onload=alert(1)>`, `${B} '"<>&;--`, `${B} \${alert(1)}`]) {
    await searchUi(page, q);
    expect(await page.locator('img[src=x], svg[onload]').count()).toBe(0);
  }
  const r = await request.post('/api/search', { form: { q: `${B}"><script>alert(1)</script>`, lang: 'ar' } });
  expect(await r.text()).not.toContain('<script>alert');
  const r2 = await request.post('/api/search', { data: '{"q":' });
  expect(r2.status()).toBe(400);
});

test('TP2-37 (measured, placeholder profile): submit to results with 4x CPU and placeholder 4G', async ({ browser }) => {
  const out: Record<string, number[]> = {};
  for (const [name, q] of [['common-50-rows', COMMON], ['phrase', PHRASE], ['no-match', NOMATCH]] as const) {
    out[name] = [];
    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.goto('/2/');
      await hydrated(page);
      await cdp.send('Network.emulateNetworkConditions', NET4G);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.fill('#q', q);
      const t0 = await page.evaluate(() => performance.now());
      await page.press('#q', 'Enter');
      await page.waitForFunction(() => { const s = document.querySelector('[data-search-status]')?.textContent ?? ''; return s && !s.endsWith('…'); });
      const t1 = await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
      out[name].push(Math.round(t1 - t0));
      await ctx.close();
    }
  }
  test.info().annotations.push({ type: 'timing-ms', description: JSON.stringify(out) });
  for (const v of Object.values(out)) expect(Math.max(...v)).toBeLessThan(2000);
});
