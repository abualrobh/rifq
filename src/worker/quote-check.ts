// D-084 quote check on one surah, for the private page /dev/quote-check/ (development builds behind
// the password gate only). POST /api/dev/quote-check with JSON {"s": <surah>} fetches the configured
// work's passages for that surah with /tafsirs/{TAFSIR_ID}/by_chapter/{s} (50 per page, a pause
// between pages, never more than 20 pages), runs src/core/tafseer-quotes.ts on each passage and
// returns the counts and the reviewer list. The approved Quran text is bundled by the build in
// letters-only form only (no displayed text). Nothing is stored or logged. The reviewer list holds
// the phrases as delivered, which are Tafseer text shown to Hamzeh inside the app; the page offers
// it as JSON or CSV made in the browser.
import { chapterPassages, checkPassage, newSummary, type ReviewItem } from '../core/tafseer-quotes.ts';
import { computeMarks } from '../core/tafseer-marks.ts';
import { makeLetters, type Letters, type LettersQuran } from './letters.ts';
import { byChapterPath, parseByChapter, QfClient, qfConfig, QfError, type QfSecrets } from './qf.ts';
import { PAGE_PAUSE_MS } from './verify.ts';

export type { LettersQuran } from './letters.ts';

type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; pauseMs?: number; timeoutMs?: number };

// AC31 (RQ-005 v1.1): the display marks of each passage are worked out here with the same index and
// the same code as /api/tafseer (computeMarks), so the page can show and compare them.
export function makeQuoteCheck(src: LettersQuran | Letters, devAllowed: boolean, deps: Deps = {}) {
  const qf = new QfClient(deps.fetch, deps.now, deps.timeoutMs);
  const L: Letters = 'index' in src ? src : makeLetters(src);
  const q = L.q;
  const index = () => L.index();

  // The configured work's passages for one surah, page by page (also used by the timing page).
  async function passages(env: QfSecrets & { TAFSIR_ID?: string }, s: number): Promise<{ status: number; data: Record<string, unknown> } | { id: number; pages: number; records: number; passages: ReturnType<typeof chapterPassages> }> {
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
    return { id, pages, records: items.length, passages: chapterPassages(items.filter((x) => x.verse_key.startsWith(`${s}:`))) };
  }

  async function surah(env: QfSecrets & { TAFSIR_ID?: string }, s: number): Promise<{ status: number; data: Record<string, unknown> }> {
    const got = await passages(env, s);
    if ('status' in got) return got;
    const { id, pages, records } = got;
    const sum = newSummary();
    const list: ReviewItem[] = [];
    const list2 = got.passages;
    // D-149 display classes per passage (the Worker's /api/tafseer marks), for AC31. A class letter
    // per phrase only. The work is Arabic here (D-077), so P-11 does not apply.
    const display: { ref: string; range: string; n: number; c: string }[] = [];
    const byClass = { O: 0, A: 0, P: 0, N: 0 };
    for (const p of list2) {
      const own = { s: p.s, from: p.from, to: p.to };
      checkPassage(index(), p.text, own, p.ref, sum, list);
      const m = computeMarks(index(), p.text, own, true);
      for (const ch of m.c) byClass[ch as keyof typeof byClass]++;
      display.push({ ref: p.ref, range: `${p.s}:${p.from}-${p.to}`, n: m.n, c: m.c });
    }
    return { status: 200, data: { status: 'ok', s, tafsirId: id, pages, records, passages: list2.length, summary: sum, list, display, displayCounts: byClass } };
  }
  return { surah, passages, letters: L, client: qf };
}
