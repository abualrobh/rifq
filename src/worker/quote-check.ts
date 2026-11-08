// D-084 quote check on one surah, for the private page /dev/quote-check/ (development builds behind
// the password gate only). POST /api/dev/quote-check with JSON {"s": <surah>} fetches the configured
// work's passages for that surah with /tafsirs/{TAFSIR_ID}/by_chapter/{s} (50 per page, a pause
// between pages, never more than 20 pages), runs src/core/tafseer-quotes.ts on each passage and
// returns the counts and the reviewer list. The approved Quran text is bundled by the build in
// letters-only form only (no displayed text). Nothing is stored or logged. The reviewer list holds
// the phrases as delivered, which are Tafseer text shown to Hamzeh inside the app; the page offers
// it as JSON or CSV made in the browser.
import { chapterPassages, checkPassage, lettersIndex, newSummary, type LettersIndex, type ReviewItem } from '../core/tafseer-quotes.ts';
import { byChapterPath, parseByChapter, QfClient, qfConfig, QfError, type QfSecrets } from './qf.ts';
import { PAGE_PAUSE_MS } from './verify.ts';

export type LettersQuran = { counts: number[]; letters: string[] }; // letters-only text per ayah, in source order

type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; pauseMs?: number; timeoutMs?: number };

export function makeQuoteCheck(q: LettersQuran, devAllowed: boolean, deps: Deps = {}) {
  const qf = new QfClient(deps.fetch, deps.now, deps.timeoutMs);
  let ix: LettersIndex | null = null;
  const index = () => {
    if (ix) return ix;
    const rows: { s: number; a: number; letters: string }[] = [];
    let i = 0;
    for (let s = 1; s < q.counts.length; s++) for (let a = 1; a <= q.counts[s]; a++) rows.push({ s, a, letters: q.letters[i++] ?? '' });
    ix = lettersIndex(rows);
    return ix;
  };

  async function surah(env: QfSecrets & { TAFSIR_ID?: string }, s: number): Promise<{ status: number; data: Record<string, unknown> }> {
    if (!Number.isInteger(s) || s < 1 || s >= q.counts.length) return { status: 400, data: { status: 'bad_request' } };
    const c = qfConfig(env, devAllowed);
    const idRaw = typeof env.TAFSIR_ID === 'string' ? env.TAFSIR_ID.trim() : '';
    const id = /^[1-9][0-9]{0,8}$/.test(idRaw) ? Number(idRaw) : null;
    if ('missing' in c || id === null) return { status: 503, data: { status: 'not_configured', missing: [...('missing' in c ? c.missing : []), ...(id === null ? ['TAFSIR_ID'] : [])] } };
    const items: { verse_key: string; text: string }[] = [];
    let page: number | null = 1, pages = 0;
    while (page !== null) {
      try {
        const r = parseByChapter(await qf.get(c, byChapterPath(id, s), { page: String(page), per_page: '50', fields: 'verse_key' }));
        items.push(...r.items);
        page = r.next;
      } catch (e) {
        return { status: 503, data: { status: 'unavailable', kind: e instanceof QfError ? e.kind : 'error', s } };
      }
      pages++;
      if (page !== null && pages >= 20) break;
      if (page !== null) await new Promise((res) => setTimeout(res, deps.pauseMs ?? PAGE_PAUSE_MS));
    }
    const sum = newSummary();
    const list: ReviewItem[] = [];
    const passages = chapterPassages(items.filter((x) => x.verse_key.startsWith(`${s}:`)));
    for (const p of passages) checkPassage(index(), p.text, { s: p.s, from: p.from, to: p.to }, p.ref, sum, list);
    return { status: 200, data: { status: 'ok', s, tafsirId: id, pages, records: items.length, passages: passages.length, summary: sum, list } };
  }
  return { surah, client: qf };
}
