// Shared e2e helpers. Expected values are read from the source named by RIFQ_RECORD at run time;
// no Quran text is written in any test file. Reports carry references, counts and hashes only.
import { expect, test as base, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { loadSource, surahsOf } from '../../src/core/source-adapter.ts';

const RECORD = process.env.RIFQ_RECORD;
if (!RECORD) throw new Error('RIFQ_RECORD must name the source record used for the build');
export const src = loadSource(RECORD);
export const surahs = surahsOf(src.list);
export const N = surahs.length;
export const BUILD = resolve(process.env.RIFQ_BUILD ?? '.out/synthetic');
export const STRICT = 'http://127.0.0.1:8813';
export const MOBILE = { width: 390, height: 844 }; // U-18 has no value; 390 px is this build's choice.
export const DESKTOP = { width: 1280, height: 900 };
export const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export const utf8 = (s: string) => Buffer.from(s, 'utf8');
export const sliceOf = (s: number, a: number) => src.slices[src.list.findIndex((x) => x.sora === s && x.aya_no === a)];

// D-051: removals happen only through the product, in disposable profiles, and each is logged.
export function logRemoval(testId: string, what: string) {
  mkdirSync(join(BUILD, 'reports'), { recursive: true });
  appendFileSync(join(BUILD, 'reports', 'removals.log'), `${new Date().toISOString()} | ${testId} | ${what}\n`);
}

type Seen = { url: string; method: string; body: string | null; headers: Record<string, string> };

// Every page gets: request capture, CSP violation capture, dialog guard and page error capture.
// allowHosts: extra hosts a spec may reach. Only the RQ-006 audio spec sets it, to the approved audio
// host, whose requests it answers itself with a made-up silent file (nothing leaves the machine).
//
// RQ-006 v1.3 AC70 in-place mode (RIFQ_INPLACE=1): every spec except the audio and continuity specs
// runs with its pages reached by in-place changes during playback. The first page.goto of a test
// loads /1/ in full, starts ayah 1 (single ayah, which never moves the last position) at a slow
// rate so it plays through the whole test, then every page.goto to a page a reader can open is
// made in place by a link click, as a reader's own click would be. A goto with options, with a
// query, to /api/ or /dev/, or to the page already shown stays a full load. At the end the
// recitation must still be playing (or have ended by itself) unless the test itself loaded a page
// in full.
// QA v26 FIND-L: before each in-place change, if no recitation is playing (the test loaded a page in
// full, or the primed ayah ended), it is primed again, so every change is made during playback
// unless the test is listed in NO_REPRIME. The page used for priming is never the page the test
// asks for (so that goto is still an in-place change). Each test writes its counts (changes in
// place with and without sound, fall-backs, gotos kept full and why, and whether it ended with the
// "still playing" check) to reports/inplace-counts-<run>.jsonl; scripts/inplace-summary.ts adds
// them up.
const INPLACE = process.env.RIFQ_INPLACE === '1';
const AUDIO_HOST_NAME = 'download.quranicaudio.com';
// Tests whose check is about a full load itself, so in-place mode cannot express it. Each reason
// says why; each still runs (and passes) in the normal mode.
const INPLACE_EXEMPT: [string, string][] = [
  ['PV-01', 'reads the HTTP response of page.goto (headers); an in-place change has no navigation response'],
  ['PV-04', 'asserts that no other site is contacted; in this mode a recitation plays, so the approved audio host is (AC33)'],
  ['IX-03', 'asserts GET-only requests; after the language switch the playing recitation asks for the reciter list in the new language (AC74, a POST of {lang} only)'],
  ['DS-03', 'asserts the font requests; the fonts were already fetched by the first page of the tab'],
  ['D-069', 'asserts the font requests; the fonts were already fetched by the first page of the tab'],
  ['NT-02', 'checks the focus ring after a programmatic focus; Chromium shows it only when the last input was not a pointer, and this mode starts playback with a click'],
];
// Tests where priming again mid-test would change what the test checks. Each reason says why.
const NO_REPRIME: [string, string][] = [];
const playingNow = (page: Page) => page.evaluate(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null; return !!a && !a.paused && (window as unknown as { __inplace?: number }).__inplace === 1; }).catch(() => false);
const served = new WeakSet<Page>();
async function primeAudio(page: Page, goto: Page['goto'], avoid = '') {
  if (!served.has(page)) {
    const { serveAudio } = await import('./audio-helpers.ts');
    await serveAudio(page, () => 3_600_000);
    served.add(page);
  }
  // Ayah 1 of surah 1 (or of surah 2 when the test asks for /1/ itself): a single ayah never moves
  // the last position.
  const s = avoid === '/1/' ? 2 : 1;
  await goto(`/${s}/`);
  await hydrated(page);
  await ayahAction(page, 1, 'play-ayah');
  await page.waitForFunction(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null; return !!a && !a.paused && a.readyState >= 2; });
  await page.evaluate(() => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).playbackRate = 0.0625; (window as unknown as { __inplace: number }).__inplace = 1; });
}

function writeCounts(title: string, file: string, o: object) {
  mkdirSync(join(BUILD, 'reports'), { recursive: true });
  appendFileSync(join(BUILD, 'reports', `inplace-counts-${process.env.RIFQ_RUN_ID ?? 'run'}.jsonl`), JSON.stringify({ file: file.split('/').pop(), title, ...o }) + '\n');
}

// Kit v40 (RQ-008 stage 4): the first-visit tips are a modal dialog on the first reader page of a
// fresh profile, which would make the page behind inert in every test. So every context a test uses
// (its own page's and any it makes with browser.newContext) starts as a device that has already seen
// the tips (rifq.tips = "1", the product's own stored value), unless the test sets tipsSeen: false
// (test/e2e/kit-v40.spec.ts). A test that blocks storage is unaffected: this runs first and fails
// silently.
export const TIPS_SEEN_SCRIPT = () => { try { if (localStorage.getItem('rifq.tips') === null) localStorage.setItem('rifq.tips', '1'); } catch { /* storage blocked */ } };

export const test = base.extend<{ seen: Seen[]; guard: void; allowHosts: string[]; tipsSeen: boolean; tipsGuard: void }>({
  allowHosts: [[], { option: true }],
  tipsSeen: [true, { option: true }],
  tipsGuard: [async ({ context, browser, tipsSeen }, use) => {
    if (!tipsSeen) { await use(); return; }
    await context.addInitScript(TIPS_SEEN_SCRIPT);
    const orig = browser.newContext;
    browser.newContext = (async (o?: Parameters<typeof orig>[0]) => { const c = await orig.call(browser, o); await c.addInitScript(TIPS_SEEN_SCRIPT); return c; }) as typeof orig;
    try { await use(); } finally { browser.newContext = orig; }
  }, { auto: true }],
  seen: async ({}, use) => { await use([]); },
  guard: [async ({ page, seen, allowHosts }, use, info) => {
    const errors: string[] = [];
    let primed = false;
    const count = { primes: 0, inPlacePlaying: 0, inPlaceSilent: 0, fellBack: 0, keptFull: {} as Record<string, number> };
    const full = (why: string) => { count.keptFull[why] = (count.keptFull[why] ?? 0) + 1; };
    const noReprime = NO_REPRIME.find(([id]) => info.title.startsWith(id));
    const exempt = INPLACE ? INPLACE_EXEMPT.find(([id]) => info.title.startsWith(id)) : undefined;
    info.skip(!!exempt, exempt ? `in-place mode: ${exempt[1]}` : '');
    if (INPLACE && !/(audio|continuity)\.spec/.test(info.file)) {
      const orig = page.goto.bind(page);
      (page as unknown as { goto: (u: string, o?: unknown) => Promise<unknown> }).goto = async (url: string, opts?: unknown) => {
        const u = new URL(url, 'http://127.0.0.1:8812');
        if (opts || u.host !== '127.0.0.1:8812' || u.search || /^\/(api|dev)(\/|$)/.test(u.pathname)) { full(opts ? 'options' : u.search ? 'query' : 'api-dev-or-other-host'); return orig(url, opts as never); }
        if (!primed || (!noReprime && !(await playingNow(page)))) { await primeAudio(page, orig, u.pathname); primed = true; count.primes++; if (count.primes === 1) seen.length = 0; }
        const here = await page.evaluate(() => (document.querySelector('meta[name="rifq-page"]') ? location.pathname : '')).catch(() => '');
        if (!here || here === u.pathname) { full(!here ? 'current-page-not-a1' : 'same-page'); return orig(url, opts as never); }
        if (await playingNow(page)) count.inPlacePlaying++; else count.inPlaceSilent++;
        let fell = false;
        try {
          await page.evaluate((href) => new Promise<void>((res) => {
            document.addEventListener('astro:page-load', () => res(), { once: true });
            const a = document.createElement('a'); a.href = href; document.body.append(a); a.click(); a.remove();
          }), u.pathname + u.hash);
        } catch { fell = true; await page.waitForLoadState(); } // the change became a full load (AC66, AC72)
        if (fell) count.fellBack++;
        await hydrated(page).catch(() => undefined);
        return null;
      };
    }
    page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData(), headers: r.headers() }));
    page.on('dialog', async (d) => { errors.push('dialog:' + d.type()); await d.dismiss(); });
    page.on('pageerror', (e) => errors.push('pageerror:' + e.message.slice(0, 200)));
    await page.addInitScript(() => {
      (window as any).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => (window as any).__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    await use();
    if (primed) {
      const st = await page.evaluate(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null; return { same: (window as unknown as { __inplace?: number }).__inplace === 1, playing: !!a && !a.paused, ended: document.querySelector('[data-mini-player]')?.getAttribute('data-phase') === 'ended' }; }).catch(() => ({ same: false, playing: false, ended: false }));
      writeCounts(info.title, info.file, { primed: true, ...count, end: st.same ? (st.playing ? 'checked-playing' : st.ended ? 'checked-ended' : 'checked-failed') : 'not-checked-document-replaced' });
      if (st.same) expect(st.playing || st.ended, 'AC70: the recitation kept playing through the in-place changes').toBe(true);
    } else if (INPLACE && !/(audio|continuity)\.spec/.test(info.file)) writeCounts(info.title, info.file, { primed: false, ...count, end: exempt ? 'exempt' : 'not-primed-no-page-goto' });
    for (const p of page.context().pages()) {
      const v = await p.evaluate(() => (window as any).__csp ?? []).catch(() => []);
      expect(v, 'no CSP violations').toEqual([]);
    }
    expect(errors, 'no dialogs or page errors').toEqual([]);
    for (const s of seen) expect(['127.0.0.1', ...allowHosts, ...(primed ? [AUDIO_HOST_NAME] : [])], 'only local requests').toContain(new URL(s.url).hostname);
  }, { auto: true }],
});
export { expect };

export async function hydrated(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('astro-island').length > 0 && !document.querySelector('astro-island[ssr]'));
}

export async function noOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(r.sw, 'no horizontal overflow').toBeLessThanOrEqual(r.w + 1);
}

export async function topAyah(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Same rule as the app: the first ayah that starts below the sticky header.
    const h = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
    for (const el of document.querySelectorAll<HTMLElement>('li.ayah-row')) if (el.getBoundingClientRect().top >= h - 1) return Number(el.dataset.a);
    return 0;
  });
}

// DOM ayah refs and text bytes, in page order.
export async function pageAyat(page: Page) {
  const rows = await page.$$eval('p.ayah[data-r]', (ps) => ps.map((p) => [p.getAttribute('data-r'), p.textContent ?? '']));
  return rows.map(([r, t]) => ({ ref: r as string, bytes: utf8(t as string) }));
}

// Placeholder 4G profile from the prototype (U-02 open) and 4x CPU (U-32 open).
export const NET4G = { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750, connectionType: 'cellular4g' as const };

// Kit v39 (RQ-008 stage 3, AC50, AC59): the reader has no search form any more; its header's Go to
// button opens the Go to screen, which has the search input (#q). On home and the Search screen the
// input is on the page. This opens the Go to screen from a reader page (a plain link, so it also works
// without JavaScript).
// Kit v39: after a finished word search the island moves focus to its status line in the next
// animation frame (RQ-002). A key pressed before that frame can land on the status line instead of
// the input; this waits two frames so the next action starts after it.
export async function settle(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

export async function openSearch(page: Page, waitIsland = true) {
  if (await page.locator('#q').count()) return;
  await page.locator('header [data-reader-goto]').click();
  await expect(page.locator('#q')).toBeVisible();
  // With JavaScript, wait for the Go to island (a search sent before it loads is a full POST).
  if (waitIsland) await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'), null, { timeout: 15_000 });
}

// Kit v37 (RQ-008 AC71, AC72): the night button left the header; night mode is switched on the
// Settings screen. Turns it on or off through the product: the Settings tab (an in-place change, so a
// recitation keeps playing), the switch, then Back to the page shown before.
export async function setNight(page: Page, on: boolean) {
  const back = page.url();
  const onSettings = /\/settings\/$/.test(new URL(back).pathname);
  if (!onSettings) {
    await page.locator('nav[data-tabbar]:visible a[data-tab="settings"]').click();
    await expect(page).toHaveURL(/\/settings\/$/);
  }
  await hydrated(page);
  const sw = page.locator('[data-night-switch]');
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', String(on));
  if (!onSettings) {
    await page.goBack();
    await expect(page).toHaveURL(back);
    await hydrated(page).catch(() => undefined);
  }
}

// Kit v38 (RQ-008 D-187 A, AC26 to AC37): the per-ayah controls of kit v37 (play this ayah, play from
// here, bookmark, Tafseer link) are in the ayah actions panel, opened by the ayah's actions button.
export type AyahAction = 'play-from' | 'play-ayah' | 'bookmark' | 'copy' | 'tafseer';
export async function openAyah(page: Page, a: number) {
  await page.locator(`button.ayah-act[data-act="${a}"]:not([data-pending])`).click();
  await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', true);
  await expect(page.locator('dialog[data-ayah-panel] [data-act-title]')).toBeFocused();
}
// Chooses one action for ayah a. Bookmark and copy keep the panel open (AC30, AC32); with close it is
// then closed with its Close button.
export async function ayahAction(page: Page, a: number, action: AyahAction, close = action === 'bookmark' || action === 'copy') {
  await openAyah(page, a);
  await page.locator(`dialog[data-ayah-panel] [data-act-${action}]`).click();
  if (close && (await page.locator('dialog[data-ayah-panel]').evaluate((d) => (d as HTMLDialogElement).open))) {
    await page.locator('dialog[data-ayah-panel] [data-act-close]').click();
    await expect(page.locator('dialog[data-ayah-panel]')).toHaveJSProperty('open', false);
  }
}
// AC31: the bookmark mark of an ayah in the reader.
export const bookmarked = (page: Page, a: number) => page.locator(`li#a${a}`).evaluate((r) => r.classList.contains('is-bm') && !!r.querySelector('[data-bm-mark]'));
// Kit v38: the reader has no link to the Tafseer page any more (the panel replaced it); the page
// itself is still reached by its address, from old links. An in-place change to it, as a reader's
// click on such a link would make.
export async function clickLink(page: Page, href: string) {
  await page.evaluate((h) => { const a = document.createElement('a'); a.href = h; a.setAttribute('data-test-link', ''); document.querySelector('main')!.append(a); a.click(); a.remove(); }, href);
}
