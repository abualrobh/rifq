// Build-time data. It reads the source named by RIFQ_RECORD and runs the source gate again, so a
// release build cannot skip it. This module runs only at build time; nothing here ships to browsers
// except what the pages render.
import { juzStarts, loadSource, surahsOf } from '../../core/source-adapter.ts';
import { gate, type Mode } from '../../core/source-gate.ts';

const recordPath = process.env.RIFQ_RECORD;
if (!recordPath) throw new Error('RIFQ_RECORD is not set. Run the build through scripts/build.ts.');
export const mode: Mode = process.env.RIFQ_MODE === 'release' ? 'release' : 'development';
const src = loadSource(recordPath);
const g = gate(mode, src.record, src.sha256);
if (!g.ok) throw new Error('Source gate failed: ' + g.reasons.join('; '));

export const dev = mode !== 'release';
// RQ-005: the Tafseer screen and the per-ayah Tafseer links exist only when the build flag is on.
export const tafseerOn = process.env.RIFQ_TAFSEER === 'on';
export const record = { name: src.record.name, edition: src.record.edition, status: src.record.status, sha256: src.sha256 as string };
export const surahs = surahsOf(src.list);
export const counts: number[] = [0, ...surahs.map((s) => s.items.length)];
export const names: [string, string][] = surahs.map((s) => [s.ar, s.en]);
// RQ-004 (D-090 D): the first ayah of each juz in the file, by juz number.
export const juz = juzStarts(src.list);
