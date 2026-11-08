// D-079 helper for the review: prints fingerprint entries (no text) for passages a reviewer has
// just checked, ready to add to tafseer-fingerprints.json in the private data repository.
//   node scripts/tafseer-fingerprint.ts --tafsir-id <id> --refs 2:1,2:2 --reviewed YYYY-MM-DD
// Credentials come from the environment (QF_CLIENT_ID, QF_CLIENT_SECRET, QF_ENV) and are never
// printed. Each passage is fetched with the same request and parsing the Worker uses, hashed as
// delivered (UTF-8 bytes of `text`, no normalization), and dropped. The reviewer should run this
// right after reading the same passages in RIFQ, so the fingerprint is of the text they reviewed.
// Output: one JSON line per entry, or an error line naming the reference and the failure kind.
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/core/tafseer-fingerprints.ts';
import { byAyahPath, parseByAyah, QfClient, qfConfig, QfError, type QfSecrets } from '../src/worker/qf.ts';

export async function fingerprintEntries(env: QfSecrets, tafsirId: number, refs: string[], reviewed: string, fetchFn?: (u: string, i: RequestInit) => Promise<Response>, allowTestBase = false) {
  const q = qfConfig(env, allowTestBase);
  if ('missing' in q) throw new Error('missing settings: ' + q.missing.join(', '));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) throw new Error('--reviewed must be YYYY-MM-DD');
  const client = new QfClient(fetchFn);
  const out: ({ ref: string; tafsirId: number; sha256: string; reviewed: string } | { ref: string; error: string })[] = [];
  for (const ref of refs) {
    const m = /^(\d+):(\d+)$/.exec(ref);
    if (!m) { out.push({ ref, error: 'bad_ref' }); continue; }
    try {
      const p = parseByAyah(await client.get(q, byAyahPath(tafsirId, Number(m[1]), Number(m[2])), { fields: 'language_name' }), Number(m[1]), Number(m[2]));
      if (!p) { out.push({ ref, error: 'no_passage' }); continue; }
      out.push({ ref, tafsirId, sha256: await sha256Hex(p.text), reviewed });
    } catch (e) {
      out.push({ ref, error: e instanceof QfError ? e.kind : 'error' });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
  const rows = await fingerprintEntries(process.env as QfSecrets, Number(a('tafsir-id')), (a('refs') ?? '').split(',').filter(Boolean), a('reviewed') ?? '');
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(rows.every((r) => 'sha256' in r) ? 0 : 1);
}
