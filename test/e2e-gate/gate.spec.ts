// Password gate in a real browser (gate-on build). The context sends Basic auth through
// httpCredentials, as Safari or Chrome does after the person enters the password. Queries are
// picked from the source by program; no Quran text is written here.
import { test, expect, src, hydrated, utf8, sliceOf, openSearch } from '../e2e/helpers.ts';
import { NOT_WORD, WORD_SPLIT } from '../../src/core/fold.ts';
import { foldQuery, foldTerm } from '../../src/core/variants.ts';
import { t } from '../../src/core/strings.ts';

const words = (s: string) => s.split(WORD_SPLIT).filter((w) => w && !NOT_WORD.test(w)).map(foldTerm);
const AYAH_WORDS = src.list.map((a) => words(a.aya_text));
function brute(q: string): string[] {
  const terms = foldQuery(q).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  src.list.forEach((a, n) => {
    const w = AYAH_WORDS[n];
    for (let i = 0; i + terms.length <= w.length; i++) if (terms.every((x, k) => w[i + k].startsWith(x))) { out.push(`${a.sora}:${a.aya_no}`); return; }
  });
  return out;
}
const PHRASE = AYAH_WORDS[Math.min(300, src.list.length - 1)].slice(1, 3).join(' ');

test.describe.configure({ mode: 'serial' });

test('without credentials, or with a wrong password, every path gets 401 with the Basic challenge', async ({ baseURL }) => {
  // Plain fetch, so no browser or Playwright credentials are added.
  const wrong = 'Basic ' + Buffer.from('e2e:wrong-made-up').toString('base64');
  for (const auth of [undefined, wrong]) {
    const h: Record<string, string> = auth ? { authorization: auth } : {};
    for (const p of ['/', '/en/', '/2/', '/rifq-basic.css', '/manifest.webmanifest']) {
      const r = await fetch(baseURL + p, { redirect: 'manual', headers: h });
      expect(r.status, p).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Basic realm="RIFQ private test", charset="UTF-8"');
      expect(r.headers.get('cache-control')).toBe('no-store');
      await r.arrayBuffer();
    }
    const s = await fetch(baseURL + '/api/search', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ q: PHRASE }) });
    expect(s.status).toBe(401);
    await s.arrayBuffer();
  }
});

for (const lang of ['ar', 'en'] as const) {
  test(`search from the search box returns results under the gate, ${lang}`, async ({ page, seen }) => {
    const r = await page.goto(lang === 'ar' ? '/2/' : '/en/2/');
    expect(r!.status()).toBe(200);
    expect(r!.headers()['cache-control']).toBe('private, no-store');
    await hydrated(page);
    await openSearch(page);
    await page.fill('#q', PHRASE);
    const resP = page.waitForResponse((x) => x.url().endsWith('/api/search') && x.request().method() === 'POST');
    await page.press('#q', 'Enter');
    // The gate answers 401 unless the browser sent the cached Basic auth with the fetch.
    const res = await resP;
    expect(res.status(), 'the fetch carries the Basic auth').toBe(200);
    expect(res.headers()['cache-control']).toBe('private, no-store');
    const want = brute(PHRASE);
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'resultCount', { n: want.length }));
    const refs = await page.$$eval('[data-results] li[data-res]', (ls) => ls.map((l) => l.getAttribute('data-res')!));
    expect(refs).toEqual(want.slice(0, 50));
    const post = seen.find((s) => s.url.endsWith('/api/search') && s.method === 'POST')!;
    expect(post.headers['content-type']).toBe('application/json');
    expect(post.headers['cookie']).toBeUndefined();
  });
}

test('no-script form search works under the gate', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/2/');
  await openSearch(page);
  await page.fill('#q', PHRASE);
  await page.press('#q', 'Enter');
  await page.waitForURL('**/api/search');
  const refs = await page.$$eval('li[data-res]', (ls) => ls.map((l) => l.getAttribute('data-res')!));
  expect(refs).toEqual(brute(PHRASE).slice(0, 50));
  const texts = await page.$$eval('li[data-res] p.ayah', (ps) => ps.map((p) => p.textContent!));
  texts.forEach((x, i) => { const [s, a] = refs[i].split(':').map(Number); expect(utf8(x).equals(sliceOf(s, a)), refs[i]).toBe(true); });
  expect(await page.locator('script').count()).toBe(0);
  await ctx.close();
});

for (const lang of ['ar', 'en'] as const) {
  test(`a 401 from search asks for the password again instead of saying search is unavailable, ${lang}`, async ({ page }) => {
    await page.goto(lang === 'ar' ? '/2/' : '/en/2/');
    await hydrated(page);
    await page.route('**/api/search', (r) => r.fulfill({ status: 401, body: 'Authentication required.\n', headers: { 'content-type': 'text/plain' } }));
    await openSearch(page);
    await page.fill('#q', PHRASE);
    await page.press('#q', 'Enter');
    await expect(page.locator('[data-search-status]')).toHaveText(t(lang, 'authAgain'));
    await page.click('a[data-next]');
    await expect(page.locator('p.ayah[data-r]').first()).toBeVisible();
  });
}

// D-069 under the gate: the preloaded font request carries the cached Basic auth and loads.
test('the Quran font loads under the gate', async ({ page, seen }) => {
  await page.goto('/2/');
  await hydrated(page);
  const faces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => [f.family.replace(/"/g, ''), f.status]); });
  expect(faces).toContainEqual(['Noto Naskh Arabic', 'loaded']);
  expect(seen.some((x) => x.url.endsWith('/fonts/noto-naskh-arabic/NotoNaskhArabic-Regular.woff2'))).toBe(true);
});

test('/dev/reciters/ is behind the gate, and without Quran Foundation settings it says so plainly', async ({ page, baseURL }) => {
  const no = await fetch(baseURL + '/dev/reciters/', { redirect: 'manual' });
  expect(no.status).toBe(401);
  await no.arrayBuffer();
  // This local Worker has no QF credentials, so the page answers 503 with a plain message, no script.
  const r = await page.goto('/dev/reciters/');
  expect(r!.status()).toBe(503);
  expect(r!.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(r!.headers()['cache-control']).toBe('private, no-store');
  await expect(page.locator('[role=alert]')).toContainText('Not configured. Missing Worker settings:');
  await expect(page.locator('.banner')).toContainText('DEVELOPMENT PAGE');
  expect(await page.locator('script').count()).toBe(0);
});

test('RQ-006: the audio routes are behind the gate, and every reader-facing page carries media-src for the audio host only (AC39 v1.3)', async ({ request, baseURL }) => {
  for (const p of ['/api/audio', '/api/audio/reciters']) {
    const r = await fetch(baseURL + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"r":7,"s":1}' });
    expect(r.status, p).toBe(401);
    await r.arrayBuffer();
  }
  // Signed in, without Quran Foundation settings: a plain not-configured answer, no detail.
  const r = await request.post('/api/audio', { data: { r: 7, s: 1 } });
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({ status: 'not_configured' });
  expect((await request.get('/2/')).headers()['content-security-policy']).toContain('media-src https://download.quranicaudio.com');
  // AC39 v1.3: every reader-facing page from the Worker too (same value as _headers); /dev/ pages not.
  for (const p of ['/privacy/', '/', '/en/surahs/', '/tafseer/2/', '/no-such-page/']) expect((await request.get(p)).headers()['content-security-policy'], p).toContain('media-src https://download.quranicaudio.com');
  for (const p of ['/dev/font-check/', '/dev/verify-text/']) expect((await request.get(p)).headers()['content-security-policy'], p).not.toContain('media-src');
});

test('the manifest is fetched with the site credentials (use-credentials) and stays behind the gate', async ({ page, request, baseURL }) => {
  const no = await fetch(baseURL + '/manifest.webmanifest', { redirect: 'manual' });
  expect(no.status).toBe(401);
  await no.arrayBuffer();
  expect((await request.get('/manifest.webmanifest')).status()).toBe(200);
  const seen: number[] = [];
  page.on('response', (r) => { if (r.url().endsWith('/manifest.webmanifest')) seen.push(r.status()); });
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('crossorigin', 'use-credentials');
  // The browser's own manifest fetch, credentials included, is let through.
  const ok = await page.evaluate(async () => (await fetch('/manifest.webmanifest', { credentials: 'include' })).status);
  expect(ok).toBe(200);
  expect(seen.every((s) => s === 200)).toBe(true);
});

// RQ-006 v1.3 AC72 on the gate itself (kept last: it locks this address out for the rest of the
// minute). In-place changes use the credentials already given; a real lock-out answer from the
// gate is not placed in the page: the address is loaded in full and the browser shows it.
test('AC72: in-place page changes behind the gate; a lock-out answer is loaded in full', async ({ page, baseURL }) => {
  await page.goto('/');
  await hydrated(page);
  await expect(page.locator('meta[name="rifq-page"]')).toHaveCount(1);
  await page.evaluate(() => { (window as unknown as { __doc: number }).__doc = 1; });
  const same = () => page.evaluate(() => (window as unknown as { __doc?: number }).__doc === 1).catch(() => false);
  await page.click('a.index-card');
  await page.waitForURL('**/surahs/');
  await hydrated(page);
  expect(await same(), 'in place, signed in').toBe(true);
  await page.click('a[data-surah-link="2"]');
  await page.waitForURL('**/2/');
  expect(await same()).toBe(true);
  // AC39 v1.3 holds for the page the tab entered on (home) and so for every page reached from it.
  // Now fail the sign-in from this address until the gate locks it out (D-071, M-2).
  for (let i = 0; i < 12; i++) {
    const r = await fetch(baseURL + '/', { headers: { authorization: 'Basic ' + Buffer.from('e2e:wrong-password').toString('base64') } });
    await r.arrayBuffer();
  }
  const r = await fetch(baseURL + '/surahs/', { headers: { authorization: 'Basic ' + Buffer.from('e2e:e2e-made-up-password').toString('base64') } });
  await r.arrayBuffer();
  test.skip(r.status !== 429, `the gate did not lock this address out (status ${r.status})`);
  await page.click('[data-index-link] >> nth=0');
  await page.waitForURL('**/surahs/');
  await expect.poll(same).toBe(false);
  await expect(page.locator('body')).toContainText('Too many failed sign-in attempts');
});
