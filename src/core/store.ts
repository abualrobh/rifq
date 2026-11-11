// On-device saves (RQ-003). One versioned localStorage entry holding surah and ayah numbers only:
// no Quran text, no names, no dates. Every storage access is wrapped, so blocked or full storage
// never breaks reading (AC8). Stored values are untrusted input and are validated on every read.
export const SAVES_KEY = 'rifq.saves';
export const SAVES_VERSION = 1;
export const MAX_BOOKMARKS = 500;

export type Ref = [number, number];
export type Saves = { v: 1; b: Ref[]; l: Ref | null };
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type AddResult = 'saved' | 'exists' | 'limit' | 'failed';
export type RemoveResult = 'removed' | 'missing' | 'failed';

const empty = (): Saves => ({ v: 1, b: [], l: null });
// 0 is kept (not dropped) so that it reaches the "does not exist" message (TP3-20).
const isNum = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 65535;
const isRef = (r: unknown): r is Ref => Array.isArray(r) && r.length === 2 && isNum(r[0]) && isNum(r[1]);
const same = (x: Ref, y: Ref) => x[0] === y[0] && x[1] === y[1];

// Returns null when storage itself cannot be reached (blocked, or access throws).
export function getStorage(win: { localStorage?: Storage } | undefined = globalThis as any): StorageLike | null {
  try {
    const s = win?.localStorage;
    if (!s) return null;
    s.getItem(SAVES_KEY);
    return s;
  } catch {
    return null;
  }
}

// Parses stored JSON defensively. Anything unexpected is dropped, never executed or shown raw.
export function parse(raw: string | null): Saves {
  if (!raw || raw.length > 64 * 1024) return empty();
  let v: any;
  try { v = JSON.parse(raw); } catch { return empty(); }
  if (!v || typeof v !== 'object' || v.v !== SAVES_VERSION) return empty();
  const b: Ref[] = [];
  if (Array.isArray(v.b)) {
    for (const r of v.b) {
      if (b.length >= MAX_BOOKMARKS) break;
      if (isRef(r) && !b.some((x) => same(x, r))) b.push([r[0], r[1]]);
    }
  }
  return { v: 1, b, l: isRef(v.l) ? [v.l[0], v.l[1]] : null };
}

export function load(st: StorageLike | null): { ok: boolean; saves: Saves } {
  if (!st) return { ok: false, saves: empty() };
  try { return { ok: true, saves: parse(st.getItem(SAVES_KEY)) }; } catch { return { ok: false, saves: empty() }; }
}

function write(st: StorageLike | null, s: Saves): boolean {
  if (!st) return false;
  try { st.setItem(SAVES_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function isBookmarked(s: Saves, r: Ref): boolean {
  return s.b.some((x) => same(x, r));
}

// Each change re-reads storage first, so a change made in another tab is kept.
export function addBookmark(st: StorageLike | null, r: Ref): AddResult {
  if (!isRef(r)) return 'failed';
  const { ok, saves } = load(st);
  if (!ok) return 'failed';
  if (isBookmarked(saves, r)) return 'exists';
  if (saves.b.length >= MAX_BOOKMARKS) return 'limit';
  saves.b.push([r[0], r[1]]);
  saves.b.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return write(st, saves) ? 'saved' : 'failed';
}

export function removeBookmark(st: StorageLike | null, r: Ref): RemoveResult {
  const { ok, saves } = load(st);
  if (!ok) return 'failed';
  const n = saves.b.length;
  saves.b = saves.b.filter((x) => !same(x, r));
  if (saves.b.length === n) return 'missing';
  return write(st, saves) ? 'removed' : 'failed';
}

// Clear all removes bookmarks only. Whether it should also clear the last position is open (U-28).
export function clearBookmarks(st: StorageLike | null): boolean {
  const { ok, saves } = load(st);
  if (!ok) return false;
  saves.b = [];
  return write(st, saves);
}

// RQ-003 v1.3 AC14 to AC23 (D-101, D-103): removes the last reading position only. Bookmarks
// stay in the same order and reading settings (a separate entry) are not touched (AC16). Storage
// is re-read first, so a bookmark added in another tab is kept.
export function clearLast(st: StorageLike | null): RemoveResult {
  const { ok, saves } = load(st);
  if (!ok) return 'failed';
  if (!saves.l) return 'missing';
  saves.l = null;
  return write(st, saves) ? 'removed' : 'failed';
}

export function setLast(st: StorageLike | null, r: Ref): boolean {
  if (!isRef(r)) return false;
  const { ok, saves } = load(st);
  if (!ok) return false;
  if (saves.l && same(saves.l, r)) return true;
  saves.l = [r[0], r[1]];
  return write(st, saves);
}

// counts[s] is the number of ayat in surah s from the build's source; index 0 is unused.
export function refExists(counts: readonly number[], r: Ref): boolean {
  return r[0] >= 1 && r[0] < counts.length && r[1] >= 1 && r[1] <= counts[r[0]];
}
