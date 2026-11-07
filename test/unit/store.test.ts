// RQ-003 store: TP3-08, TP3-17, TP3-18, TP3-19, TP3-20, TP3-21, TP3-25, TP3-26 (unit level).
// Storage here is an in-memory fake holding made-up references only (D-051).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBookmark, clearBookmarks, getStorage, load, MAX_BOOKMARKS, parse, refExists, removeBookmark, SAVES_KEY, setLast, type StorageLike } from '../../src/core/store.ts';

class Mem implements StorageLike {
  m = new Map<string, string>();
  full = false;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.full) throw new DOMException('full', 'QuotaExceededError'); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

test('add, reload and remove a bookmark (TP3-01 unit, TP3-08)', () => {
  const st = new Mem();
  assert.equal(addBookmark(st, [2, 5]), 'saved');
  assert.equal(addBookmark(st, [2, 5]), 'exists');
  assert.equal(addBookmark(st, [1, 1]), 'saved');
  assert.deepEqual(load(st).saves.b, [[1, 1], [2, 5]]);
  assert.equal(removeBookmark(st, [2, 5]), 'removed');
  assert.deepEqual(load(st).saves.b, [[1, 1]]);
});

test('TP3-17: blocked storage: every save reports failure and nothing throws', () => {
  const blocked = { get localStorage(): Storage { throw new DOMException('blocked', 'SecurityError'); } };
  const st = getStorage(blocked as any);
  assert.equal(st, null);
  assert.equal(addBookmark(st, [1, 1]), 'failed');
  assert.equal(removeBookmark(st, [1, 1]), 'failed');
  assert.equal(setLast(st, [1, 1]), false);
  assert.equal(load(st).ok, false);
});

test('TP3-18: full storage: the save reports failure and existing saves stay', () => {
  const st = new Mem();
  addBookmark(st, [1, 1]);
  st.full = true;
  assert.equal(addBookmark(st, [1, 2]), 'failed');
  assert.deepEqual(load(st).saves.b, [[1, 1]]);
});

test('TP3-25: at 500 bookmarks another one gives "limit" and the 500 stay unchanged', () => {
  const st = new Mem();
  const b = Array.from({ length: MAX_BOOKMARKS }, (_, i) => [1 + Math.floor(i / 100), 1 + (i % 100)]);
  st.setItem(SAVES_KEY, JSON.stringify({ v: 1, b, l: null }));
  const before = st.getItem(SAVES_KEY);
  assert.equal(addBookmark(st, [9, 9]), 'limit');
  assert.equal(st.getItem(SAVES_KEY), before);
  assert.equal(load(st).saves.b.length, 500);
});

test('TP3-26: clear all removes bookmarks and keeps the last position (U-28 open)', () => {
  const st = new Mem();
  addBookmark(st, [1, 1]); addBookmark(st, [2, 2]); setLast(st, [3, 3]);
  assert.equal(clearBookmarks(st), true);
  assert.deepEqual(load(st).saves, { v: 1, b: [], l: [3, 3] });
});

test('TP3-19: stored value holds numbers only: no text, no names, no dates', () => {
  const st = new Mem();
  addBookmark(st, [2, 5]); setLast(st, [2, 6]);
  const raw = st.getItem(SAVES_KEY)!;
  assert.equal(raw, '{"v":1,"b":[[2,5]],"l":[2,6]}');
  assert.ok(!/[\u0600-\u06ff]/.test(raw));
});

test('TP3-21: malformed and script values are dropped, never thrown or kept', () => {
  for (const raw of ['', 'null', '{', '[]', '{"v":2,"b":[[1,1]]}', '{"v":1,"b":"<script>"}', '{"v":1,"b":[[1,"1"],[1,1.5],[-1,2],[1,2,3],["<img src=x>",1]],"l":"x"}', 'x'.repeat(70000)]) {
    const s = parse(raw);
    assert.deepEqual(s.b, []);
    assert.equal(s.l, null);
  }
  assert.deepEqual(parse('{"v":1,"b":[[1,1],[1,1],[2,3]],"l":[4,5]}'), { v: 1, b: [[1, 1], [2, 3]], l: [4, 5] });
  // Zero is kept so that it reaches the "does not exist" message instead of vanishing.
  assert.deepEqual(parse('{"v":1,"b":[[0,1]],"l":[0,0]}'), { v: 1, b: [[0, 1]], l: [0, 0] });
});

test('TP3-20: references outside the source are detected', () => {
  const counts = [0, 7, 40];
  assert.equal(refExists(counts, [1, 7]), true);
  for (const r of [[3, 1], [1, 8], [0, 1], [1, 0]] as [number, number][]) assert.equal(refExists(counts, r), false);
});

test('last position: same value is not rewritten; a newer one replaces it (TP3-10, TP3-11 unit)', () => {
  const st = new Mem();
  assert.equal(setLast(st, [1, 2]), true);
  assert.equal(setLast(st, [1, 3]), true);
  assert.deepEqual(load(st).saves.l, [1, 3]);
});
