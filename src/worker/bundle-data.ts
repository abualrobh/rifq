// Kit v32: joins the Worker config (worker-config.json) and the Worker's binary data module
// (worker-data.bin, see src/core/worker-data.ts) when the Worker starts. Generated entry files
// (scripts/build.ts) call it once at startup, before makeWorker. If the config expects data the
// module does not hold, it throws, so the Worker does not start (fail closed): it never runs
// with an empty matching index or without the D-081 hashes.
// Kit v33 (D-169 A): first, the module must be the one this Worker was built with (build ID, size
// and section table in the config's `workerData`, src/core/worker-data-stamp.ts); otherwise it
// throws too, so a module from another build, or with a section missing or changed, never serves.
import { decodeWorkerData } from '../core/worker-data.ts';
import { checkWorkerDataStamp, type WorkerDataStamp } from '../core/worker-data-stamp.ts';
import type { WorkerCfg } from './app.ts';

export function withWorkerData(cfgIn: WorkerCfg & { workerData?: WorkerDataStamp }, buf: ArrayBuffer): WorkerCfg {
  const { workerData, ...cfg } = cfgIn;
  checkWorkerDataStamp(buf, workerData);
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
