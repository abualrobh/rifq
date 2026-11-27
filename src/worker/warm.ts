// Kit v43 (D-279 (6), first-request CPU after the Worker has been idle). A new isolate compiles each
// function the first time it runs, and its first requests pay for that: measured locally (Node, and
// the local workerd with its profiler), the first request of each kind takes a few ms more than the
// next one of the same kind (v43/reports/cpu-*.txt in the private data). warmRoutes() runs the pure,
// synchronous parts of the request paths once, at Worker startup, on made-up input (no Quran or
// Tafseer text, no real Quran Foundation data), so that compile work is done before the first
// request instead of inside it. Like warmUp() in letters.ts (kit v30 to v32):
// - nothing it computes leaves the function: every result is thrown away;
// - it touches no state a request can see: no counters, no rate limits, no tokens, no Cache API, no
//   network; the search index's own lazy tables (api.ts meta, built on the first search anyway) are
//   the same whoever builds them, so no answer can change;
// - only what the Workers runtime allows in the global scope: no Request or Response objects, no
//   timers, no I/O (checked in the local runtime: those throw there). crypto.subtle.digest is
//   allowed and is used for the gate's comparison;
// - any error is ignored: the warm-up can never stop the Worker from starting.
import { handleJson } from '../core/api.ts';
import type { Index } from '../core/search-core.ts';
import { AUDIO_ORIGIN, catalogueProblems, checkSurahFile, DEFAULT_RECITER } from '../core/audio.ts';
import { escapeHtml } from '../core/highlight.ts';
import { parseBasic, sameSecret } from './gate.ts';
import { parseCatalogue } from './audio.ts';
import { parseByAyah, parseTafsirList } from './qf.ts';
import { renderPage, type PageCfg } from './page.ts';

const tryIt = (f: () => unknown) => { try { f(); } catch { /* warm-up only */ } };

export function warmRoutes(ix: Index, cfg: PageCfg, opts: { gate: boolean; audio: boolean; tafseer: boolean }): void {
  const cp = (...c: number[]) => String.fromCodePoint(...c);
  // The password gate: the Basic header parser and the hashed comparison (made-up credentials).
  if (opts.gate) {
    tryIt(() => parseBasic('Basic ' + btoa('made-up-user:made-up-password')));
    tryIt(() => { void sameSecret('made-up-a', 'made-up-b').catch(() => undefined); });
  }
  // Search (/api/search and the no-JavaScript form page): made-up letters, a made-up Latin word and
  // a reference; the answers are thrown away.
  for (const q of [cp(0x645, 0x62f, 0x631), 'madeup', '2:255']) {
    tryIt(() => {
      const out = handleJson(ix, JSON.stringify({ q, page: 1 }));
      if (q === 'madeup') renderPage('en', q, out, cfg);
    });
  }
  // RQ-006 audio: the catalogue parser, the AC59 catalogue check and the whole surah-file check on a
  // made-up two-ayah file on the approved host.
  if (opts.audio) {
    tryIt(() => {
      const cat = parseCatalogue({ reciters: [{ id: DEFAULT_RECITER, name: 'Made Up', style: { name: 'Murattal' }, qirat: { name: 'Hafs' }, translated_name: { name: 'Made Up', language_name: 'english' } }] });
      catalogueProblems(DEFAULT_RECITER, cat[0]);
      checkSurahFile({ audio_file: { format: 'mp3', file_size: 160_000, duration: 10_000, audio_url: `${AUDIO_ORIGIN}/made-up/1.mp3`, timestamps: [{ verse_key: '1:1', timestamp_from: 0, timestamp_to: 4900, duration: 4900, segments: [[1, 0, 10]] }, { verse_key: '1:2', timestamp_from: 5000, timestamp_to: 9900, duration: 4900, segments: [[1, 0, 10]] }] } }, 1, 2);
    });
  }
  // RQ-005 Tafseer: the passage and list parsers and the HTML escaping, on made-up JSON.
  if (opts.tafseer) {
    tryIt(() => {
      parseByAyah({ tafsir: { resource_name: 'Made up', language_name: 'english', verses: { '1:1': { text: '<p>made-up</p>' }, '1:2': { text: '<p>made-up</p>' } } } }, 1, 2);
      parseTafsirList({ tafsirs: [{ id: 1, name: 'Made up', author_name: 'Made up', slug: 'made-up', language_name: 'english', translated_name: { name: 'Made up', language_name: 'english' } }] });
      escapeHtml('<made-up & "x">');
    });
  }
}
