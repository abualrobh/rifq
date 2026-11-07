// Writes the D-079 fingerprint store used by the e2e build: one entry that matches the mock's
// passage (2:14, reviewed 2026-11-01) and one made from an older mock version (2:13, reviewed
// 2026-11-02), so the screen shows the "updated since review" notice. Made-up data, hashes only.
//   node test/mock/make-e2e-fingerprints.ts <out.json>
import { writeFileSync } from 'node:fs';
import { sha256Hex, FINGERPRINT_FORMAT } from '../../src/core/tafseer-fingerprints.ts';
import { CASE, MOCK_TAFSIR_ID, passageText } from './qf-mock.ts';

const entries = [
  { ref: `2:${CASE.reviewed}`, tafsirId: MOCK_TAFSIR_ID, sha256: await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.reviewed)!), reviewed: '2026-11-01' },
  { ref: `2:${CASE.changed}`, tafsirId: MOCK_TAFSIR_ID, sha256: await sha256Hex(passageText(MOCK_TAFSIR_ID, 2, CASE.changed, undefined, 1)!), reviewed: '2026-11-02' },
];
writeFileSync(process.argv[2], JSON.stringify({ format: FINGERPRINT_FORMAT, entries }, null, 2) + '\n');
console.log(JSON.stringify({ entries: entries.length }));
