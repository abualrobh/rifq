// Tafseer release check (RQ-005 AC15, D-078, D-079). scripts/build.ts runs it for any release build
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
//    the D-012 reviewer's check, Hamzeh's D-008 audit, and Quran Foundation's production approval
//    covering content.tafsirs.read. QF_ENV must be "production".
// 2. D-078 as changed by D-084: the quote check runs over every passage and its results are
//    reported (counts, and a reviewer list of the phrases it could not match to their own ayat),
//    but it never blocks a release. See src/core/tafseer-quotes.ts for the method and its limits.
//    The reviewer list holds the phrases as delivered, which are Tafseer text, so the --out file
//    is private: keep it in the private data area, never in the public repository.
// 3. D-079: every passage that has a fingerprint still matches it.
// 4. Every passage was fetched (no API error), and the fingerprint store is valid.
// A dry run (--mode dry-run) skips item 1, for testing against the mock. It is never release evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSource } from '../src/core/source-adapter.ts';
import { checkFingerprints, fingerprintMap, sha256Hex, type FingerprintFile } from '../src/core/tafseer-fingerprints.ts';
import { chapterPassages, checkPassage, indexFromSource, newSummary, type QuoteSummary, type ReviewItem } from '../src/core/tafseer-quotes.ts';
import { byChapterPath, parseByChapter, QfClient, qfConfig, QfError, SCOPE, type QfSecrets } from '../src/worker/qf.ts';

export type TafseerRecord = {
  format?: string;
  tafsirId?: number | null;
  d076?: { status?: string; date?: string } | null;
  approvedSourcesListed?: boolean;
  reviewerCheck?: { date?: string } | null;
  d008Audit?: { date?: string } | null;
  qfProductionApproval?: { date?: string; scopes?: string[] } | null;
  title?: string | null; author?: string | null; edition?: string | null; publisher?: string | null;
  quoteMarkers?: unknown;
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
  if (!DATE.test(r.reviewerCheck?.date ?? '')) out.push('D-012: the reviewer check is not recorded');
  if (!DATE.test(r.d008Audit?.date ?? '')) out.push("D-008: Hamzeh's audit is not recorded");
  if (!DATE.test(r.qfProductionApproval?.date ?? '') || !(r.qfProductionApproval?.scopes ?? []).includes(SCOPE)) out.push(`Quran Foundation production approval covering ${SCOPE} is not recorded`);
  if (env.QF_ENV !== 'production') out.push(`QF_ENV is "${env.QF_ENV ?? 'unset'}", not "production"`);
  return out;
}

export type CheckReport = {
  ok: boolean; mode: 'release' | 'dry-run'; reasons: string[];
  tafsirId: number | null; qfEnv: string | null; quranSha256: string;
  surahs: number; passages: number; passagesWithPhrases: number; quotes: QuoteSummary; reviewerList: ReviewItem[];
  fingerprints: { entries: number; checked: number; matched: number; changed: string[]; notReviewed: number };
  apiErrors: string[];
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
    apiErrors: [],
  };
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
  if (rep.fingerprints.changed.length) reasons.push(`D-079: ${rep.fingerprints.changed.length} passages changed since review`);
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
  process.exit(rep.ok ? 0 : 4);
}
