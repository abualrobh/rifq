// CLI for the source gate: node scripts/gate.ts <source-record.json> <release|development>
// Exit code 0 passes, 1 blocks. Output lists reasons only, never source text.
import { fileURLToPath } from 'node:url';
import { readRecord } from '../src/core/source-adapter.ts';
import { gate, type Mode } from '../src/core/source-gate.ts';

export function runGate(recordPath: string, mode: Mode) {
  let rec: unknown = null, sha: string | null = null;
  try { const l = readRecord(recordPath); rec = l.record; sha = l.sha256; } catch (e) { return { ok: false, reasons: ['record unreadable: ' + (e as Error).message] }; }
  return gate(mode, rec, sha);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [recordPath, mode] = process.argv.slice(2);
  const r = runGate(recordPath, mode as Mode);
  console.log(JSON.stringify({ mode, ok: r.ok, reasons: r.reasons }));
  process.exit(r.ok ? 0 : 1);
}
