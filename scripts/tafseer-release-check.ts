// Tafseer release check (RQ-005 AC15, D-078, D-079, D-168 A). scripts/build.ts runs it for any release build
// with Tafseer on, and the build fails unless it passes. It can also be run alone:
//   node scripts/tafseer-release-check.ts --record <quran source-record.json>
//        --tafseer-record <tafseer-record.json> --fingerprints <tafseer-fingerprints.json>
//        --out <report.json> [--mode release|dry-run] [--surahs 1,2]
// Credentials come from the environment (QF_CLIENT_ID, QF_CLIENT_SECRET, QF_ENV), never from
// arguments or files, and are never printed. Passages are fetched from the API, held in memory for
// the check only, and never written anywhere: the report holds references, positions, lengths and
// hashes only, never Tafseer or Quran text.
//
// Release mode fails unless all of these hold:
// 1. AC15 records (tafseer-record.json, kept in the private data repository and filled in by
//    Hamzeh): D-076 approved with the tafsir ID, the work listed as approved in approved-sources.md,
//    Hamzeh's D-008 audit, and Quran Foundation's production approval covering
//    content.tafsirs.read. QF_ENV must be "production". No D-012 reviewer check is required for
//    Tafseer (D-146, D-168 A); a reviewerCheck field in the record is ignored.
// 2. D-078 as changed by D-084: the quote check runs over every passage and its results are
//    reported (counts, and a reviewer list of the phrases it could not match to their own ayat),
//    but it never blocks a release. See src/core/tafseer-quotes.ts for the method and its limits.
//    The reviewer list holds the phrases as delivered, which are Tafseer text, so the --out file
//    is private: keep it in the private data area, never in the public repository.
// 3. Every passage was fetched (no API error), and the fingerprint store is valid.
// D-079 fingerprints are a change alarm only (D-151 A, D-168 A): a passage whose text differs from
// its recorded fingerprint is reported (count and "S:A" references in `notices` and
// `fingerprints.changed`, never text or hashes) but never fails the check or a release build.
// A dry run (--mode dry-run) skips item 1, for testing against the mock. It is never release evidence.
//
// English part (RQ-007 AC18, kit v34), reported in `english`, independent of the Arabic part: it
// fails unless the record's `english` section holds the production ID of the D-136 work with its
// name, author, slug and language ("english"), that work listed as approved in approved-sources.md,
// and QF's production approval covering content.tafsirs.read from the request that names English
// Tafseer (D-144 A). In release mode the production catalogue (/resources/tafsirs) is read and must
// list that ID with the same name, author, slug and language. It does not require a D-012 review
// (D-139, D-146), a D-008 audit (D-147), fingerprints (D-138 C) or any quote-check result (D-150),
// and it fetches no English passage. The Arabic result (`ok`, `reasons`) is computed exactly as in
// kit v33 and never looks at the English part; `english.ok` never looks at the Arabic part.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSource } from '../src/core/source-adapter.ts';
import { checkFingerprints, fingerprintMap, sha256Hex, type FingerprintFile } from '../src/core/tafseer-fingerprints.ts';
import { chapterPassages, checkPassage, indexFromSource, newSummary, type QuoteSummary, type ReviewItem } from '../src/core/tafseer-quotes.ts';
import { byChapterPath, LIST_PATH, parseByChapter, parseTafsirList, QfClient, qfConfig, QfError, SCOPE, type QfSecrets, type TafsirListItem } from '../src/worker/qf.ts';

export type TafseerRecord = {
  format?: string;
  tafsirId?: number | null;
  d076?: { status?: string; date?: string } | null;
  approvedSourcesListed?: boolean;
  reviewerCheck?: { date?: string } | null; // ignored since D-168 A (D-146: no reviewer step for Tafseer)
  d008Audit?: { date?: string } | null;
  qfProductionApproval?: { date?: string; scopes?: string[] } | null;
  title?: string | null; author?: string | null; edition?: string | null; publisher?: string | null;
  quoteMarkers?: unknown;
  // RQ-007 AC18: the English part, filled in by Hamzeh only.
  english?: TafseerEnRecord | null;
};
export type TafseerEnRecord = {
  tafsirId?: number | null; name?: string | null; author?: string | null; slug?: string | null; language?: string | null;
  approvedSourcesListed?: boolean;
  qfProductionApproval?: { date?: string; scopes?: string[]; namesEnglishTafseer?: boolean } | null;
  // AC14 source fields that the API does not give (D-140 C). Never filled in by an agent.
  edition?: string | null; publisher?: string | null; translator?: string | null; abridgement?: string | null; original?: string | null;
};
export const TAFSEER_RECORD_FORMAT = 'rifq-tafseer-record/1';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// AC15. Returns the reasons a release is not allowed (empty when allowed).
export function releaseRecordProblems(r: TafseerRecord | null, env: QfSecrets): string[] {
  const out: string[] = [];
  if (!r || typeof r !== 'object') return ['tafseer record missing', ...(env.QF_ENV !== 'production' ? [`QF_ENV is "${env.QF_ENV ?? 'unset'}", not "production"`] : [])];
  if (r.format !== TAFSEER_RECORD_FORMAT) out.push(`tafseer record format must be "${TAFSEER_RECORD_FORMAT}"`);
  if (!Number.isInteger(r.tafsirId) || (r.tafsirId as number) < 1) out.push('D-076: no tafsir ID recorded');
  if (r.d076?.status !== 'approved' || !DATE.test(r.d076?.date ?? '')) out.push('D-076: not recorded as approved with a date');
  if (r.approvedSourcesListed !== true) out.push('approved-sources.md: the work is not recorded as listed as approved');
  if (!DATE.test(r.d008Audit?.date ?? '')) out.push("D-008: Hamzeh's audit is not recorded");
  if (!DATE.test(r.qfProductionApproval?.date ?? '') || !(r.qfProductionApproval?.scopes ?? []).includes(SCOPE)) out.push(`Quran Foundation production approval covering ${SCOPE} is not recorded`);
  if (env.QF_ENV !== 'production') out.push(`QF_ENV is "${env.QF_ENV ?? 'unset'}", not "production"`);
  return out;
}

// RQ-007 AC18: the reasons the English part may not be released (empty when it may).
export function englishRecordProblems(r: TafseerRecord | null, env: QfSecrets): string[] {
  const e = r && typeof r === 'object' ? r.english : null;
  const out: string[] = [];
  if (!e || typeof e !== 'object') out.push('English: no English part in the tafseer record');
  else {
    const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
    if (!Number.isInteger(e.tafsirId) || (e.tafsirId as number) < 1) out.push('English: no production ID of the D-136 work recorded');
    if (!nonEmpty(e.name)) out.push('English: the work\'s name from the production catalogue is not recorded');
    if (!nonEmpty(e.author)) out.push('English: the work\'s author from the production catalogue is not recorded');
    if (!nonEmpty(e.slug)) out.push('English: the work\'s slug from the production catalogue is not recorded');
    if (typeof e.language !== 'string' || e.language.trim().toLowerCase() !== 'english') out.push('English: the work\'s language is not recorded as "english"');
    if (e.approvedSourcesListed !== true) out.push('English: approved-sources.md: the work is not recorded as listed as approved');
    const a = e.qfProductionApproval;
    if (!DATE.test(a?.date ?? '') || !(a?.scopes ?? []).includes(SCOPE) || a?.namesEnglishTafseer !== true) out.push(`English: Quran Foundation production approval covering ${SCOPE}, from the request that names English Tafseer (D-144 A), is not recorded`);
  }
  if (env.QF_ENV !== 'production') out.push(`English: QF_ENV is "${env.QF_ENV ?? 'unset'}", not "production"`);
  return out;
}

// RQ-007 AC18: the recorded English entry against the production catalogue (release mode only).
export async function englishCatalogueProblems(e: TafseerEnRecord, env: QfSecrets, fetchFn?: (u: string, i: RequestInit) => Promise<Response>): Promise<string[]> {
  const q = qfConfig(env, false);
  if ('missing' in q) return ['English: Quran Foundation settings missing: ' + q.missing.join(', ')];
  let list: TafsirListItem[];
  try { list = parseTafsirList(await new QfClient(fetchFn).get(q, LIST_PATH)); } catch (x) { return [`English: the production catalogue could not be read (${x instanceof QfError ? x.kind : 'error'})`]; }
  const it = list.find((x) => x.id === e.tafsirId);
  if (!it) return [`English: ID ${e.tafsirId} is not in the production catalogue`];
  const out: string[] = [];
  for (const [k, want, got] of [['name', e.name, it.name], ['author', e.author, it.author_name], ['slug', e.slug, it.slug], ['language', e.language, it.language_name]] as const) {
    if (want !== got) out.push(`English: the recorded ${k} differs from the production catalogue's`);
  }
  return out;
}

export type EnglishPart = { ok: boolean; reasons: string[]; tafsirId: number | null };

export type CheckReport = {
  ok: boolean; mode: 'release' | 'dry-run'; reasons: string[];
  tafsirId: number | null; qfEnv: string | null; quranSha256: string;
  surahs: number; passages: number; passagesWithPhrases: number; quotes: QuoteSummary; reviewerList: ReviewItem[];
  fingerprints: { entries: number; checked: number; matched: number; changed: string[]; notReviewed: number };
  apiErrors: string[];
  // Reported, never blocking (D-168 A): counts and "S:A" references only.
  notices: string[];
  // RQ-007 AC18: the English part, independent of `ok` (the Arabic part).
  english: EnglishPart;
};

export async function runTafseerCheck(opts: {
  recordPath: string; record: TafseerRecord | null; fingerprints: FingerprintFile | null; env: QfSecrets;
  mode: 'release' | 'dry-run'; surahs?: number[]; fetch?: (u: string, i: RequestInit) => Promise<Response>; delayMs?: number;
}): Promise<CheckReport> {
  const src = loadSource(opts.recordPath);
  const counts = [0];
  for (const a of src.list) counts[a.sora] = a.aya_no;
  const reasons = opts.mode === 'release' ? releaseRecordProblems(opts.record, opts.env) : [];
  const fpProblems = opts.fingerprints ? checkFingerprints(opts.fingerprints, counts) : ['fingerprint store missing'];
  reasons.push(...fpProblems.map((p) => 'fingerprints: ' + p));
  const tafsirId = Number.isInteger(opts.record?.tafsirId) ? (opts.record!.tafsirId as number) : null;
  const rep: CheckReport = {
    ok: false, mode: opts.mode, reasons, tafsirId, qfEnv: opts.env.QF_ENV ?? null, quranSha256: src.sha256 as string,
    surahs: 0, passages: 0, passagesWithPhrases: 0, quotes: newSummary(), reviewerList: [],
    fingerprints: { entries: opts.fingerprints?.entries.length ?? 0, checked: 0, matched: 0, changed: [], notReviewed: 0 },
    apiErrors: [], notices: [],
    english: { ok: false, reasons: [], tafsirId: null },
  };
  // RQ-007 AC18: the English part first, on its own (it never adds to `reasons`).
  {
    const e = opts.record?.english ?? null;
    const er = opts.mode === 'release' ? englishRecordProblems(opts.record, opts.env) : [];
    if (opts.mode === 'release' && !er.length && e) er.push(...await englishCatalogueProblems(e, opts.env, opts.fetch));
    if (opts.mode !== 'release') er.push('English: dry run, never release evidence');
    rep.english = { ok: er.length === 0, reasons: er, tafsirId: Number.isInteger(e?.tafsirId) ? (e!.tafsirId as number) : null };
  }
  const q = qfConfig(opts.env, opts.mode === 'dry-run');
  if ('missing' in q) { reasons.push('Quran Foundation settings missing: ' + q.missing.join(', ')); return rep; }
  if (tafsirId === null) { reasons.push('no tafsir ID to check'); return rep; }
  const client = new QfClient(opts.fetch);
  const ix = indexFromSource(src.list);
  const prints = fingerprintMap(opts.fingerprints);
  const surahs = opts.surahs ?? Array.from({ length: counts.length - 1 }, (_, i) => i + 1);
  for (const s of surahs) {
    rep.surahs++;
    const items: { verse_key: string; text: string }[] = [];
    let page: number | null = 1;
    while (page !== null) {
      let got: ReturnType<typeof parseByChapter>;
      try {
        got = parseByChapter(await client.get(q, byChapterPath(tafsirId, s), { page: String(page), per_page: '50', fields: 'verse_key' }));
      } catch (e) {
        rep.apiErrors.push(`surah ${s} page ${page}: ${e instanceof QfError ? e.kind : 'error'}`);
        break;
      }
      items.push(...got.items);
      page = got.next;
      if (page !== null && opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.verse_key)) continue;
      seen.add(it.verse_key);
      rep.passages++;
      const e = prints.get(`${tafsirId}|${it.verse_key}`);
      if (e) {
        rep.fingerprints.checked++;
        if ((await sha256Hex(it.text)) === e.sha256) rep.fingerprints.matched++;
        else rep.fingerprints.changed.push(it.verse_key);
      } else rep.fingerprints.notReviewed++;
    }
    for (const p of chapterPassages(items)) {
      const before = rep.quotes.phrases;
      checkPassage(ix, p.text, { s: p.s, from: p.from, to: p.to }, p.ref, rep.quotes, rep.reviewerList);
      if (rep.quotes.phrases > before) rep.passagesWithPhrases++;
    }
  }
  if (rep.apiErrors.length) reasons.push(`${rep.apiErrors.length} API errors: not every passage was checked`);
  // D-168 A: a fingerprint mismatch is reported only; it never adds a reason.
  if (rep.fingerprints.changed.length) rep.notices.push(`D-079: ${rep.fingerprints.changed.length} of ${rep.fingerprints.checked} passages differ from their recorded fingerprint (change alarm only, not blocking): ${rep.fingerprints.changed.join(', ')}`);
  rep.ok = reasons.length === 0;
  return rep;
}

export function readJson<T>(p: string | undefined): T | null {
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
  const mode = a('mode') === 'dry-run' ? 'dry-run' : 'release';
  const rep = await runTafseerCheck({
    recordPath: a('record')!, record: readJson<TafseerRecord>(a('tafseer-record')), fingerprints: readJson<FingerprintFile>(a('fingerprints')),
    env: process.env as QfSecrets, mode, surahs: a('surahs')?.split(',').map(Number), delayMs: Number(a('delay-ms') ?? '250'),
  });
  if (a('out')) writeFileSync(a('out')!, JSON.stringify(rep, null, 2));
  // The console gets counts only: the reviewer list holds Tafseer phrases and goes to --out.
  const { reviewerList, ...short } = rep;
  console.log(JSON.stringify({ ...short, reviewerList: reviewerList.length }));
  // RQ-007 AC18: each part on its own; the run passes when at least one part may be released.
  process.exit(rep.ok || rep.english.ok ? 0 : 4);
}
