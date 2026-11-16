// D-156 A: the Worker CPU check for the D-149 display marks, on the gated test site (development
// builds behind the password gate only, like /dev/quote-check/).
//
// Kit v30 (QA v29 FIND-W, and the real test site): this page no longer times anything.
//  - On Cloudflare the Workers clock does not move while code runs (it moves only at I/O), so kit
//    v29's page showed "Clock: did not move" and 0.00 ms everywhere. No page inside the Worker can
//    measure its own CPU time there.
//  - Kit v29's page also classified every passage of a surah 5 times and built 3 extra indexes in
//    one request: far more CPU than any /api/tafseer request, so it raised the very figure it was
//    meant to check (dashboard P999 around 630 ms when it ran).
// The evidence is the Cloudflare dashboard: the Worker's CPU time percentiles (P50, P90, P99,
// P999) over a time window that covers only the new deployment. This page says so, and shows only
// counts that are true:
//   - signed-in requests this isolate served before this one (the gate's 401 challenges are not
//     counted), and all requests including those challenges;
//   - /api/tafseer requests this isolate served;
//   - whether this isolate's letters index is already built, and by which route;
//   - with ?s=&page=, for one small page of that surah's passages (QC_PER_PAGE records, the same
//     reads as /dev/quote-check/): each passage's reference and its number of bracketed phrases.
//     Phrases are only found (no matching), so this page never builds the letters index and costs
//     little CPU.
// The page shows numbers and ayah references only: no Quran text, no Tafseer text, no marks.
import { escapeHtml } from '../core/highlight.ts';
import { blockText } from '../core/tafseer-html.ts';
import { phrasesAt } from '../core/tafseer-quotes.ts';
import type { Letters } from './letters.ts';
import { QC_PER_PAGE, type makeQuoteCheck } from './quote-check.ts';

export const TIMING_PATH = '/dev/tafseer-timing/';
// Free plan limit the check is about (Cloudflare Workers, CPU per request).
export const FREE_CPU_MS = 10;

export type IsolateCounts = { all: () => number; signedIn: () => number; tafseerServed: () => number };

export function makeTiming(qc: ReturnType<typeof makeQuoteCheck>, letters: Letters, isolate: IsolateCounts) {
  async function page(env: Parameters<ReturnType<typeof makeQuoteCheck>['chunk']>[0], params: URLSearchParams): Promise<{ status: number; html: string }> {
    const h = escapeHtml;
    const before = Math.max(0, isolate.signedIn() - 1); // signed-in requests before this one
    const allBefore = Math.max(0, isolate.all() - 1);
    const tf = isolate.tafseerServed();
    const built = letters.built();
    const head = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DEVELOPMENT PAGE: Tafseer CPU check - RIFQ</title><link rel="stylesheet" href="/rifq-basic.css"></head>
<body><p class="banner" role="note">DEVELOPMENT PAGE. Private, for Hamzeh only. D-156 A Worker CPU check for the D-149 display. Numbers and ayah references only.</p><main>
<h1>Tafseer display: Worker CPU check</h1>
<p data-t-evidence>This page does not time anything. On Cloudflare the Worker's clock does not move while code runs, so a Worker cannot measure its own CPU time (kit v29's timing page showed "did not move" and 0.00 ms for that reason). <strong>The evidence is the Cloudflare dashboard</strong>: Workers &amp; Pages, this Worker, Metrics, CPU time, the P50, P90, P99 and P999 figures, over a time window that starts after this version was deployed. The free plan allows ${FREE_CPU_MS} ms of CPU per request.</p>`;
    const foot = '</main></body></html>';
    const iso = `<h2>This Worker isolate (counts only)</h2><table><tbody>
<tr><th scope="row">Signed-in requests this isolate served before this one (password challenges not counted)</th><td data-t-before>${before}</td></tr>
<tr><th scope="row">First signed-in request in this isolate</th><td data-t-cold>${before === 0 ? 'yes' : 'no'}</td></tr>
<tr><th scope="row">All requests this isolate received before this one, including password challenges</th><td data-t-all>${allBefore}</td></tr>
<tr><th scope="row">/api/tafseer requests served by this isolate</th><td data-t-tf>${tf}</td></tr>
<tr><th scope="row">Letters index already built in this isolate</th><td data-t-built>${built ? `yes, by ${h(letters.timing.builtBy ?? 'unknown')}` : 'no'}</td></tr>
</tbody></table>`;
    if (!params.has('s')) return { status: 200, html: `${head}${iso}<p>To see how many bracketed phrases the passages hold, choose a surah and a page (${QC_PER_PAGE} ayat a page) and press Count. Each press reads that page from the API, as /dev/quote-check/ does, and only counts phrases: it matches nothing and does not build the letters index.</p>${form(params)}${foot}` };
    const s = Number(params.get('s'));
    const p = params.has('page') ? Number(params.get('page')) : 1;
    const got = await qc.chunk(env, s, p, 0);
    if ('status' in got) return { status: got.status, html: `${head}${iso}${form(params)}<p role="alert">Could not get the passages: ${h(String(got.data.status))}${got.data.kind ? ' (' + h(String(got.data.kind)) + ')' : ''}.</p>${foot}` };
    const rows = got.passages.map((x) => ({ ref: x.ref, range: `${x.s}:${x.from}-${x.to}`, n: phrasesAt(blockText(x.text)).length }));
    const most = rows.reduce((m, r) => Math.max(m, r.n), 0);
    const total = rows.reduce((m, r) => m + r.n, 0);
    const html = `${head}${iso}${form(params)}
<h2>Surah ${s}, page ${p} (tafsir ${got.id}, ${got.passages.length} passages, ${got.records} records, ${got.fetched} API pages read)</h2>
<table><tbody>
<tr><th scope="row">Bracketed phrases on this page</th><td data-t-total>${total}</td></tr>
<tr><th scope="row">Most phrases in one passage</th><td data-t-most>${most}</td></tr>
<tr><th scope="row">Next page</th><td data-t-next>${got.next ? `<a href="${TIMING_PATH}?s=${s}&amp;page=${got.next.page}">page ${got.next.page}</a>` : 'none (end of the surah)'}</td></tr>
</tbody></table>
<table><thead><tr><th scope="col">Passage</th><th scope="col">Covers</th><th scope="col">Phrases</th></tr></thead><tbody>${rows.map((x) => `<tr><td dir="ltr">${h(x.ref)}</td><td dir="ltr">${h(x.range)}</td><td data-t-phrases>${x.n}</td></tr>`).join('')}</tbody></table>
<p>A reader's /api/tafseer request classifies one passage, once, when it is not in the cache. A passage with many phrases costs more CPU than one with few; the dashboard's P99 and P999 show the costly ones.</p>${foot}`;
    return { status: 200, html };
  }
  const form = (params: URLSearchParams) => `<form method="get" action="${TIMING_PATH}"><p><label>Surah <input name="s" value="${escapeHtml(params.get('s') ?? '2')}" size="4" dir="ltr"></label> <label>Page <input name="page" value="${escapeHtml(params.get('page') ?? '1')}" size="4" dir="ltr"></label> <button type="submit">Count</button></p></form>`;
  return { page };
}
