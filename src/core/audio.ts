// RQ-006 v1.1 "Listen to the Quran" (D-110 to D-124): the rules that decide which reciters are
// offered and which surah files may play. Shared by the Worker (src/worker/audio.ts), the recorded
// check script (scripts/audio-check.ts) and the player. No audio, no Quran text, no reciter data
// from Quran Foundation is held here: only the D-111 IDs and the rules from the requirement.

// D-112 B, AC33, AC39, AC56: the one audio host seen in pre-live (12 Nov). Any other host, a
// look-alike or another subdomain is refused, and audio does not ship from it until Hamzeh approves.
export const AUDIO_HOST = 'download.quranicaudio.com';
export const AUDIO_ORIGIN = `https://${AUDIO_HOST}`;

// D-111, in its order; Mishary Rashid Alafasy (7) is the default (AC17). `key` is how the expected
// reciter is recognised in the catalogue's English `name` (AC59): a part of the surname from D-111,
// compared after folding (no case, marks or punctuation), because Quran Foundation spells names its
// own way (for example "Mishari Rashid al-`Afasy"). Only these IDs are ever looked up; no other ID
// is substituted for a D-111 reciter (AC59: not 12 "Muallim", not 173 "Streaming").
export const D111 = [
  { id: 7, key: /afasy/ },
  { id: 2, key: /basit/ },
  { id: 6, key: /husary/ },
  { id: 9, key: /minshawi/ },
  { id: 4, key: /shatri/ },
  { id: 97, key: /dossari|dosari/ },
  { id: 161, key: /tunaiji|tunaji/ },
] as const;
export const D111_IDS: readonly number[] = D111.map((x) => x.id);
export const DEFAULT_RECITER = 7;

export const foldLatin = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

// One catalogue entry, as the Worker reads it from /resources/chapter_reciters.
export type CatalogueEntry = { id: number; name: string | null; style: string | null; qirat: string | null; translated: string | null; translatedLang: string | null };

// AC59 and D-118: listed, with the expected name, style Murattal and qirat Hafs. Returns the
// reasons a D-111 reciter is not offered, or [] when the catalogue entry passes.
export function catalogueProblems(id: number, entry: CatalogueEntry | undefined): string[] {
  const d = D111.find((x) => x.id === id);
  if (!d) return ['not a D-111 reciter'];
  if (!entry) return ['not in this account\'s chapter-reciter list'];
  const out: string[] = [];
  if (!entry.name || !d.key.test(foldLatin(entry.name))) out.push('name does not match D-111');
  if (!entry.style || entry.style.trim().toLowerCase() !== 'murattal') out.push('style is not Murattal');
  if (!entry.qirat || entry.qirat.trim().toLowerCase() !== 'hafs') out.push('qirat is not Hafs');
  return out;
}

export const DURATION_ROUNDING_MS = 1000;
const isWholeMs = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// AC12 and AC60: every ayah has exactly one entry, in order, each from < to, no overlap (a gap is
// allowed), whole milliseconds, and the last end not after the file's duration. The per-entry
// `duration` field is not used; negative values are only counted for Hamzeh.
export type TimingResult = { ok: boolean; problems: string[]; negatives: number; t: [number, number][] };
export function checkTimestamps(ts: unknown, s: number, ayat: number, fileDuration: number | null): TimingResult {
  const problems: string[] = [];
  const t: [number, number][] = [];
  let negatives = 0;
  if (!Array.isArray(ts)) return { ok: false, problems: ['no timestamps'], negatives, t };
  if (ts.length !== ayat) problems.push(`${ts.length} entries for ${ayat} ayat`);
  let prevTo = 0;
  ts.forEach((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (o.verse_key !== `${s}:${i + 1}`) problems.push(`entry ${i + 1}: verse key is not ${s}:${i + 1}`);
    const from = o.timestamp_from, to = o.timestamp_to;
    if (typeof o.duration === 'number' && o.duration < 0) negatives++;
    if (!isWholeMs(from) || !isWholeMs(to)) { problems.push(`entry ${i + 1}: start or end is not a whole number of ms (${typeof from} ${String(from).slice(0, 12)}, ${typeof to} ${String(to).slice(0, 12)})`); return; }
    if (from >= to) problems.push(`entry ${i + 1}: start is not before end`);
    if (from < prevTo) problems.push(`entry ${i + 1}: starts before the previous one ends`);
    prevTo = to;
    t.push([from, to]);
  });
  if (fileDuration !== null && t.length) {
    const over = t[t.length - 1][1] - fileDuration;
    // Deviation from the AC60 wording, for Hamzeh's approval (kit v23): Quran Foundation's pre-live
    // durations are whole seconds (46000, 7264000 ms), so the last ayah's end can pass them by less
    // than a second. When the duration is a whole number of seconds, an overrun under 1000 ms is
    // taken as that rounding; any other overrun fails as AC60 says.
    const rounded = fileDuration % DURATION_ROUNDING_MS === 0;
    if (over > 0 && !(rounded && over < DURATION_ROUNDING_MS)) problems.push(`last entry ends after the file (by ${over} ms; duration ${fileDuration} ms)`);
  }
  return { ok: problems.length === 0, problems: problems.slice(0, 10), negatives, t };
}

// AC61 and P-7 (D-123): mp3, whole-byte file_size, whole-ms duration above zero, and an average
// bitrate of 32 to 320 kbit/s.
export const MIN_KBPS = 32;
export const MAX_KBPS = 320;
export function fileProblems(format: unknown, fileSize: unknown, duration: unknown): string[] {
  const out: string[] = [];
  if (typeof format !== 'string' || format.trim().toLowerCase() !== 'mp3') out.push('format is not mp3');
  const sizeOk = typeof fileSize === 'number' && Number.isInteger(fileSize) && fileSize > 0;
  const durOk = typeof duration === 'number' && Number.isInteger(duration) && duration > 0;
  if (!sizeOk) out.push('file_size is not a whole number of bytes');
  if (!durOk) out.push('duration is not a whole number of ms above zero');
  if (sizeOk && durOk) {
    const kbps = ((fileSize as number) * 8) / ((duration as number) / 1000) / 1000;
    if (kbps < MIN_KBPS || kbps > MAX_KBPS) out.push(`average bitrate ${Math.round(kbps)} kbit/s is outside ${MIN_KBPS} to ${MAX_KBPS}`);
  }
  return out;
}

// AC56: the file address is used only if it is https on exactly the approved host. A relative
// address is resolved against that host only. The address is otherwise kept exactly as given.
export function approvedAudioUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u || u.length > 2048) return null;
  let p: URL;
  try { p = new URL(u, AUDIO_ORIGIN + '/'); } catch { return null; }
  if (p.protocol !== 'https:' || p.hostname !== AUDIO_HOST || p.port !== '' || p.username || p.password) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : p.href;
}

// The whole check for one surah file answer (audio_file), as the Worker and the recorded check use
// it. `play` is what the browser needs (AC34): the address, the duration and the timings.
export type SurahCheck = { ok: boolean; problems: string[]; negatives: number; play: { url: string; duration: number; t: [number, number][] } | null; shape?: FileShape };

// The shape of one surah-file answer, for the /dev/reciters/ record (D-125 B fixtures): types,
// counts, the first and last [from, to], and the address path with the surah number written as
// {s}. Never the query string (it may carry a signature), Quran text, word segments or audio.
export type FileShape = {
  keys: string[]; format: unknown; fileSize: unknown; duration: unknown; types: Record<string, string>;
  urlPath: string | null; urlHasQuery: boolean; entries: number | null; entryKeys: string[];
  first: [unknown, unknown] | null; last: [unknown, unknown] | null; lastEndMinusDuration: number | null;
};
export function fileShape(f: Record<string, unknown>, s: number): FileShape {
  const ts = Array.isArray(f.timestamps) ? (f.timestamps as Record<string, unknown>[]) : null;
  let urlPath: string | null = null, urlHasQuery = false;
  if (typeof f.audio_url === 'string') {
    try {
      const p = new URL(f.audio_url, AUDIO_ORIGIN + '/');
      // The surah number in a segment, plain or zero-padded to 3 digits, is written as {s}.
      const n = String(s), n3 = n.padStart(3, '0');
      const seg = (x: string) => x.replace(new RegExp(`^(?:${n3}|${n})(?=\\.|$)`), '{s}');
      urlPath = `${p.protocol}//${p.host}${p.pathname.split('/').map(seg).join('/')}`;
      urlHasQuery = p.search.length > 1;
    } catch { urlPath = 'not a URL'; }
  }
  const pair = (e: Record<string, unknown> | undefined): [unknown, unknown] | null => (e ? [e.timestamp_from, e.timestamp_to] : null);
  const lastTo = ts && ts.length ? ts[ts.length - 1].timestamp_to : null;
  return {
    keys: Object.keys(f).sort(), format: f.format, fileSize: f.file_size, duration: f.duration,
    types: Object.fromEntries(['file_size', 'duration', 'audio_url', 'timestamps'].map((k) => [k, f[k] === null ? 'null' : Array.isArray(f[k]) ? 'array' : typeof f[k]])),
    urlPath, urlHasQuery, entries: ts ? ts.length : null,
    entryKeys: ts && ts.length ? Object.keys(ts[0]).sort() : [],
    first: pair(ts?.[0]), last: pair(ts?.[ts.length - 1]),
    lastEndMinusDuration: typeof lastTo === 'number' && typeof f.duration === 'number' ? lastTo - f.duration : null,
  };
}

export function checkSurahFile(j: unknown, s: number, ayat: number): SurahCheck {
  const f = (j && typeof j === 'object' ? (j as Record<string, unknown>).audio_file : null) as Record<string, unknown> | null;
  if (!f || typeof f !== 'object') return { ok: false, problems: ['no audio_file'], negatives: 0, play: null };
  const problems = fileProblems(f.format, f.file_size, f.duration);
  const url = approvedAudioUrl(f.audio_url);
  if (!url) problems.push('audio address is not https on the approved host');
  const duration = typeof f.duration === 'number' ? f.duration : null;
  const tm = checkTimestamps(f.timestamps, s, ayat, duration);
  problems.push(...tm.problems);
  const ok = problems.length === 0;
  return { ok, problems: problems.slice(0, 10), negatives: tm.negatives, play: ok ? { url: url!, duration: duration!, t: tm.t } : null, shape: fileShape(f, s) };
}

// Which surahs the API environment has audio for. Pre-live covers surahs 1 and 2 only (seen on
// /dev/reciters/ on 12 Nov and stated for pre-live content generally); production covers all 114.
export function coveredSurahs(env: 'prelive' | 'production'): number[] {
  return env === 'prelive' ? [1, 2] : Array.from({ length: 114 }, (_, i) => i + 1);
}

// The ayah (1-based) whose timing covers ms. In a gap between two ayat the earlier one stays
// current; before the first ayah (an opening) and after the last one, 0 (nothing marked).
export function ayahAt(tm: [number, number][], ms: number): number {
  let lo = 0, hi = tm.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (tm[m][0] <= ms) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) return 0;
  return ms < tm[best][1] || (best + 1 < tm.length && ms < tm[best + 1][0]) ? best + 1 : 0;
}
