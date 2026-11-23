// Recently read (RQ-008 AC19, AC20, D-182 A): up to 3 surah numbers, most recent first, on this
// device only. No dates, times, counts or durations; never sent anywhere. A surah is added only when
// the D-062 rule (ReaderTools: 3 seconds on screen) records an ayah in it. Stored values are untrusted
// input and are checked on every read, like the saves (src/core/store.ts).
import type { StorageLike } from './store.ts';

export const RECENT_KEY = 'rifq.recent';
export const RECENT_VERSION = 1;
export const MAX_RECENT = 3;

const isSurah = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535;

// Anything unexpected is dropped; duplicates and extra entries are dropped.
export function parseRecent(raw: string | null): number[] {
  if (!raw || raw.length > 1024) return [];
  let v: any;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!v || typeof v !== 'object' || v.v !== RECENT_VERSION || !Array.isArray(v.s)) return [];
  const out: number[] = [];
  for (const s of v.s) {
    if (out.length >= MAX_RECENT) break;
    if (isSurah(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

export function loadRecent(st: StorageLike | null): { ok: boolean; list: number[] } {
  if (!st) return { ok: false, list: [] };
  try { return { ok: true, list: parseRecent(st.getItem(RECENT_KEY)) }; } catch { return { ok: false, list: [] }; }
}

// Moves (or adds) surah s to the front. Returns false when it could not be stored.
export function addRecent(st: StorageLike | null, s: number): boolean {
  if (!isSurah(s)) return false;
  const { ok, list } = loadRecent(st);
  if (!ok) return false;
  if (list[0] === s) return true;
  const next = [s, ...list.filter((x) => x !== s)].slice(0, MAX_RECENT);
  try { st!.setItem(RECENT_KEY, JSON.stringify({ v: RECENT_VERSION, s: next })); return true; } catch { return false; }
}

// D-183 A (AC74): removes recently read only; bookmarks, the last position and settings are other
// entries and are not touched. 'missing' when there is nothing to remove.
export function clearRecent(st: StorageLike | null): 'removed' | 'missing' | 'failed' {
  const { ok, list } = loadRecent(st);
  if (!ok) return 'failed';
  if (!list.length) return 'missing';
  try { st!.removeItem(RECENT_KEY); return 'removed'; } catch { return 'failed'; }
}

// The juz of ayah s:a from the file's juz starts (D-090 D): the last juz whose first ayah is at or
// before s:a. 0 when unknown.
export function juzOfAyah(starts: readonly { juz: number; s: number; a: number }[], s: number, a: number): number {
  let j = 0;
  for (const x of starts) if (x.s < s || (x.s === s && x.a <= a)) j = Math.max(j, x.juz);
  return j;
}
