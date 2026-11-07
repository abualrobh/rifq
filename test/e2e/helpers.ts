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
export const test = base.extend<{ seen: Seen[]; guard: void }>({
  seen: async ({}, use) => { await use([]); },
  guard: [async ({ page, seen }, use) => {
    const errors: string[] = [];
    page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData(), headers: r.headers() }));
    page.on('dialog', async (d) => { errors.push('dialog:' + d.type()); await d.dismiss(); });
    page.on('pageerror', (e) => errors.push('pageerror:' + e.message.slice(0, 200)));
    await page.addInitScript(() => {
      (window as any).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => (window as any).__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    await use();
    for (const p of page.context().pages()) {
      const v = await p.evaluate(() => (window as any).__csp ?? []).catch(() => []);
      expect(v, 'no CSP violations').toEqual([]);
    }
    expect(errors, 'no dialogs or page errors').toEqual([]);
    for (const s of seen) expect(new URL(s.url).hostname, 'only local requests').toBe('127.0.0.1');
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
