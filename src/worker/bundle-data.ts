// Kit v32: joins the Worker config (worker-config.json) and the Worker's binary data module
// (worker-data.bin, see src/core/worker-data.ts) when the Worker starts. Generated entry files
// (scripts/build.ts) call it once at startup, before makeWorker. If the config expects data the
// module does not hold, it throws, so the Worker does not start (fail closed): it never runs
// with an empty matching index or without the D-081 hashes.
import { decodeWorkerData } from '../core/worker-data.ts';
import type { WorkerCfg } from './app.ts';

export function withWorkerData(cfg: WorkerCfg, buf: ArrayBuffer): WorkerCfg {
  const d = decodeWorkerData(buf);
  const out: WorkerCfg = { ...cfg };
  const lq = cfg.lettersQuran;
  if (lq && !lq.packed && !lq.letters) {
    if (!d.letters) throw new Error('worker data: letters expected');
    out.lettersQuran = { ...lq, packed: d.letters };
  }
  const vh = cfg.verifyHashes as (Partial<NonNullable<WorkerCfg['verifyHashes']>> & { counts: number[] }) | undefined;
  if (vh && (!vh.full || !vh.bare)) {
    if (!d.hashes) throw new Error('worker data: hashes expected');
    out.verifyHashes = { counts: vh.counts, full: d.hashes.full, bare: d.hashes.bare };
  }
  return out;
}
