// Kit v43 (part 2): RQ-009 v0.3 page reading mode (D-286, D-280 A, D-281 A, D-282 A, D-283 B, D-284 A),
// in the browser, against the local Worker and the mock Quran Foundation API. Expected ayat come from
// the source named by RIFQ_RECORD (its `page` field); no Quran text and no Arabic characters are in
// this file (the page keyword comes from strings.ts, Arabic-Indic digits from code points).
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect, src, surahs, hydrated, ROOT_200, rootFontPx, sliceOf } from './helpers.ts';
import { t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';
import { audioState, serveAudio, STEP } from './audio-helpers.ts';

test.use({ allowHosts: [AUDIO_HOST] });

const LANGS: Lang[] = ['ar', 'en'];
const home = (l: Lang) => (l === 'ar' ? '/' : '/en/');
const PG = (l: Lang, p: number) => `${home(l)}page/${p}/`;
const n = (s: number) => surahs[s - 1].items.length;
// The file's page of every ayah, and each page's references in Quran order.
const refsOn = (p: number) => src.list.filter((x) => (x as { page?: number }).page === p).map((x) => `${x.sora}:${x.aya_no}`);
const pageOfRef = (s: number, a: number) => (src.list.find((x) => x.sora === s && x.aya_no === a) as { page?: number }).page!;
const SAMPLE = [1, 2, 3, 42, 48, 49, 50, 106, 121, 187, 440, 502, 552, 585, 595, 601, 602, 603, 604];
// Both values seen: the reader tips and the page tip (only the tip test leaves the page tip unseen).
const BOTH_TIPS = () => { try { localStorage.setItem('rifq.tips', '1p'); } catch { /* blocked */ } };
const VIEW_PAGES = () => { try { const v = JSON.parse(localStorage.getItem('rifq.settings') ?? '{}'); if (!localStorage.getItem('__v43seeded')) { localStorage.setItem('rifq.settings', JSON.stringify({ ...v, view: 'pages' })); localStorage.setItem('__v43seeded', '1'); } } catch { /* blocked */ } };
const card = (page: Page) => page.locator('[data-mushaf-card]');
const keep = (page: Page) => page.evaluate(() => { (window as unknown as { __keep: number }).__keep = 43; });
const kept = (page: Page) => page.evaluate(() => (window as unknown as { __keep?: number }).__keep === 43);
const onPage = (page: Page, p: number) => expect(page.locator('[data-mushaf]')).toHaveAttribute('data-mushaf', String(p));

async function ctxFor(browser: Browser, w = 390, h = 844, extra: { scale?: number; text200?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; errs: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: extra.scale ?? 1, hasTouch: true, baseURL: 'http://127.0.0.1:8812' });
  await ctx.addInitScript(BOTH_TIPS);
  if (extra.text200) await ctx.addInitScript(ROOT_200);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  return { ctx, page, errs };
}
async function swipe(page: Page, x0: number, y0: number, x1: number, y1: number, fingers = 1) {
  const c = await page.context().newCDPSession(page);
  const pts = (x: number, y: number) => Array.from({ length: fingers }, (_, i) => ({ x: x + i * 30, y: y + i * 30, id: i }));
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(x0, y0) });
  for (let i = 1; i <= 5; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(x0 + ((x1 - x0) * i) / 5, y0 + ((y1 - y0) * i) / 5) });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await c.detach();
}

for (const lang of LANGS) {
  test(`P43-01 (AC6, AC7, AC108, AC109): sample pages hold exactly the file's ayat for that page, in order, with the scroll reader's text; ${lang}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(BOTH_TIPS);
    for (const p of SAMPLE) {
      await page.goto(PG(lang, p));
      await hydrated(page);
      const got = await page.locator('[data-mushaf-card] p.ayah[data-r]').evaluateAll((els) => els.map((e) => ({ r: e.getAttribute('data-r')!, t: e.textContent ?? '' })));
      expect(got.map((g) => g.r), `page ${p}`).toEqual(refsOn(p));
      for (const g of got) { const [s, a] = g.r.split(':').map(Number); expect(Buffer.from(g.t, 'utf8').equals(sliceOf(s, a)), `${p} ${g.r}`).toBe(true); }
      await expect(page.locator('h1[data-mushaf-h]')).toHaveText(t(lang, 'mushafPageName', { p }));
      await expect(page.locator('[data-page-dev]')).toHaveText(t(lang, 'pageNumberDev'));
      // AC8: a title block before each surah's first ayah on the page.
      const starts = refsOn(p).filter((r) => r.endsWith(':1')).map((r) => r.split(':')[0]);
      expect(await page.locator('h2[data-mp-title]').evaluateAll((e) => e.map((x) => x.getAttribute('data-mp-title')))).toEqual(starts);
    }
  });

  test(`P43-02 (AC110): between ayat there is one space; copying whole ayat gives their texts joined by spaces; marks add no text; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.goto(PG(lang, 50));
    await hydrated(page);
    const refs = refsOn(50);
    const exp = refs.map((r) => { const [s, a] = r.split(':').map(Number); return sliceOf(s, a).toString('utf8'); }).join(' ');
    const sel = await page.evaluate(() => { const ol = document.querySelector('ol.mp-flow')!; const r = document.createRange(); r.selectNodeContents(ol); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); return { text: ol.textContent, sel: s.toString() }; });
    expect(sel.text).toBe(exp);
    expect(sel.sel.replace(/\s+/g, ' ').trim()).toBe(exp.replace(/\s+/g, ' ').trim());
    // AC109: no script adds a tatweel (U+0640) or an end-of-ayah sign (U+06DD): the counts are the file's.
    const count = (x: string, c: string) => x.split(c).length - 1;
    for (const c of ['\u0640', '\u06dd']) expect(count(sel.text ?? '', c)).toBe(count(exp, c));
  });

  test(`P43-03 (AC14, AC16, AC18, AC19, AC21, D-281 A): Next on the left and Previous on the right, 44 px, named with the target page; disabled at 1 and 604; a button turn opens in place, says the page and moves focus to the heading; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PG(lang, 50));
    await hydrated(page);
    const nav = page.locator('nav[data-turn="end"]');
    const nx = await nav.locator('[data-page-next]').boundingBox(), pv = await nav.locator('[data-page-prev]').boundingBox();
    expect(nx!.x, 'Next is on the left').toBeLessThan(pv!.x);
    expect(Math.min(nx!.height, pv!.height, nx!.width, pv!.width)).toBeGreaterThanOrEqual(44);
    await expect(nav.locator('[data-page-next]')).toHaveAttribute('aria-label', t(lang, 'mushafGoPage', { label: t(lang, 'nextPage'), p: 51 }));
    await expect(nav.locator('[data-page-prev]')).toHaveAttribute('aria-label', t(lang, 'mushafGoPage', { label: t(lang, 'prevPage'), p: 49 }));
    await expect(nav).toHaveAttribute('aria-label', t(lang, 'pageNavLabel'));
    await keep(page);
    await nav.locator('[data-page-next]').click();
    await onPage(page, 51);
    expect(await kept(page), 'in place, no full load').toBe(true);
    await expect(page.locator('[data-page-status]')).toHaveText(t(lang, 'pageTurned', { p: 51, j: Number(await page.locator('[data-mushaf]').getAttribute('data-juz')) }));
    await expect(page.locator('h1[data-mushaf-h]')).toBeFocused();
    // AC17: keys on the card.
    await card(page).focus();
    await page.keyboard.press('ArrowRight');
    await onPage(page, 50);
    await card(page).focus();
    await page.keyboard.press('ArrowLeft');
    await onPage(page, 51);
    expect(await kept(page)).toBe(true);
    for (const [p, which] of [[1, 'prev'], [604, 'next']] as const) {
      await page.goto(PG(lang, p));
      await hydrated(page);
      await expect(page.locator(`nav[data-turn="end"] [data-page-${which}]`)).toBeDisabled();
    }
  });

  test(`P43-04 (AC15, AC117): a one-finger swipe left-to-right opens the next page, right-to-left the previous; diagonal, edge, two-finger and panel-open swipes and taps do not turn; ${lang}`, async ({ browser }) => {
    const { ctx, page, errs } = await ctxFor(browser);
    await page.goto(PG(lang, 50));
    await hydrated(page);
    const b = (await card(page).boundingBox())!;
    const y = b.y + Math.min(200, b.height / 2);
    await swipe(page, 100, y, 260, y);
    await onPage(page, 51);
    await hydrated(page);
    await swipe(page, 260, y, 100, y);
    await onPage(page, 50);
    await hydrated(page);
    // Diagonal (sideways less than twice the up-down move), from the edge, two fingers: no turn.
    await swipe(page, 100, y, 180, y + 60);
    await swipe(page, 10, y, 200, y);
    await swipe(page, 100, y, 260, y, 2);
    await page.waitForTimeout(600);
    await onPage(page, 50);
    // A tap on an ayah opens its panel; a swipe with the panel open does not turn the page behind.
    const first = page.locator('[data-mushaf-card] li.ayah-row p.ayah').first();
    await first.tap();
    await expect(page.locator('dialog[data-ayah-panel]').first()).toHaveJSProperty('open', true);
    await swipe(page, 100, y, 260, y);
    await page.waitForTimeout(600);
    await onPage(page, 50);
    expect(errs).toEqual([]);
    await ctx.close();
  });

  test(`P43-05 (AC1, AC2, AC3, AC4, AC119): Scroll is the default; the header switch opens the page at the reading place and stores the view; switching back returns to the top-most ayah; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${home(lang)}2/#a20`);
    await hydrated(page);
    const sw = page.locator('a[data-view-switch]');
    await expect(sw).toHaveAttribute('aria-label', t(lang, 'toPages'));
    const bx = (await sw.boundingBox())!;
    expect(Math.min(bx.width, bx.height)).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => { const h = document.querySelector('.site-header')!.getBoundingClientRect().bottom; return [...document.querySelectorAll<HTMLElement>('li.ayah-row')].find((r) => r.getBoundingClientRect().top >= h - 1)!.dataset.a; });
    await sw.click();
    await onPage(page, pageOfRef(2, Number(top)));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.settings') ?? '{}').view)).toBe('pages');
    await expect(page.locator(`li#m2-${top}`)).toBeInViewport();
    const back = page.locator('a[data-view-switch]');
    await expect(back).toHaveAttribute('aria-label', t(lang, 'toScroll'));
    await page.waitForTimeout(400);
    await back.click();
    await page.waitForURL(/\/2\/#a\d+$/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.settings') ?? '{}').view)).toBeUndefined();
    // Settings: the radio group.
    await page.goto(`${home(lang)}settings/`);
    await hydrated(page);
    const g = page.locator('[data-set-view] [role="radiogroup"]');
    await expect(g).toHaveAccessibleName(t(lang, 'readingView'));
    await expect(page.locator('[data-set-view-opt="scroll"]')).toBeChecked();
    await page.locator('[data-set-view-opt="pages"]').check();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.settings') ?? '{}').view)).toBe('pages');
    const r = await page.locator('[data-set-view] label').first().boundingBox();
    expect(r!.height).toBeGreaterThanOrEqual(44);
  });

  test(`P43-06 (AC5, AC25, AC26, AC27): with Mushaf pages stored, reader links and addresses open the page holding the ayah; a Mushaf address opens in page mode whatever the stored view; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.addInitScript(VIEW_PAGES);
    await page.goto(`${home(lang)}2/#a255`);
    await page.waitForURL(new RegExp(`/page/${pageOfRef(2, 255)}/#m2-255$`));
    await hydrated(page);
    await expect(page.locator('li#m2-255')).toBeInViewport();
    await page.goto(`${home(lang)}36/#a1;tafseer`);
    await page.waitForURL(new RegExp(`/page/${pageOfRef(36, 1)}/#m36-1;tafseer$`));
    await hydrated(page);
    await expect(page.locator('dialog[data-tf-panel][open]')).toHaveCount(1);
    await page.goBack();
    // The Read tab opens the page of the last position (set here by the D-062 rule on page 440).
    await page.evaluate(() => { localStorage.setItem('rifq.saves', JSON.stringify({ v: 1, b: [], l: [18, 10] })); });
    await page.goto(home(lang));
    await hydrated(page);
    await expect(page.locator('nav[data-tabbar] a[data-tab="read"]').first()).toHaveAttribute('href', new RegExp(`/page/${pageOfRef(18, 10)}/#m18-10$`));
    await page.evaluate(() => { localStorage.setItem('rifq.settings', JSON.stringify({ view: undefined })); });
    await page.goto(PG(lang, 77));
    await hydrated(page);
    await onPage(page, 77);
  });

  test(`P43-07 (AC23, AC116): Go to page: the page keyword, Arabic-Indic digits, "page N" in English only; a bare number stays a surah; out of range says pageMissing; Enter opens the page; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.goto(`${home(lang)}search/`);
    await hydrated(page);
    const box = page.locator('[data-goto-input]').first();
    const res = page.locator('a[data-goto-result]').first();
    const kw = t('ar', 'kindPage');
    const ind = String.fromCodePoint(0x665, 0x660); // 50 in Arabic-Indic digits
    for (const q of [`${kw} 50`, `${String.fromCodePoint(0x627, 0x644)}${kw} ${ind}`]) {
      await box.fill(q);
      await expect(res).toHaveAttribute('data-goto-result', 'page');
      await expect(res).toHaveAttribute('data-goto-ref', '50');
    }
    const st = refsOn(50)[0].split(':');
    await expect(res.locator('.goto-sub').first()).toContainText(`${st[0]}:${st[1]}`);
    await expect(res.locator('[data-goto-page-dev]')).toHaveText(t(lang, 'pageNumberDev'));
    await box.fill('page 50');
    if (lang === 'en') await expect(res).toHaveAttribute('data-goto-result', 'page');
    else await expect(page.locator('a[data-goto-result="page"]')).toHaveCount(0);
    await box.fill('50');
    await expect(res).toHaveAttribute('data-goto-result', 'surah');
    for (const bad of [0, 605]) {
      await box.fill(`${kw} ${bad}`);
      await expect(page.locator('a[data-goto-result]')).toHaveCount(0);
      await expect(page.getByText(t(lang, 'pageMissing'))).toBeVisible();
    }
    await expect(page.locator('[data-goto-chip]', { hasText: `${t(lang, 'kindPage')} 50` })).toHaveCount(1);
    await box.fill(`${kw} 50`);
    await box.press('Enter');
    await onPage(page, 50);
    await expect(page.locator('label', { hasText: t(lang, 'gotoLabel') }).first()).toHaveCount(0); // the label is on the Go to screen only
  });

  test(`P43-08 (AC31, AC32, AC114): the last position on a page is its first ayah after 3 s, in today's format; pages turned in under 3 s record nothing; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PG(lang, 50));
    await hydrated(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? '{}').l ?? null), { timeout: 8000 }).toEqual(refsOn(50)[0].split(':').map(Number));
    const saves = await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? '{}'));
    expect(Object.keys(saves).sort()).toEqual(['b', 'l', 'v']);
    const before = saves.l;
    await page.locator('nav[data-turn="end"] [data-page-next]').click();
    await onPage(page, 51);
    await page.locator('nav[data-turn="end"] [data-page-next]').click();
    await onPage(page, 52);
    await page.locator('nav[data-turn="end"] [data-page-next]').click();
    await onPage(page, 53);
    // Pages 51 and 52 were passed in under 3 s each: nothing recorded for them.
    const now = await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? '{}').l);
    expect([JSON.stringify(before), JSON.stringify(refsOn(53)[0].split(':').map(Number))]).toContain(JSON.stringify(now));
  });

  test(`P43-09 (AC28, AC30, AC115): bookmarking from the page shows the mark at once, no text is added, the button carries "Bookmarked"; the scroll reader shows it too; ${lang}`, async ({ page }) => {
    await page.addInitScript(BOTH_TIPS);
    await page.goto(PG(lang, 50));
    await hydrated(page);
    const [s, a] = refsOn(50)[1].split(':').map(Number);
    const row = page.locator(`li#m${s}-${a}`);
    const before = await page.locator('ol.mp-flow').first().textContent();
    await row.locator('button.ayah-act').focus();
    await page.keyboard.press('Enter');
    const dlg = page.locator('dialog[data-ayah-panel][open]');
    await expect(dlg).toHaveCount(1);
    await dlg.locator('[data-act-bookmark]').click();
    await dlg.locator('[data-act-close]').click();
    await expect(row.locator('[data-bm-mark]')).toHaveCount(1);
    await expect(row.locator('button.ayah-act')).toHaveAttribute('aria-describedby', 'mp-bm-desc');
    await expect(row.locator('button.ayah-act')).toHaveAccessibleDescription(t(lang, 'bookmarkedMark'));
    expect(await page.locator('ol.mp-flow').first().textContent()).toBe(before);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rifq.saves') ?? '{}').b)).toEqual([[s, a]]);
    await page.goto(`${home(lang)}${s}/`);
    await hydrated(page);
    await expect(page.locator(`li#a${a} [data-bm-mark]`)).toHaveCount(1);
  });

  test(`P43-10 (AC35, AC36, AC113, D-280 A, D-284 A): during surah playback the page turns by itself to the playing ayah's page; a turn by hand pauses it and shows "Recitation is on page {p}"; ${lang}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(BOTH_TIPS);
    await serveAudio(page, (s) => n(s) * STEP);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PG(lang, 2));
    await hydrated(page);
    await expect(page.locator('[data-mushaf-card] [data-play-surah]')).toHaveCount(1); // D-284 A: one row
    await page.locator('[data-play-surah]').click();
    await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused && x.ready >= 3; }).toBe(true);
    const lastOn2 = Number(refsOn(2).at(-1)!.split(':')[1]);
    const firstOn3 = Number(refsOn(3)[0].split(':')[1]);
    await page.evaluate((ms) => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).currentTime = ms / 1000; }, (lastOn2 - 1) * STEP + 4000);
    await onPage(page, 3);
    await expect(page.locator(`li#m2-${firstOn3}`)).toHaveClass(/ap-current/);
    expect((await audioState(page))!.paused).toBe(false);
    // By hand back to page 2: no automatic turn for 5 s, and the button shows.
    await page.locator('nav[data-turn="end"] [data-page-prev]').click();
    await onPage(page, 2);
    await expect(page.locator('[data-playing-on]')).toHaveText(t(lang, 'playingOnPage', { p: 3 }));
    await page.waitForTimeout(3000);
    await onPage(page, 2);
    // After 5 s following resumes: the page turns to the playing ayah again.
    await expect.poll(async () => { const a = Number(await page.locator('[data-mini-player]').getAttribute('data-a')); return Number(await page.locator('[data-mushaf]').getAttribute('data-mushaf')) === pageOfRef(2, a); }, { timeout: 10_000 }).toBe(true);
    await onPage(page, 3);
  });

  test(`P43-11 (AC120, P-16): the page-mode tip shows once on a device that has seen the reader tips; Done records "page tip seen" on the device only; ${lang}`, async ({ page }) => {
    await page.goto(PG(lang, 50));
    await hydrated(page);
    const dlg = page.locator('dialog[data-tips][data-tip="pages"]');
    await expect(dlg).toHaveJSProperty('open', true);
    await expect(dlg.locator('[data-tip-title]')).toHaveText(t(lang, 'tipPagesTitle'));
    await expect(dlg.locator('[data-tip-count]')).toHaveCount(0);
    await dlg.locator('[data-tip-done]').click();
    expect(await page.evaluate(() => localStorage.getItem('rifq.tips'))).toBe('1p');
    await page.goto(PG(lang, 51));
    await hydrated(page);
    await page.waitForTimeout(800);
    await expect(page.locator('dialog[data-tips]')).toHaveCount(0);
  });

  test(`P43-12 (AC11, AC12, AC13, AC111, AC112 a, AC121, D-283 B): pages 1, 50, 552, 585 at 390/320 px, 100% and 200% text and 200% page zoom: no sideways scroll, no overlap, load layout shift 0.1 or less; large text has Previous/Next at both ends and no inner scroll; ${lang}`, async ({ browser }, info) => {
    test.setTimeout(300_000);
    const out: Record<string, unknown> = {};
    for (const [kind, w] of [['normal', 390], ['normal', 320], ['text', 390], ['text', 320], ['page', 390], ['page', 320]] as const) {
      const pg = kind === 'page';
      const { ctx, page, errs } = await ctxFor(browser, pg ? w / 2 : w, pg ? 422 : (w === 320 ? 640 : 844), { scale: pg ? 2 : 1, text200: kind === 'text' });
      await page.addInitScript(() => { const x = window as unknown as { __cls: number }; x.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) x.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
      for (const p of [1, 50, 552, 585]) {
        await page.goto(PG(lang, p));
        await hydrated(page);
        if (kind === 'text') expect(await rootFontPx(page)).toBe(32);
        await page.waitForTimeout(1200);
        const f = await page.evaluate(() => {
          const d = document.documentElement, c = document.querySelector<HTMLElement>('[data-mushaf-card]')!;
          const boxes = [...document.querySelectorAll<HTMLElement>('nav[data-turn] .mp-btn, .site-header a, .site-header button')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect());
          let overlap = false;
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const A = boxes[i], B = boxes[j]; if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) overlap = true; }
          const inner = c.scrollHeight > c.clientHeight + 1 && getComputedStyle(c).overflowY !== 'visible';
          const lh = parseFloat(getComputedStyle(document.querySelector('ol.mp-flow')!).lineHeight);
          const cr = c.getBoundingClientRect();
          const shown = Math.max(0, Math.min(cr.bottom, innerHeight) - Math.max(cr.top, 0));
          return { sw: d.scrollWidth, cw: d.clientWidth, csw: c.scrollWidth, ccw: c.clientWidth, overlap, inner, top: getComputedStyle(document.querySelector('nav[data-turn="top"]')!).display !== 'none', tall: d.classList.contains('rifq-tall-text'), cls: (window as unknown as { __cls: number }).__cls, lines: Math.floor(shown / lh) };
        });
        const tag = `${kind} ${w} p${p}`;
        out[tag] = { cls: Math.round(f.cls * 1000) / 1000, inner: f.inner, lines: f.lines };
        expect(f.sw, `${tag}: page sideways`).toBeLessThanOrEqual(f.cw);
        expect(f.csw, `${tag}: card sideways`).toBeLessThanOrEqual(f.ccw);
        expect(f.overlap, `${tag}: overlap`).toBe(false);
        expect(f.cls, `${tag}: load layout shift`).toBeLessThanOrEqual(0.1);
        if (f.tall) { expect(f.inner, `${tag}: no inner scroll at large text`).toBe(false); expect(f.top, `${tag}: Previous/Next before the page`).toBe(true); }
        await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0; });
      }
      expect(errs).toEqual([]);
      await ctx.close();
    }
    info.annotations.push({ type: 'pages', description: JSON.stringify(out) });
  });

  test(`P43-13 (AC12): the 5 text sizes at 320 px on page 552: no sideways scroll; ${lang}`, async ({ browser }) => {
    for (const size of [1.25, 1.5, 1.75, 2, 2.5]) {
      const { ctx, page } = await ctxFor(browser, 320, 640);
      await ctx.addInitScript((z) => { try { localStorage.setItem('rifq.settings', JSON.stringify({ size: z })); } catch { /* */ } }, size);
      await page.goto(PG(lang, 552));
      await hydrated(page);
      const f = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, c: document.querySelector<HTMLElement>('[data-mushaf-card]')!.scrollWidth - document.querySelector<HTMLElement>('[data-mushaf-card]')!.clientWidth }));
      expect(f.sw, `size ${size}`).toBeLessThanOrEqual(f.cw);
      expect(f.c, `size ${size} card`).toBeLessThanOrEqual(0);
      await ctx.close();
    }
  });
}

test('P43-14 (AC22): without JavaScript a Mushaf page is a plain page with its ayat and working Previous and Next links', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://127.0.0.1:8812' });
  const page = await ctx.newPage();
  await page.goto('/page/50/');
  expect(await page.locator('p.ayah[data-r]').count()).toBe(refsOn(50).length);
  await page.locator('nav[data-turn="end"] a[data-page-next]').click();
  await page.waitForURL(/\/page\/51\/$/);
  expect(await page.locator('p.ayah[data-r]').count()).toBe(refsOn(51).length);
  await ctx.close();
});

test('P43-15 (AC44, AC123): turning pages, Go to page and a bookmark send nothing but page requests to RIFQ; storage gains only the view and the page tip values', async ({ page, seen }) => {
  await page.addInitScript(BOTH_TIPS);
  await page.goto('/page/50/');
  await hydrated(page);
  for (let i = 0; i < 5; i++) { await page.locator('nav[data-turn="end"] [data-page-next]').click(); await onPage(page, 51 + i); }
  for (const s of seen) {
    expect(new URL(s.url).host).toBe('127.0.0.1:8812');
    // No view value or page number in a query, body or header (the asset file names are RIFQ's own).
    expect(new URL(s.url).search + (s.body ?? '') + JSON.stringify(s.headers)).not.toMatch(/view|pages|"page"/);
  }
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys.every((k) => ['rifq.saves', 'rifq.settings', 'rifq.recent', 'rifq.tips'].includes(k))).toBe(true);
});
