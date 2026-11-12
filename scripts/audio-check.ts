// RQ-006 AC52: the recorded check of the D-111 reciters, run by Hamzeh (or on his instruction) with
// RIFQ's own Quran Foundation credentials, never at page load. For each D-111 reciter it checks the
// chapter-reciter catalogue entry (AC59) and every surah the environment covers: all 114 in
// production (AC12, AC60, AC61). A reciter passes only if every surah passes (D-119 A, D-122 A).
//   QF_CLIENT_ID=... QF_CLIENT_SECRET=... QF_ENV=production \
//   node scripts/audio-check.ts --record <source-record.json> --out <audio-check.json> [--report <report.json>]
// --out gets the record the build reads (--audio-record): environment, date and the passing IDs
// only. --report gets the per-reciter, per-surah results for Hamzeh (problems and counts only; no
// address, timing or audio). Neither file holds audio or audio metadata (AC35). Nothing is logged
// except counts. 7 reciters x 114 surahs is up to 799 API calls in one run.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSource, surahsOf } from '../src/core/source-adapter.ts';
import { catalogueProblems, coveredSurahs, D111_IDS } from '../src/core/audio.ts';
import { makeAudio, parseCatalogue, type AudioRecord } from '../src/worker/audio.ts';
import { qfConfig, type QfSecrets } from '../src/worker/qf.ts';

type Deps = Parameters<typeof makeAudio>[1];
export type AudioReport = { env: string; checked: string; reciters: { id: number; catalogue: string[]; failed: { s: number; problems: string[] }[]; negatives: number; passed: boolean }[] };

export async function runAudioCheck(env: QfSecrets, counts: number[], deps: Deps = {}, allowTestBase = false, today = new Date().toISOString().slice(0, 10)): Promise<{ record: AudioRecord; report: AudioReport }> {
  const q = qfConfig(env, allowTestBase);
  if ('missing' in q) throw new Error('missing settings: ' + q.missing.join(', '));
  const a = makeAudio({ dev: allowTestBase, counts }, { ...deps, cache: () => null });
  const origin = 'https://audio-check.invalid';
  const cat = parseCatalogue(await a.client.get(q, '/resources/chapter_reciters', { language: 'en' }, 'content.audio.read'));
  const report: AudioReport = { env: q.env, checked: today, reciters: [] };
  for (const id of D111_IDS) {
    const catalogue = catalogueProblems(id, cat.find((x) => x.id === id));
    const failed: { s: number; problems: string[] }[] = [];
    let negatives = 0;
    if (!catalogue.length) {
      for (const s of coveredSurahs(q.env)) {
        const c = await a.surahFile(origin, q, id, s);
        negatives += c.negatives;
        if (!c.ok) failed.push({ s, problems: c.problems });
      }
    }
    report.reciters.push({ id, catalogue, failed, negatives, passed: !catalogue.length && !failed.length });
  }
  return { record: { format: 'rifq-audio-check/1', env: q.env, checked: today, passed: report.reciters.filter((r) => r.passed).map((r) => r.id) }, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n: string) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const rec = arg('record'), out = arg('out');
  if (!rec || !out) throw new Error('usage: --record <source-record.json> --out <audio-check.json> [--report <file>]');
  const counts = [0, ...surahsOf(loadSource(rec).list).map((s) => s.items.length)];
  const { record, report } = await runAudioCheck(process.env as QfSecrets, counts);
  writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  const rp = arg('report');
  if (rp) writeFileSync(rp, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ env: record.env, passed: record.passed, failedReciters: report.reciters.filter((r) => !r.passed).length }));
}
