// D-081 text verification (Route 1), development builds behind the password gate only.
//
// POST /api/dev/verify-text with JSON {"s": <surah>} fetches that surah's ayat from the Quran
// Foundation API (/verses/by_chapter/{s}?fields=text_qpc_hafs, 50 per page, with a pause between
// pages), hashes each ayah with SHA-256 and compares it with the hashes of RIFQ's approved file,
// which the build bundles as hashes only (no Quran text is in this route or its answer).
// The page (/dev/verify-text/) calls it one surah at a time, so one request stays far below the
// Workers subrequest limit and the API is never hit in a burst.
//
// Like for like (D-068): RIFQ's stored aya_text ends with a no-break space and the ayah number.
// For each ayah the build gives two hashes of the approved file's exact UTF-8 bytes:
//   full = the stored aya_text as is; bare = the same with that ending (U+00A0 and the digits) cut.
// The API string is hashed as UTF-8 exactly as decoded from its JSON, with no normalization.
// Each ayah is reported as:
//   same_with_number     API bytes = full
//   same_without_number  API bytes = bare (the API string has no ayah-number ending)
//   same_text_number_form  after cutting a trailing space or no-break space plus digits from the
//                        API string, it equals bare: same words, the number ending is written
//                        differently (reported separately; never counted as the same bytes)
//   differs              none of the above
//   missing              the API gave no text_qpc_hafs for this ayah
// Nothing is stored or logged. The answer holds references, categories and hashes only.
import { sha256Hex } from '../core/tafseer-fingerprints.ts';
import { parseVersesByChapter, QfClient, qfConfig, QPC_FIELD, QURAN_SCOPE, versesByChapterPath, type QfSecrets } from './qf.ts';

export type VerifyHashes = { counts: number[]; full: string[]; bare: string[] }; // in source order
export type VerifyRow = { ref: string; result: 'same_with_number' | 'same_without_number' | 'same_text_number_form' | 'differs' | 'missing'; api: string | null; full: string; bare: string };

// Proposal: 250 ms between pages inside one surah. The docs publish no rate limit, and the
// Developer Terms treat rate-limit values as confidential.
export const PAGE_PAUSE_MS = 250;
const NUMBER_END = /[ \u00a0][0-9\u0660-\u0669\u06f0-\u06f9]+$/u;

type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; pauseMs?: number; timeoutMs?: number };

export function makeVerify(h: VerifyHashes, devAllowed: boolean, deps: Deps = {}) {
  const qf = new QfClient(deps.fetch, deps.now, deps.timeoutMs);
  const offset: number[] = [0];
  for (let s = 1; s < h.counts.length; s++) offset[s] = offset[s - 1] + (h.counts[s - 1] ?? 0);

  async function surah(env: QfSecrets, s: number): Promise<{ status: number; data: Record<string, unknown> }> {
    if (!Number.isInteger(s) || s < 1 || s >= h.counts.length) return { status: 400, data: { status: 'bad_request' } };
    const q = qfConfig(env, devAllowed);
    if ('missing' in q) return { status: 503, data: { status: 'not_configured', missing: q.missing } };
    const got = new Map<string, string | null>();
    const extra: string[] = [];
    let page: number | null = 1, pages = 0;
    while (page !== null) {
      let r: ReturnType<typeof parseVersesByChapter>;
      try {
        r = parseVersesByChapter(await qf.get(q, versesByChapterPath(s), { fields: QPC_FIELD, per_page: '50', page: String(page), words: 'false' }, QURAN_SCOPE));
      } catch (e) {
        return { status: 503, data: { status: 'unavailable', kind: (e as { kind?: string }).kind ?? 'error', s } };
      }
      pages++;
      for (const it of r.items) got.set(it.verse_key, it.text);
      page = r.next;
      if (page !== null && pages >= 20) break; // never more than 20 pages for one surah
      if (page !== null) await new Promise((res) => setTimeout(res, deps.pauseMs ?? PAGE_PAUSE_MS));
    }
    const rows: VerifyRow[] = [];
    for (let a = 1; a <= h.counts[s]; a++) {
      const i = offset[s] + a - 1;
      const ref = `${s}:${a}`;
      const t = got.get(ref);
      got.delete(ref);
      if (typeof t !== 'string') { rows.push({ ref, result: 'missing', api: null, full: h.full[i], bare: h.bare[i] }); continue; }
      const api = await sha256Hex(t);
      let result: VerifyRow['result'] = 'differs';
      if (api === h.full[i]) result = 'same_with_number';
      else if (api === h.bare[i]) result = 'same_without_number';
      else if (NUMBER_END.test(t) && (await sha256Hex(t.replace(NUMBER_END, ''))) === h.bare[i]) result = 'same_text_number_form';
      rows.push({ ref, result, api, full: h.full[i], bare: h.bare[i] });
    }
    extra.push(...got.keys());
    return { status: 200, data: { status: 'ok', s, pages, rows, extra } };
  }
  return { surah, client: qf };
}
