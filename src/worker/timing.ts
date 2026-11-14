// D-156 A: the cold-Worker CPU timing check for the D-149 display marks, on the gated test site
// (development builds behind the password gate only, like /dev/quote-check/).
//
// GET /dev/tafseer-timing/?s=<surah> fetches that surah's passages of the configured work (the
// same requests /dev/quote-check/ makes), then measures, inside this Worker:
//   - whether this isolate is cold (no request served before this one) and whether its letters
//     index was already built, and if so how long that build took;
//   - building a separate letters index now (the cold-start cost a first /api/tafseer pays);
//   - classifying each passage (computeMarks, the /api/tafseer code), per passage.
// The page shows numbers and ayah references only: no Quran text, no Tafseer text, no marks.
//
// The Workers clock: on Cloudflare, Date.now() and performance.now() do not move while code runs;
// they move only at I/O (a Spectre mitigation), and they may count whole milliseconds only. So each
// measurement here is taken between two awaited timer waits, and the same wait with nothing between
// is measured as a baseline and subtracted. Each passage is classified REPEAT times inside one
// window, so a 1 ms clock still gives a figure per passage. If the clock never moved, the page says
// so. The platform's own
// CPU figure per request is in the Cloudflare dashboard (Workers metrics, CPU time); this page is a
// helper, not a replacement for it.
import { escapeHtml } from '../core/highlight.ts';
import { computeMarks } from '../core/tafseer-marks.ts';
import type { Letters } from './letters.ts';
import type { makeQuoteCheck } from './quote-check.ts';

export const TIMING_PATH = '/dev/tafseer-timing/';
// Free plan limit the check is about (Cloudflare Workers, per request).
export const FREE_CPU_MS = 10;
export const REPEAT = 5;

type Clock = () => Promise<number>;

// A timer wait, then the clock. Exported for unit tests.
export const tickClock = (now: () => number = () => performance.now()): Clock => async () => {
  await new Promise((r) => setTimeout(r, 0));
  return now();
};

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const ms = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

export function makeTiming(qc: ReturnType<typeof makeQuoteCheck>, letters: Letters, isolate: { started: number; requests: () => number; tafseerServed: () => number }, clock: Clock = tickClock()) {
  async function page(env: Parameters<ReturnType<typeof makeQuoteCheck>['passages']>[0], params: URLSearchParams): Promise<{ status: number; html: string }> {
    const h = escapeHtml;
    const before = isolate.requests() - 1; // requests this isolate served before this one
    const tfBefore = isolate.tafseerServed();
    const wasBuilt = letters.built();
    const head = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DEVELOPMENT PAGE: Tafseer timing - RIFQ</title><link rel="stylesheet" href="/rifq-basic.css"></head>
<body><p class="banner" role="note">DEVELOPMENT PAGE. Private, for Hamzeh only. D-156 A cold-Worker timing check for the D-149 display. Numbers and ayah references only.</p><main>
<h1>Tafseer display: Worker timing</h1>
<form method="get" action="${TIMING_PATH}"><p><label>Surah <input name="s" value="${h(params.get('s') ?? '2')}" size="4" dir="ltr"></label> <button type="submit">Measure</button></p></form>`;
    const foot = '</main></body></html>';
    const iso = `<h2>This Worker isolate</h2><table><tbody>
<tr><th scope="row">Requests served by this isolate before this one</th><td data-t-before>${before}</td></tr>
<tr><th scope="row">Cold isolate (no request before this one)</th><td data-t-cold>${before === 0 ? 'yes' : 'no'}</td></tr>
<tr><th scope="row">/api/tafseer requests served by this isolate</th><td data-t-tf>${tfBefore}</td></tr>
<tr><th scope="row">Letters index already built in this isolate</th><td data-t-built>${wasBuilt ? `yes, at /api/tafseer request ${letters.timing.builtAtRequest ?? '?'}` : 'no'}</td></tr>
</tbody></table>`;
    if (!params.has('s')) return { status: 200, html: `${head}${iso}<p>Choose a surah and press Measure. Each press fetches that surah's passages from the API (as /dev/quote-check/ does), then times the work in this Worker.</p>${foot}` };
    const s = Number(params.get('s'));
    const got = await qc.passages(env, s);
    if ('status' in got) return { status: got.status, html: `${head}${iso}<p role="alert">Could not get the passages: ${h(String(got.data.status))}${got.data.kind ? ' (' + h(String(got.data.kind)) + ')' : ''}.</p>${foot}` };

    // Baseline: the timer wait alone, a few times.
    const base: number[] = [];
    for (let i = 0; i < 5; i++) { const a = await clock(); const b = await clock(); base.push(b - a); }
    const baseline = pct(base, 50);
    const moved = base.some((x) => x > 0);
    const timed = async (f: () => unknown) => { const a = await clock(); f(); const b = await clock(); return Math.max(0, b - a - baseline); };

    // The isolate's own index: built now if it was not (a cold /api/tafseer would build it).
    const own = wasBuilt ? null : await timed(() => letters.index(0));
    const fresh: number[] = [];
    for (let i = 0; i < 3; i++) fresh.push(await timed(() => letters.fresh()));
    const ix = letters.index(0);
    // The very first classification in this isolate (it pays any first-use cost).
    const first = got.passages[0];
    const firstT = first && !wasBuilt ? await timed(() => computeMarks(ix, first.text, { s: first.s, from: first.from, to: first.to }, true)) : null;
    const per: { ref: string; n: number; t: number }[] = [];
    for (const p of got.passages) {
      let n = 0;
      const t = await timed(() => { for (let r = 0; r < REPEAT; r++) n = computeMarks(ix, p.text, { s: p.s, from: p.from, to: p.to }, true).n; });
      per.push({ ref: p.ref, n, t: t / REPEAT });
    }
    const times = per.map((x) => x.t);
    const slow = [...per].sort((a, b) => b.t - a.t).slice(0, 10);
    const firstBuild = own ?? fresh[0];
    const worst = firstBuild + Math.max(firstT ?? 0, pct(times, 100));
    const verdict = !moved ? 'unknown' : worst < FREE_CPU_MS ? 'under' : 'over';
    const html = `${head}${iso}
<h2>Measured now (surah ${s}, tafsir ${got.id}, ${got.passages.length} passages, ${got.records} records, ${got.pages} API pages)</h2>
<p data-t-clock="${moved ? 'moved' : 'frozen'}">Clock: ${moved ? `moves at timer waits; baseline wait ${ms(baseline)} ms, subtracted from every figure` : '<strong>did not move</strong>; no figure below can be trusted. Use the dashboard CPU time.'}</p>
<table><tbody>
<tr><th scope="row">Building this isolate's letters index now (cold start)</th><td data-t-own>${own === null ? 'already built before this page' : ms(own) + ' ms'}</td></tr>
<tr><th scope="row">Building a separate index, 3 times</th><td data-t-fresh>${fresh.map(ms).join(' ms, ')} ms</td></tr>
<tr><th scope="row">First classification in this isolate (passage ${first ? h(first.ref) : ''})</th><td data-t-first>${firstT === null ? 'not cold (index built before this page)' : ms(firstT) + ' ms'}</td></tr>
<tr><th scope="row">Classifying one passage (each timed ${REPEAT} times): median</th><td data-t-p50>${ms(pct(times, 50))} ms</td></tr>
<tr><th scope="row">Classifying one passage: 95th percentile</th><td data-t-p95>${ms(pct(times, 95))} ms</td></tr>
<tr><th scope="row">Classifying one passage: slowest</th><td data-t-max>${ms(pct(times, 100))} ms</td></tr>
<tr><th scope="row">Classifying all ${per.length} passages</th><td data-t-total>${ms(times.reduce((a, b) => a + b, 0))} ms</td></tr>
<tr><th scope="row">Worst cold /api/tafseer estimate: first index build + the slower of the first classification and the slowest passage</th><td data-t-worst>${ms(worst)} ms</td></tr>
<tr><th scope="row">Against the free plan's ${FREE_CPU_MS} ms CPU per request</th><td data-t-verdict="${verdict}">${verdict === 'under' ? 'under' : verdict === 'over' ? '<strong>over</strong>' : 'unknown'}</td></tr>
</tbody></table>
<h2>Slowest passages</h2>
<table><thead><tr><th scope="col">Passage</th><th scope="col">Phrases</th><th scope="col">ms</th></tr></thead><tbody>${slow.map((x) => `<tr><td dir="ltr">${h(x.ref)}</td><td>${x.n}</td><td>${ms(x.t)}</td></tr>`).join('')}</tbody></table>
<p>These are wall-clock figures between timer waits inside the Worker, which include more than CPU work. The figure Cloudflare enforces is the CPU time per request in the dashboard (Workers and Pages, this Worker, Metrics, CPU time).</p>${foot}`;
    return { status: 200, html };
  }
  return { page };
}
