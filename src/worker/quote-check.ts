// D-084 quote check, for the private page /dev/quote-check/ (development builds behind the password
// gate only). POST /api/dev/quote-check with JSON {"s": <surah>, "page": <n>, "skip": <k>} reads ONE
// small page of the configured work's passages for that surah (/tafsirs/{TAFSIR_ID}/by_chapter/{s},
// QC_PER_PAGE records a page), runs src/core/tafseer-quotes.ts on each passage once, and returns the
// counts and the reviewer list for that page, with `next` ({page, skip}, or null at the end). The
// page asks for the next part itself, one request at a time.
//
// Kit v30 (Cloudflare dashboard after kit v29: CPU P99 71.82 ms, P999 151 ms and 630 ms around the
// quote check and timing runs): v29 checked a whole surah in one request (surah 2: 283 passages,
// each phrase matched twice; about 75 to 95 ms of CPU locally). Now one request checks at most
// about QC_PER_PAGE passages, and each phrase is matched once (its display class comes from the
// same result), so a request stays light under the free plan's 10 ms CPU limit.
//
// Passages that run over a page end: by_chapter gives one record per ayah, and neighbouring records
// with identical text are one passage (chapterPassages). A request therefore reads the following
// page(s) as far as its last passage continues, and `next.skip` tells the next request how many
// records at the start of its page were already checked. Passages are the same as in one-surah
// runs (unit-tested).
//
// The approved Quran text is bundled by the build in letters-only form only (no displayed text).
// Nothing is stored or logged. The reviewer list holds the phrases as delivered, which are Tafseer
// text shown to Hamzeh inside the app; the page offers it as JSON or CSV made in the browser.
import { chapterPassages, checkPassage, newSummary, type ReviewItem } from '../core/tafseer-quotes.ts';
import { classOf } from '../core/tafseer-marks.ts';
import { makeLetters, type Letters, type LettersQuran } from './letters.ts';
import { byChapterPath, parseByChapter, QfClient, qfConfig, QfError, type QfSecrets } from './qf.ts';
import { PAGE_PAUSE_MS } from './verify.ts';

export type { LettersQuran } from './letters.ts';

type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; pauseMs?: number; timeoutMs?: number };

export const QC_PER_PAGE = 10;
// The most API pages one request reads (its own page and the look-ahead for a long passage).
export const QC_MAX_FETCH = 6;

type Item = { verse_key: string; text: string };
const ayahOf = (k: string) => Number(/^\d+:(\d+)$/.exec(k)?.[1] ?? NaN);
// Record b continues the passage whose last record is a (same text, next ayah; chapterPassages' rule).
const continues = (a: Item, b: Item) => a.text === b.text && ayahOf(b.verse_key) === ayahOf(a.verse_key) + 1 && a.verse_key.split(':')[0] === b.verse_key.split(':')[0];

// AC31 (RQ-005 v1.1): the display marks of each passage are worked out here with the same index and
// the same code as /api/tafseer (classOf on the same matchPhrase result), so the page can show and
// compare them.
export function makeQuoteCheck(src: LettersQuran | Letters, devAllowed: boolean, deps: Deps = {}) {
  const qf = new QfClient(deps.fetch, deps.now, deps.timeoutMs);
  const L: Letters = 'index' in src ? src : makeLetters(src);
  const q = L.q;
  const index = () => L.index('/api/dev/quote-check');
  type Err = { status: number; data: Record<string, unknown> };
  type Chunk = { id: number; page: number; fetched: number; records: number; passages: ReturnType<typeof chapterPassages>; next: { page: number; skip: number } | null };

  // One small page of the configured work's passages for one surah (also used by the timing page).
  async function chunk(env: QfSecrets & { TAFSIR_ID?: string }, s: number, page = 1, skip = 0): Promise<Err | Chunk> {
    if (!Number.isInteger(s) || s < 1 || s >= q.counts.length) return { status: 400, data: { status: 'bad_request' } };
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(skip) || skip < 0 || skip >= QC_PER_PAGE) return { status: 400, data: { status: 'bad_request' } };
    const c = qfConfig(env, devAllowed);
    const idRaw = typeof env.TAFSIR_ID === 'string' ? env.TAFSIR_ID.trim() : '';
    const id = /^[1-9][0-9]{0,8}$/.test(idRaw) ? Number(idRaw) : null;
    if ('missing' in c || id === null) return { status: 503, data: { status: 'not_configured', missing: [...('missing' in c ? c.missing : []), ...(id === null ? ['TAFSIR_ID'] : [])] } };
    let fetched = 0;
    const get = async (p: number) => {
      if (fetched) await new Promise((res) => setTimeout(res, deps.pauseMs ?? PAGE_PAUSE_MS));
      fetched++;
      return parseByChapter(await qf.get(c, byChapterPath(id, s), { page: String(p), per_page: String(QC_PER_PAGE), fields: 'verse_key' }));
    };
    try {
      const first = await get(page);
      const items: Item[] = first.items.slice(skip);
      let next: Chunk['next'] = first.next === null ? null : { page: first.next, skip: 0 };
      // Look ahead while the last passage continues into the following page.
      while (next && items.length && fetched < QC_MAX_FETCH) {
        const r = await get(next.page);
        let k = 0;
        while (k < r.items.length && continues(items[items.length - 1], r.items[k])) { items.push(r.items[k]); k++; }
        if (k < r.items.length || !r.items.length) { next = r.items.length ? { page: next.page, skip: k } : null; break; }
        next = r.next === null ? null : { page: r.next, skip: 0 };
      }
      const own = items.filter((x) => x.verse_key.startsWith(`${s}:`));
      return { id, page, fetched, records: own.length, passages: chapterPassages(own), next };
    } catch (e) {
      return { status: 503, data: { status: 'unavailable', kind: e instanceof QfError ? e.kind : 'error', s } };
    }
  }

  async function part(env: QfSecrets & { TAFSIR_ID?: string }, s: number, page = 1, skip = 0): Promise<Err> {
    const got = await chunk(env, s, page, skip);
    if ('status' in got) return got;
    const sum = newSummary();
    const list: ReviewItem[] = [];
    // D-149 display classes per passage (the Worker's /api/tafseer marks), for AC31. A class letter
    // per phrase only. The work is Arabic here (D-077), so P-11 does not apply.
    const display: { ref: string; range: string; n: number; c: string }[] = [];
    const byClass = { O: 0, A: 0, P: 0, N: 0 };
    const ix = index();
    for (const p of got.passages) {
      let c = '';
      checkPassage(ix, p.text, { s: p.s, from: p.from, to: p.to }, p.ref, sum, list, (ph, result) => { c += classOf(result, ph, true); });
      for (const ch of c) byClass[ch as keyof typeof byClass]++;
      display.push({ ref: p.ref, range: `${p.s}:${p.from}-${p.to}`, n: c.length, c });
    }
    return { status: 200, data: { status: 'ok', s, tafsirId: got.id, page: got.page, pages: got.fetched, records: got.records, passages: got.passages.length, summary: sum, list, display, displayCounts: byClass, next: got.next } };
  }
  return { part, chunk, letters: L, client: qf };
}
