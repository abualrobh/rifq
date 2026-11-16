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
//
// Kit v32 (FIND-AE, D-151 A, RQ-005 v1.1 AC27): the D-079 fingerprint check is reported here, not to
// readers. For every ayah a passage covers that has a fingerprint for this tafsir, the SHA-256 of the
// passage text as delivered by by_chapter is compared with it. A part answers with counts and the
// references that differ only (`fingerprints`), never with any text or hash.
// RQ-007 (kit v34): the same page can check the English work (TAFSIR_EN_ID), chosen with "w": "en"
// in the request. For it (AC17, AC37, D-137 A, D-150): only bracketed phrases written in Arabic
// letters (P-11) are matched and listed, exactly as checkPassage does for an Arabic work; phrases
// with no Arabic letters are only counted (`other`: by bracket, and how many are unclosed), never
// listed; no fingerprint is looked at (AC16); the display classes are the English marks
// (computeMarks with arabicWork false: "N" for a phrase with no Arabic letters). Its results are
// kept apart from the Arabic work's (tafsirId and lang in every answer, AC10). Without "w" (or with
// "ar") the page checks TAFSIR_ID exactly as in kit v33.
//
// Coverage (RQ-007 open questions 1 and 2, kit v34): coverage() reads the same small pages of the
// English work and answers per passage with numbers only: its ayah range, its length in characters,
// and how many bracketed phrases it has with and without Arabic letters (by bracket kind). No text
// and no hash of any text leaves this file.
import { chapterPassages, checkPassage, findPhrases, hasArabicLetters, newSummary, phraseMatcher, type Bracket, type QuoteSummary, type ReviewItem } from '../core/tafseer-quotes.ts';
import { classOf } from '../core/tafseer-marks.ts';
import { fingerprintMap, sha256Hex, type FingerprintFile } from '../core/tafseer-fingerprints.ts';
import { makeLetters, type Letters, type LettersQuran } from './letters.ts';
import { byChapterPath, parseByChapter, QfClient, qfConfig, QfError, type QfSecrets } from './qf.ts';
import { PAGE_PAUSE_MS } from './verify.ts';

export type { LettersQuran } from './letters.ts';

type Deps = { fetch?: (u: string, i: RequestInit) => Promise<Response>; now?: () => number; pauseMs?: number; timeoutMs?: number; fingerprints?: FingerprintFile | null };

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
  const prints = fingerprintMap(deps.fingerprints);
  type Err = { status: number; data: Record<string, unknown> };
  type Chunk = { id: number; page: number; fetched: number; records: number; passages: ReturnType<typeof chapterPassages>; next: { page: number; skip: number } | null };

  // One small page of the configured work's passages for one surah (also used by the timing page).
  // work "en" (RQ-007): the English work, TAFSIR_EN_ID.
  async function chunk(env: QfSecrets & { TAFSIR_ID?: string; TAFSIR_EN_ID?: string }, s: number, page = 1, skip = 0, work: Work = 'ar'): Promise<Err | Chunk> {
    if (!Number.isInteger(s) || s < 1 || s >= q.counts.length) return { status: 400, data: { status: 'bad_request' } };
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(skip) || skip < 0 || skip >= QC_PER_PAGE) return { status: 400, data: { status: 'bad_request' } };
    const c = qfConfig(env, devAllowed);
    const setting = work === 'en' ? 'TAFSIR_EN_ID' : 'TAFSIR_ID';
    const rawSetting = env[setting];
    const idRaw = typeof rawSetting === 'string' ? rawSetting.trim() : '';
    const id = /^[1-9][0-9]{0,8}$/.test(idRaw) ? Number(idRaw) : null;
    if ('missing' in c || id === null) return { status: 503, data: { status: 'not_configured', ...(work === 'en' ? { lang: 'en' } : {}), missing: [...('missing' in c ? c.missing : []), ...(id === null ? [setting] : [])] } };
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

  async function part(env: QfSecrets & { TAFSIR_ID?: string; TAFSIR_EN_ID?: string }, s: number, page = 1, skip = 0, work: Work = 'ar'): Promise<Err> {
    if (work === 'en') return partEn(env, s, page, skip);
    const got = await chunk(env, s, page, skip);
    if ('status' in got) return got;
    const sum = newSummary();
    const list: ReviewItem[] = [];
    // D-149 display classes per passage (the Worker's /api/tafseer marks), for AC31. A class letter
    // per phrase only. The work is Arabic here (D-077), so P-11 does not apply.
    const display: { ref: string; range: string; n: number; c: string }[] = [];
    const byClass = { O: 0, A: 0, P: 0, N: 0 };
    const ix = index();
    // D-079 change alarm (kit v32): counts and differing references only.
    const fp = { checked: 0, same: 0, differ: [] as string[] };
    for (const p of got.passages) {
      let hash: string | null = null;
      for (let a = p.from; a <= p.to; a++) {
        const e = prints.get(`${got.id}|${p.s}:${a}`);
        if (!e) continue;
        hash ??= await sha256Hex(p.text);
        fp.checked++;
        if (hash === e.sha256) fp.same++; else fp.differ.push(`${p.s}:${a}`);
      }
    }
    for (const p of got.passages) {
      let c = '';
      checkPassage(ix, p.text, { s: p.s, from: p.from, to: p.to }, p.ref, sum, list, (ph, result) => { c += classOf(result, ph, true); });
      for (const ch of c) byClass[ch as keyof typeof byClass]++;
      display.push({ ref: p.ref, range: `${p.s}:${p.from}-${p.to}`, n: c.length, c });
    }
    return { status: 200, data: { status: 'ok', s, tafsirId: got.id, page: got.page, pages: got.fetched, records: got.records, passages: got.passages.length, summary: sum, list, display, displayCounts: byClass, fingerprints: fp, next: got.next } };
  }
  // RQ-007 AC17, AC37: the English work. Arabic-letter phrases go through the same matcher and the
  // same listing rule as checkPassage; the rest are counted only.
  async function partEn(env: QfSecrets & { TAFSIR_EN_ID?: string }, s: number, page: number, skip: number): Promise<Err> {
    const got = await chunk(env, s, page, skip, 'en');
    if ('status' in got) return got;
    const sum = newSummary();
    const list: ReviewItem[] = [];
    const other = newOther();
    const display: { ref: string; range: string; n: number; c: string }[] = [];
    const byClass = { O: 0, A: 0, P: 0, N: 0 };
    const ix = index();
    for (const p of got.passages) {
      const c = checkPassageEn(ix, p.text, { s: p.s, from: p.from, to: p.to }, p.ref, sum, list, other);
      for (const ch of c) byClass[ch as keyof typeof byClass]++;
      display.push({ ref: p.ref, range: `${p.s}:${p.from}-${p.to}`, n: c.length, c });
    }
    return { status: 200, data: { status: 'ok', lang: 'en', s, tafsirId: got.id, page: got.page, pages: got.fetched, records: got.records, passages: got.passages.length, summary: sum, other, list, display, displayCounts: byClass, fingerprints: null, next: got.next } };
  }

  // Coverage of the English work (numbers only, no text, no hashes).
  async function coverage(env: QfSecrets & { TAFSIR_EN_ID?: string }, s: number, page = 1, skip = 0): Promise<Err> {
    const got = await chunk(env, s, page, skip, 'en');
    if ('status' in got) return got;
    const passages = got.passages.map((p) => {
      const ps = findPhrases(p.text);
      const ar = { '()': 0, '\ufd3f\ufd3e': 0, '{}': 0 } as Record<Bracket, number>, no = { '()': 0, '\ufd3f\ufd3e': 0, '{}': 0 } as Record<Bracket, number>;
      let unclosed = 0;
      for (const ph of ps) { (hasArabicLetters(ph.text) ? ar : no)[ph.bracket]++; if (ph.unclosed) unclosed++; }
      return {
        from: p.from, to: p.to,
        chars: [...p.text].length,
        arabicPhrases: ps.filter((x) => hasArabicLetters(x.text)).length,
        otherPhrases: ps.filter((x) => !hasArabicLetters(x.text)).length,
        arabicByBracket: { round: ar['()'], ornate: ar['\ufd3f\ufd3e'], curly: ar['{}'] },
        otherByBracket: { round: no['()'], ornate: no['\ufd3f\ufd3e'], curly: no['{}'] },
        unclosed,
        square: countChar(p.text, '['),
        hasArabicLetters: hasArabicLetters(p.text),
      };
    });
    return { status: 200, data: { status: 'ok', lang: 'en', s, tafsirId: got.id, page: got.page, pages: got.fetched, records: got.records, passages, next: got.next } };
  }
  return { part, chunk, coverage, letters: L, client: qf };
}

export type Work = 'ar' | 'en';
export type OtherCounts = { phrases: number; byBracket: { round: number; ornate: number; curly: number }; unclosed: number };
export const newOther = (): OtherCounts => ({ phrases: 0, byBracket: { round: 0, ornate: 0, curly: 0 }, unclosed: 0 });
const BRACKET_KEY: Record<Bracket, keyof OtherCounts['byBracket']> = { '()': 'round', '\ufd3f\ufd3e': 'ornate', '{}': 'curly' };
const countChar = (t: string, ch: string) => { let n = 0; for (let i = t.indexOf(ch); i >= 0; i = t.indexOf(ch, i + 1)) n++; return n; };

// One English passage: phrases with Arabic letters exactly as checkPassage handles every phrase
// (same matcher, counts and listing rule); the others counted in `other` only. Returns the display
// classes, one letter per phrase (equal to computeMarks(..., false), unit-tested).
export function checkPassageEn(ix: Parameters<typeof phraseMatcher>[0], html: string, own: { s: number; from: number; to: number }, ref: string, sum: QuoteSummary, list: ReviewItem[], other: OtherCounts): string {
  const matcher = phraseMatcher(ix, own);
  let c = '';
  for (const p of findPhrases(html)) {
    if (!hasArabicLetters(p.text)) {
      other.phrases++;
      other.byBracket[BRACKET_KEY[p.bracket]]++;
      if (p.unclosed) other.unclosed++;
      c += 'N';
      continue;
    }
    const m = matcher.match(p.text);
    c += classOf(m.result, p, false);
    sum.phrases++;
    sum.byResult[m.result]++;
    if (p.label === 'qiraah_or_quote') sum.braces++;
    if (p.unclosed) sum.unclosed++;
    if (m.match === 'edge') sum.edgeMatches++;
    const listed = p.label === 'qiraah_or_quote' || p.unclosed || (m.result !== 'matched_own_ayah' && m.result !== 'fragment');
    if (listed) list.push({ ref, range: `${own.s}:${own.from}-${own.to}`, bracket: p.bracket, label: p.label, phrase: p.text, letters: m.letters, result: m.result, form: m.form, match: m.match, ...(p.unclosed ? { unclosed: true } : {}) });
  }
  return c;
}
