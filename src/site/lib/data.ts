// Build-time data. It reads the source named by RIFQ_RECORD and runs the source gate again, so a
// release build cannot skip it. This module runs only at build time; nothing here ships to browsers
// except what the pages render.
import { juzStarts, loadSource, surahsOf } from '../../core/source-adapter.ts';
import { gate, type Mode } from '../../core/source-gate.ts';
import { juzOfAyah } from '../../core/recent.ts';
import { enKeys, foldName } from '../../core/surah-match.ts';

const recordPath = process.env.RIFQ_RECORD;
if (!recordPath) throw new Error('RIFQ_RECORD is not set. Run the build through scripts/build.ts.');
export const mode: Mode = process.env.RIFQ_MODE === 'release' ? 'release' : 'development';
const src = loadSource(recordPath);
const g = gate(mode, src.record, src.sha256);
if (!g.ok) throw new Error('Source gate failed: ' + g.reasons.join('; '));

export const dev = mode !== 'release';
// RQ-005: the Tafseer screen and the per-ayah Tafseer links exist only when the build flag is on.
export const tafseerOn = process.env.RIFQ_TAFSEER === 'on';
// RQ-006: the reader page player exists only when the build flag audio is on.
export const audioOn = process.env.RIFQ_AUDIO === 'on';
export const record = { name: src.record.name, edition: src.record.edition, status: src.record.status, sha256: src.sha256 as string };
export const surahs = surahsOf(src.list);
export const counts: number[] = [0, ...surahs.map((s) => s.items.length)];
export const names: [string, string][] = surahs.map((s) => [s.ar, s.en]);
// RQ-004 (D-090 D): the first ayah of each juz in the file, by juz number.
export const juz = juzStarts(src.list);
// RQ-008 AC11 (kit v37): the home continue card shows the juz of the saved ayah. Browsers get only
// the 30 juz starts above and work the juz out from them (src/core/recent.ts juzOfAyah). This is
// checked here against every ayah's own `jozz` in the file; if any differs, the card shows no juz.
export const juzByStartsOk = src.list.every((x) => !Number.isInteger(x.jozz) || juzOfAyah(juz, x.sora, x.aya_no) === x.jozz);
// RQ-008 Go to (kit v39): the search form of each Arabic name and the English match keys, as the
// surah index filter builds them (index 0 unused). Used for matching only, never displayed.
export const gotoFolded: string[] = ['', ...surahs.map((s) => foldName(s.ar))];
export const gotoEn: [string, string][] = [['', ''], ...surahs.map((s) => enKeys(s.en))];
