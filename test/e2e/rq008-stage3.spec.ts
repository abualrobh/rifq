// RQ-008 v1.0 stage 3 (kit v39, D-199): the reader header (AC50), the Mushaf-style end-of-ayah
// ornament (D-186 B, AC98 to AC107, D-194 A, D-191 A) with P-22, and the Go to view (AC10, AC59 to
// AC69, D-190 C, D-092). Arabic and English, made-up data (the local mock), disposable profiles. No
// Arabic characters and no Quran text in this file: expected text comes from the source file and
// strings.ts; Arabic-Indic digits and the article are written as code points. RIFQ_SHOTS (private
// folder, optional): R10-SHOTS writes screenshots there.
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, surahs, src, MOBILE, hydrated, noOverflow, utf8, sliceOf, settle } from './helpers.ts';
import { juzOfAyah } from '../../src/core/recent.ts';
import { juzStarts } from '../../src/core/source-adapter.ts';
import { splitAyahNumber } from '../../src/core/ayah-number.ts';
import { ayatLabel, t, type Lang } from '../../src/core/strings.ts';
import { AUDIO_HOST } from '../../src/core/audio.ts';

test.use({ allowHosts: [AUDIO_HOST] });

type L = Lang;
const LANGS: L[] = ['ar', 'en'];
const home = (l: L) => (l === 'ar' ? '/' : '/en/');
const P = (l: L, p: string) => home(l) + p;
const nameOf = (l: L, s: number) => (l === 'ar' ? surahs[s - 1].ar : surahs[s - 1].en);
const juz = juzStarts(src.list);
const n = (s: number) => surahs[s - 1].items.length;
const AI = (x: string) => x.replace(/\d/g, (d) => String.fromCodePoint(0x660 + Number(d))); // Arabic-Indic digits
const EAI = (x: string) => x.replace(/\d/g, (d) => String.fromCodePoint(0x6f0 + Number(d))); // Extended Arabic-Indic
const ARTICLE = String.fromCodePoint(0x627, 0x644);
const seed = (ctx: BrowserContext, kv: Record<string, unknown>) => ctx.addInitScript((x) => {
  if (sessionStorage.getItem('r10seeded')) return;
  for (const [k, v] of Object.entries(x)) localStorage.setItem(k, JSON.stringify(v));
  sessionStorage.setItem('r10seeded', '1');
}, kv);
const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

async function goto(page: Page, q: string) {
  const st = page.locator('[data-goto-status]');
  const before = Number(await st.getAttribute('data-seq'));
  await page.fill('[data-goto-input]', q);
  await expect(st).not.toHaveAttribute('data-seq', String(before));
}
const results = (page: Page) => page.$$eval('[data-goto-result]', (as) => as.map((a) => `${a.getAttribute('data-goto-result')} ${a.getAttribute('data-goto-ref')}`));

for (const lang of LANGS) {
  test(`R10-01 (AC50, P-18, P-19, D-193 A): the reader header shows Back, the surah name, its line, Go to and text size; no night button and no language link, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    const head = page.locator('header.site-header');
    await expect(head.locator('h1.surah-title [data-sn]')).toHaveText('2.');
    await expect(head.locator('h1.surah-title span[lang]')).toHaveText(nameOf(lang, 2));
    const j = src.list.find((x) => x.sora === 2 && x.aya_no === 1)!.jozz as number;
    await expect(head.locator('[data-reader-meta]')).toHaveText(t(lang, 'surahMeta', { s: 2, n: ayatLabel(lang, n(2)), j }));
    await expect(head.locator('[data-reader-back]')).toHaveAccessibleName(t(lang, 'back'));
    await expect(head.locator('[data-reader-goto]')).toHaveAccessibleName(t(lang, 'goTo'));
    await expect(head.locator('[data-reader-goto]')).toHaveAttribute('href', P(lang, 'search/'));
    await expect(head.locator('[data-display-toggle]')).toHaveText(t(lang, 'textSize'));
    for (const sel of ['[data-reader-back]', '[data-reader-goto]', '[data-display-toggle]']) { const b = (await head.locator(sel).boundingBox())!; expect(b.width, sel).toBeGreaterThanOrEqual(44); expect(b.height, sel).toBeGreaterThanOrEqual(44); }
    // No night button, no language link, no brand at phone width (AC72, D-181 C).
    expect(await head.locator('.night-btn, #lang-switch, [hreflang]').count()).toBe(0);
    await expect(head.locator('a.brand')).toBeHidden();
    // The kit v38 top links and search button are gone (AC58); the end-of-surah links stay.
    expect(await page.locator('.reader-main > .surah-nav:not(.surah-nav-end), details[data-reader-search]').count()).toBe(0);
    await expect(page.locator('.surah-nav-end a[data-next]')).toHaveAttribute('href', P(lang, '3/'));
    await expect(page.locator('.surah-nav-end a[data-prev]')).toHaveAttribute('href', P(lang, '1/'));
    // Directional icon mirrors in Arabic only.
    const tr = await head.locator('[data-reader-back] svg').evaluate((s) => getComputedStyle(s).transform);
    if (lang === 'ar') expect(tr).not.toBe('none'); else expect(tr).toBe('none');
    // Text size opens the 5 sizes (D-193 A).
    await head.locator('[data-display-toggle]').click();
    await expect(page.locator('[data-display-panel]')).toBeVisible();
    await expect(page.locator('[data-size-label]')).toHaveText(t(lang, 'fontSize', { n: 2, m: 5 }));
    await page.keyboard.press('Escape');
    // Go to opens the Go to screen in place.
    await head.locator('[data-reader-goto]').click();
    await expect(page).toHaveURL(new RegExp(`${P(lang, 'search/').replace(/\//g, '\\/')}$`));
    await expect(page.locator('[data-goto-input]')).toBeVisible();
    // P-18: Back goes to the previous RIFQ page in this tab.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${P(lang, '2/').replace(/\//g, '\\/')}$`));
    await page.goto(P(lang, ''));
    await hydrated(page);
    await page.locator(`a[data-home-juz-link="1"]`).click();
    await expect(page).toHaveURL(/\/1\/#a1$/);
    await hydrated(page);
    await page.locator('header [data-reader-back]').click();
    await expect(page).toHaveURL(new RegExp(`${home(lang).replace(/\//g, '\\/')}$`));
    // Opened directly (no earlier RIFQ page in this tab): Back goes Home.
    const p2 = await page.context().newPage();
    await p2.setViewportSize(MOBILE);
    await p2.goto(P(lang, '36/'));
    await hydrated(p2);
    await p2.locator('header [data-reader-back]').click();
    await expect(p2).toHaveURL(new RegExp(`${home(lang).replace(/\//g, '\\/')}$`));
    await p2.close();
  });
}

test('R10-02 (D-186 B, AC57, AC98, AC99, AC100, AC101, AC107, P-23): every reader ayah keeps its stored text byte for byte; the stored number sits in one ornament element; no text is added', async ({ page }) => {
  test.setTimeout(240_000);
  for (const route of ['/', '/en/']) for (const s of [1, 2, 3, 36, 112, 114]) {
    await page.goto(`${route}${s}/`);
    const got = await page.$$eval('ol.ayat p.ayah[data-r]', (ps) => ps.map((p) => {
      const no = p.querySelectorAll('.ayah-no');
      return { r: p.getAttribute('data-r'), text: p.textContent, spans: no.length, no: no[0]?.textContent ?? null, last: p.lastChild === no[0], hidden: no[0]?.getAttribute('aria-hidden') ?? null, kids: p.children.length, before: no[0] ? getComputedStyle(no[0], '::before').content : '', after: no[0] ? getComputedStyle(no[0], '::after').content : '' };
    }));
    expect(got.length).toBe(n(s));
    for (const g of got) {
      const [ss, aa] = g.r!.split(':').map(Number);
      expect(Buffer.compare(utf8(g.text!), sliceOf(ss, aa)), `${g.r} text content`).toBe(0);
      const x = splitAyahNumber(sliceOf(ss, aa).toString('utf8'));
      expect(x, g.r!).not.toBeNull();
      expect(g.spans).toBe(1);
      expect(g.kids).toBe(1);
      expect(g.no).toBe(x!.no);
      expect(g.last).toBe(true);
      expect(g.hidden, 'the number is read (not hidden)').toBeNull();
      expect(String.fromCodePoint(0x6dd).length && g.text!.includes(String.fromCodePoint(0x6dd))).toBe(false);
      for (const c of [g.before, g.after]) expect(['""', 'none', 'normal']).toContain(c);
    }
  }
});

for (const lang of LANGS) {
  test(`R10-03 (AC102, AC103, AC104, AC106, D-194 A, D-191 A): the ornament scales with the 5 sizes, stays on the last word's line, never overlaps other lines or marks; outline 3:1, digits 4.5:1 in the text colour, light and dark, ${lang}`, async ({ browser }) => {
    test.setTimeout(240_000);
    for (const dark of [false, true]) for (const size of [1.25, 1.5, 1.75, 2, 2.5]) {
      const ctx = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
      await seed(ctx, { 'rifq.settings': { size, dark }, 'rifq.saves': { v: 1, b: [[2, 255]] } });
      const page = await ctx.newPage();
      await page.goto(P(lang, '2/#a255'));
      await hydrated(page);
      await page.waitForTimeout(300);
      for (const a of [1, 255, 282, 286]) {
        const r = await page.evaluate((a) => {
          const p = document.querySelector(`p.ayah[data-r="2:${a}"]`)!;
          const no = p.querySelector<HTMLElement>('.ayah-no')!;
          const cs = getComputedStyle(no), pb = getComputedStyle(no, '::before');
          const pr = p.getBoundingClientRect(), nr = no.getBoundingClientRect();
          const w = parseFloat(pb.width), h = parseFloat(pb.height);
          const cx = nr.left + nr.width / 2, cy = nr.top + nr.height / 2;
          const orn = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
          // The line boxes of the paragraph: the ornament stays inside its own line.
          const rg = document.createRange(); rg.selectNodeContents(p);
          const lines = [...rg.getClientRects()];
          const lh = parseFloat(getComputedStyle(p).lineHeight);
          const lastTop = Math.max(...lines.map((x) => x.top));
          const word = document.createRange(); const tn = p.firstChild!; word.setStart(tn, Math.max(0, (tn.textContent ?? '').length - 3)); word.setEnd(tn, (tn.textContent ?? '').length);
          const wr = word.getClientRects(); const wl = wr[wr.length - 1];
          const root = getComputedStyle(document.documentElement);
          const row = p.closest('li')!;
          const mark = row.querySelector('[data-bm-mark]')?.getBoundingClientRect();
          const act = row.querySelector('button.ayah-act')!.getBoundingClientRect();
          const inter = (A: { left: number; right: number; top: number; bottom: number }, B: DOMRect) => A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom;
          return {
            fs: parseFloat(getComputedStyle(p).fontSize), w, h, lh, color: cs.color, fg: root.getPropertyValue('--fg').trim(),
            line: root.getPropertyValue('--orn-line').trim(), inner: root.getPropertyValue('--orn-inner').trim(), bg: getComputedStyle(document.body).backgroundColor,
            target: root.getPropertyValue('--target').trim(), surface: root.getPropertyValue('--surface').trim(),
            insideP: orn.left >= pr.left - 1 && orn.right <= pr.right + 1, withinLine: orn.top >= cy - lh / 2 - 0.5 && orn.bottom <= cy + lh / 2 + 0.5,
            sameLine: Math.abs(wl.top + wl.height / 2 - cy) < lh / 2, lastLine: Math.abs((nr.top) - lastTop) < lh,
            overMark: mark ? inter(orn, mark) : false, overAct: inter(orn, act),
          };
        }, a);
        const tag = `${dark ? 'dark' : 'light'} size ${size} 2:${a}`;
        expect(r.h / r.fs, `${tag}: scales with the text`).toBeCloseTo(1.6, 1);
        expect(r.h, tag).toBeLessThanOrEqual(r.lh);
        expect(r.insideP, `${tag}: not clipped`).toBe(true);
        expect(r.withinLine, `${tag}: inside its own line`).toBe(true);
        expect(r.sameLine, `${tag}: on the last word's line`).toBe(true);
        expect(r.overMark, `${tag}: bookmark mark`).toBe(false);
        expect(r.overAct, `${tag}: actions button`).toBe(false);
        // Digits: the text colour token, 4.5:1 on the ornament's centre (AC103, D-191 A).
        const hex = (h: string) => { const x = h.slice(1); const v = parseInt(x.length === 3 ? x.replace(/./g, (c) => c + c) : x, 16); return `rgb(${v >> 16}, ${(v >> 8) & 255}, ${v & 255})`; };
        expect(r.color).toBe(hex(r.fg));
        expect(ratio(r.color, hex(r.inner)), tag).toBeGreaterThanOrEqual(4.5);
        // Outline: 3:1 on the page, the surface and the playing-ayah background (AC104).
        for (const b of [r.bg, hex(r.surface), hex(r.target)]) expect(ratio(hex(r.line), b), `${tag}: outline on ${b}`).toBeGreaterThanOrEqual(3);
      }
      await noOverflow(page);
      await ctx.close();
    }
  });
}

test('R10-04 (AC105, AC99): forced colours keep the number visible; selecting and copying an ayah gives the stored text', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812', forcedColors: 'active' });
  const page = await ctx.newPage();
  await page.goto('/2/');
  const r = await page.locator('p.ayah[data-r="2:5"] .ayah-no').evaluate((e) => ({ vis: getComputedStyle(e).visibility, op: getComputedStyle(e).opacity, before: getComputedStyle(e, '::before').display, w: e.getBoundingClientRect().width }));
  expect(r.vis).toBe('visible');
  expect(r.op).toBe('1');
  expect(r.before).toBe('none');
  expect(r.w).toBeGreaterThan(0);
  await ctx.close();
  const c2 = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
  const p2 = await c2.newPage();
  await p2.goto('/2/');
  const sel = await p2.evaluate(() => { const p = document.querySelector('p.ayah[data-r="2:5"]')!; const r = document.createRange(); r.selectNodeContents(p); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); return s.toString(); });
  expect(Buffer.compare(utf8(sel), sliceOf(2, 5))).toBe(0);
  await c2.close();
});

for (const lang of LANGS) {
  test(`R10-05 (P-22, AC26, AC106): the actions button is not shown until it has keyboard focus; a tap on the ornament opens the panel, ${lang}`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    const act = page.locator('button.ayah-act[data-act="3"]');
    expect(await act.evaluate((b) => getComputedStyle(b).opacity)).toBe('0');
    await expect(act).toHaveAccessibleName(t(lang, 'ayahActions', { a: 3 }));
    await page.locator('button.ayah-act[data-act="2"]').focus();
    await page.keyboard.press('Tab');
    await expect(act).toBeFocused();
    expect(await act.evaluate((b) => getComputedStyle(b).opacity)).toBe('1');
    await page.locator('p.ayah[data-r="2:4"] .ayah-no').click();
    await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
    await expect(page.locator('dialog[data-ayah-panel]')).toHaveAttribute('aria-label', t(lang, 'ayahActions', { a: 4 }));
  });
}

for (const lang of LANGS) {
  test(`R10-06 (AC59 to AC63, AC65, D-190 C, D-092, D-064): Go to direct results: references, names, name with ayah, juz keyword, messages; each result names its kind, ${lang}`, async ({ page, seen }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, 'search/'));
    await hydrated(page);
    // AC59 as changed by D-216 A: one labelled input, no word-search row, the how-to hint, chips, notSaved.
    await expect(page.locator('[data-goto-input]')).toHaveAccessibleName(t(lang, 'gotoSearchLabel'));
    await expect(page.locator('[data-goto-word]')).toHaveCount(0);
    await expect(page.locator('[data-goto-how]')).toHaveText(t(lang, 'gotoHowTo'));
    await expect(page.locator('[data-goto-note]')).toHaveText(t(lang, 'notSaved'));
    expect(await page.locator('[data-goto-chip]').count()).toBe(5);
    const from = seen.length;
    const cases: [string, string[] | string][] = [
      ['2:255', ['ayah 2:255', 'surah 2']],
      ['2 : 255', ['ayah 2:255', 'surah 2']],
      [AI('2:255'), ['ayah 2:255', 'surah 2']],
      [EAI('36'), ['surah 36']],
      ['36', ['surah 36']],
      ['115', 'refMissing'],
      ['2:300', 'refMissing'],
      [`${surahs[1].ar} 255`, ['ayah 2:255']],
      [`${surahs[1].ar} ${AI('255')}`, ['ayah 2:255']],
      [`${surahs[0].ar} 8`, 'refMissing'],
      [surahs[35].ar, ['surah 36']],
      [`${t('ar', 'kindJuz')} 30`, ['juz 30']],
      [`${ARTICLE}${t('ar', 'kindJuz')} ${AI('3')}`, ['juz 3']],
      [`${t('ar', 'kindJuz')} 31`, 'juzMissing'],
      [`${t('ar', 'kindJuz')} 0`, 'juzMissing'],
    ];
    // English names come from the file (no surah name is written in the repository, D-157).
    if (lang === 'en') cases.push(['juz 30', ['juz 30']], ['Juz 2', ['juz 2']], [`${surahs[1].en} 255`, ['ayah 2:255']], [surahs[1].en.toLowerCase(), ['surah 2']], ['juz 99', 'juzMissing']);
    else cases.push(['juz 30', 'latinOnly'], [surahs[1].en, 'latinOnly']);
    for (const [q, want] of cases) {
      await goto(page, q);
      if (typeof want === 'string') {
        await expect(page.locator('[data-goto-status]'), q).toHaveText(t(lang, want as 'refMissing'));
        expect(await results(page), q).toEqual([]);
      } else {
        expect(await results(page), q).toEqual(want);
        await expect(page.locator('[data-goto-status]'), q).toHaveText(t(lang, 'offerCount', { n: want.length }));
      }
    }
    // A name that matches many surahs, by its start (D-064 as changed by D-092), in source order.
    await goto(page, surahs[1].ar.slice(0, 4));
    const many = await results(page);
    expect(many.length).toBeGreaterThan(0);
    // Kinds in words, the result line and the target (AC65, AC60, AC63).
    await goto(page, '2:255');
    const first = page.locator('[data-goto-result]').first();
    await expect(first.locator('[data-goto-kind]')).toHaveText(t(lang, 'kindAyah'));
    await expect(first).toHaveAttribute('href', P(lang, '2/#a255'));
    await expect(first.locator('.goto-sub')).toHaveText(t(lang, 'ayahActionsSub', { s: 2, a: 255, j: juzOfAyah(juz, 2, 255) }));
    await expect(page.locator('[data-goto-result="surah"] [data-goto-kind]')).toHaveText(t(lang, 'kindSurah'));
    await expect(page.locator('[data-goto-result="surah"] .goto-sub')).toHaveText(t(lang, 'gotoSurahSub', { s: 2, n: ayatLabel(lang, n(2)) }));
    await goto(page, `${t('ar', 'kindJuz')} 30`);
    const jz = juz.find((x) => x.juz === 30)!;
    await expect(page.locator('[data-goto-result="juz"]')).toHaveAttribute('href', P(lang, `${jz.s}/#a${jz.a}`));
    await expect(page.locator('[data-goto-result="juz"] .goto-sub')).toHaveText(t(lang, 'gotoJuzSub', { s: jz.s, a: jz.a }));
    await expect(page.locator('[data-goto-result="juz"] [data-goto-kind]')).toHaveText(t(lang, 'kindJuz'));
    // AC64: typing and choosing direct results sends no request carrying the text.
    for (const s of seen.slice(from)) expect(new URL(s.url).pathname, s.url).not.toBe('/api/search');
    await page.locator('[data-goto-result="juz"]').click();
    await expect(page).toHaveURL(new RegExp(`/${jz.s}/#a${jz.a}$`));
    await expect(page.locator(`li#a${jz.a}`)).toBeInViewport();
  });
}

test('R10-07 (AC65): direct results update within 200 ms of the last key with 4x CPU slowdown', async ({ page, context }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/search/');
  await hydrated(page);
  const c = await context.newCDPSession(page);
  await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const times: number[] = [];
  for (const q of ['2:255', '36', `${t('ar', 'kindJuz')} 30`, surahs[1].ar]) {
    await page.locator('[data-goto-input]').fill('');
    const ms = await page.evaluate(async (q) => {
      const input = document.querySelector<HTMLInputElement>('[data-goto-input]')!;
      const st = document.querySelector('[data-goto-status]')!;
      const before = st.getAttribute('data-seq');
      const t0 = performance.now();
      input.value = q; input.dispatchEvent(new Event('input', { bubbles: true }));
      while (st.getAttribute('data-seq') === before) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    }, q);
    times.push(Math.round(ms));
  }
  test.info().annotations.push({ type: 'goto-ms-4x', description: JSON.stringify(times) });
  for (const ms of times) expect(ms).toBeLessThan(200);
});

for (const lang of LANGS) {
  test(`R10-08 (AC66, AC67, AC10, AC69, P-3): word search only when asked, by POST body; nothing typed is kept; the home box is the same view; chips fill the box, ${lang}`, async ({ page, seen, context }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, ''));
    await hydrated(page);
    const box = page.locator('[data-home-goto]');
    await expect(box.locator('[data-goto-input]')).toHaveAccessibleName(t(lang, 'gotoLabel'));
    await box.locator('[data-goto-input]').fill('2:255');
    await expect(box.locator('[data-goto-result]').first()).toHaveAttribute('data-goto-ref', '2:255');
    // Chips: the box gets the chip's text and its results (AC69); names from the file.
    await box.locator('[data-goto-chip]').nth(1).click();
    await expect(box.locator('[data-goto-input]')).toHaveValue(`${nameOf(lang, 2)} 255`);
    await expect(box.locator('[data-goto-result]').first()).toHaveAttribute('data-goto-ref', '2:255');
    await box.locator('[data-goto-chip]').nth(3).click();
    await expect(box.locator('[data-goto-result="juz"]')).toHaveAttribute('data-goto-ref', '30');
    // Word search only when asked (Enter with no direct result, D-213 A), as RQ-002: POST, body only.
    const word = src.list[0].aya_text.split(' ')[1];
    const from = seen.length;
    await box.locator('[data-goto-input]').fill(word);
    await page.waitForTimeout(300);
    expect(seen.slice(from).filter((s) => new URL(s.url).pathname === '/api/search').length).toBe(0);
    await box.locator('[data-goto-input]').press('Enter');
    await expect(page.locator('[data-search-status]')).not.toHaveText('');
    await settle(page);
    const posts = seen.slice(from).filter((s) => new URL(s.url).pathname === '/api/search');
    expect(posts.length).toBe(1);
    expect(posts[0].method).toBe('POST');
    expect(posts[0].url).not.toContain(encodeURIComponent(word));
    expect(JSON.parse(posts[0].body!).q).toBe(word);
    // Enter again runs it again.
    await box.locator('[data-goto-input]').press('Enter');
    await expect.poll(() => seen.slice(from).filter((s) => new URL(s.url).pathname === '/api/search').length).toBe(2);
    // AC67: nothing typed in storage, the address, history state or cookies; empty on return.
    const kept = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie, location.href, history.state]));
    expect(kept).not.toContain(word);
    expect(kept).not.toContain('2:255');
    expect((await context.cookies()).length).toBe(0);
    await page.click('nav[data-tabbar]:visible a[data-tab="saved"]');
    await expect(page).toHaveURL(/saved\/$/);
    await page.goBack();
    await hydrated(page);
    await expect(page.locator('[data-home-goto] [data-goto-input]')).toHaveValue('');
  });
}

for (const lang of LANGS) {
  test(`R10-09 (AC68, AC5): a Go to result opens the reader in place; a recitation keeps playing, ${lang}`, async ({ page }) => {
    const { serveAudio, audioState } = await import('./audio-helpers.ts');
    await serveAudio(page, (s) => n(s) * 5000);
    await page.setViewportSize(MOBILE);
    await page.goto(P(lang, '1/'));
    await hydrated(page);
    await page.locator('[data-play-surah]').click();
    await expect.poll(async () => { const x = await audioState(page); return !!x && !x.paused; }).toBe(true);
    await page.evaluate(() => { (window as unknown as { __doc: number }).__doc = 1; });
    await page.locator('header [data-reader-goto]').click();
    await expect(page).toHaveURL(/search\/$/);
    await page.locator('[data-goto-input]').fill('36:12');
    await page.locator('[data-goto-result="ayah"]').click();
    await expect(page).toHaveURL(/\/36\/#a12$/);
    expect(await page.evaluate(() => (window as unknown as { __doc?: number }).__doc)).toBe(1);
    expect((await audioState(page))!.paused).toBe(false);
    await expect(page.locator('li#a12')).toBeInViewport();
  });
}

for (const lang of LANGS) {
  test(`R10-10 (AC92, AC7, AC93 P-17): Go to and the reader header at 390 and 320 px, 100% and 200%: no sideways scroll; layout shift of home, reader, Saved and Go to at 1x and 4x CPU is 0.1 or less, ${lang}`, async ({ browser }) => {
    test.setTimeout(240_000);
    for (const [kind, w] of [['normal', 390], ['normal', 320], ['text', 390], ['text', 320], ['page', 195]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: kind === 'page' ? 422 : 844 }, deviceScaleFactor: kind === 'page' ? 2 : 1, baseURL: 'http://127.0.0.1:8812' });
      if (kind === 'text') await ctx.addInitScript(() => { document.documentElement.style.fontSize = '200%'; });
      const page = await ctx.newPage();
      for (const p of ['search/', '2/']) {
        await page.goto(P(lang, p));
        await hydrated(page);
        if (p === 'search/') { await page.fill('[data-goto-input]', '2:255'); await page.waitForTimeout(200); }
        const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(r.sw, `${kind} ${w} ${p}`).toBeLessThanOrEqual(r.cw);
      }
      await ctx.close();
    }
    const out: Record<string, number> = {};
    for (const cpu of [1, 4]) for (const path of ['', '2/', 'saved/', 'search/']) {
      const ctx = await browser.newContext({ viewport: MOBILE, baseURL: 'http://127.0.0.1:8812' });
      await seed(ctx, { 'rifq.saves': { v: 1, b: [[2, 3], [2, 5]], l: [2, 255] }, 'rifq.recent': { v: 1, s: [18, 2] } });
      const page = await ctx.newPage();
      await page.addInitScript(() => { const w = window as unknown as { __cls: number }; w.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
      if (cpu > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
      await page.goto(P(lang, path));
      await hydrated(page);
      await page.waitForTimeout(1200);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      out[`${path || 'home'} ${cpu}x`] = Math.round(cls * 1000) / 1000;
      expect(cls, `${path || 'home'} ${cpu}x`).toBeLessThanOrEqual(0.1);
      await ctx.close();
    }
    test.info().annotations.push({ type: 'cls', description: JSON.stringify(out) });
  });
}

test('R10-SHOTS: screenshots of the stage 3 screens and the v39 fixes (private folder, optional)', async ({ browser }) => {
  const dir = process.env.RIFQ_SHOTS;
  test.skip(!dir, 'RIFQ_SHOTS not set');
  test.setTimeout(600_000);
  mkdirSync(dir!, { recursive: true });
  const { serveAudio } = await import('./audio-helpers.ts');
  for (const width of [390, 320]) for (const lang of LANGS) for (const dark of [false, true]) for (const zoom of [1, 2]) {
    const page2 = zoom === 2;
    const ctx = await browser.newContext({ viewport: { width: page2 ? width / 2 : width, height: page2 ? 422 : 844 }, deviceScaleFactor: zoom, baseURL: 'http://127.0.0.1:8812' });
    await seed(ctx, { 'rifq.saves': { v: 1, b: [[2, 3]], l: [2, 1] }, 'rifq.settings': { size: 1.5, dark } });
    const page = await ctx.newPage();
    await serveAudio(page, (s) => n(s) * 5000);
    const tag = `${lang}-${dark ? 'dark' : 'light'}-${width}-${zoom * 100}`;
    await page.goto(P(lang, '2/'));
    await hydrated(page);
    await page.screenshot({ path: `${dir}/reader-top-${tag}.png` });
    await page.locator('p.ayah[data-r="2:255"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/ornament-${tag}.png` });
    await page.goto(P(lang, '2/#a5;tafseer'));
    await hydrated(page);
    await expect(page.locator('dialog[data-tf-panel] [data-tf-status]')).not.toHaveAttribute('data-tf-status', 'loading');
    await page.locator('dialog[data-tf-panel] .tf-nav').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/tafseer-panel-labels-${tag}.png` });
    await page.goto(P(lang, 'search/'));
    await hydrated(page);
    await page.fill('[data-goto-input]', '2:255');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/goto-${tag}.png` });
    // Mini-player loading cue (metadata held back) and the previous/next buttons.
    await page.route('**/api/audio', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue(); });
    await page.goto(P(lang, '2/#a200'));
    await hydrated(page);
    await page.locator('button.ayah-act[data-act="200"]').click();
    await page.locator('dialog[data-ayah-panel] [data-act-play-from]').click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${dir}/mini-loading-${tag}.png` });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${dir}/mini-playing-${tag}.png` });
    await ctx.close();
  }
});
