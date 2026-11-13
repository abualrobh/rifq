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
async function primeAudio(page: Page, goto: Page['goto']) {
  const { serveAudio } = await import('./audio-helpers.ts');
  await serveAudio(page, () => 3_600_000);
  await goto('/1/');
  await hydrated(page);
  await page.click('button.ap[data-ap="1"]');
  await page.waitForFunction(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null; return !!a && !a.paused && a.readyState >= 2; });
  await page.evaluate(() => { (document.querySelector('audio[data-audio]') as HTMLAudioElement).playbackRate = 0.0625; (window as unknown as { __inplace: number }).__inplace = 1; });
}

export const test = base.extend<{ seen: Seen[]; guard: void; allowHosts: string[] }>({
  allowHosts: [[], { option: true }],
  seen: async ({}, use) => { await use([]); },
  guard: [async ({ page, seen, allowHosts }, use, info) => {
    const errors: string[] = [];
    let primed = false;
    const exempt = INPLACE ? INPLACE_EXEMPT.find(([id]) => info.title.startsWith(id)) : undefined;
    info.skip(!!exempt, exempt ? `in-place mode: ${exempt[1]}` : '');
    if (INPLACE && !/(audio|continuity)\.spec/.test(info.file)) {
      const orig = page.goto.bind(page);
      (page as unknown as { goto: (u: string, o?: unknown) => Promise<unknown> }).goto = async (url: string, opts?: unknown) => {
        const u = new URL(url, 'http://127.0.0.1:8812');
        if (opts || u.host !== '127.0.0.1:8812' || u.search || /^\/(api|dev)(\/|$)/.test(u.pathname)) return orig(url, opts as never);
        if (!primed) { await primeAudio(page, orig); primed = true; seen.length = 0; }
        const here = await page.evaluate(() => (document.querySelector('meta[name="rifq-page"]') ? location.pathname : '')).catch(() => '');
        if (!here || here === u.pathname) return orig(url, opts as never);
        try {
          await page.evaluate((href) => new Promise<void>((res) => {
            document.addEventListener('astro:page-load', () => res(), { once: true });
            const a = document.createElement('a'); a.href = href; document.body.append(a); a.click(); a.remove();
          }), u.pathname + u.hash);
        } catch { await page.waitForLoadState(); } // the change became a full load (AC66, AC72)
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
      if (st.same) expect(st.playing || st.ended, 'AC70: the recitation kept playing through the in-place changes').toBe(true);
    }
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

// Reader pages keep the search form behind one button (design review H-2, D-070). Opens it if
// this page has one; the home page shows the form directly.
export async function openSearch(page: Page) {
  const d = page.locator('details[data-reader-search]');
  if (!(await d.count())) return;
  if (!(await d.evaluate((x) => (x as HTMLDetailsElement).open))) await page.locator('[data-search-toggle]').click();
  await expect(page.locator('#q')).toBeVisible();
}
