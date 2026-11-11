// Design round 1 (unit level): RQ-003 v1.3 clear last position (AC16, AC19), RQ-004 v0.1 surah
// index filter (AC9 to AC12, AC14, AC17) and its agreement with search offers (AC12), and the
// ayah count label (P-6). Synthetic data and made-up references only (D-051).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { runQuery, ayahCount, type SearchOk } from '../../src/core/api.ts';
import { addBookmark, clearLast, getStorage, load, setLast, SAVES_KEY, type StorageLike } from '../../src/core/store.ts';
import { filterIndex, visibleRows } from '../../src/core/index-filter.ts';
import { foldName, matchSurahNames } from '../../src/core/surah-match.ts';
import { surahsOf } from '../../src/core/source-adapter.ts';
import { surahName } from '../../src/core/search-core.ts';
import { ayatLabel, indexPath, STRINGS } from '../../src/core/strings.ts';

class Mem implements StorageLike {
  m = new Map<string, string>();
  full = false;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.full) throw new DOMException('full', 'QuotaExceededError'); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

test('RQ-003 AC16: clearing the last position removes only it; bookmarks keep their order', () => {
  const st = new Mem();
  st.setItem('rifq.settings', '{"size":2,"dark":true}');
  for (const r of [[3, 3], [1, 1], [2, 2]] as [number, number][]) addBookmark(st, r);
  setLast(st, [2, 40]);
  const before = load(st).saves.b;
  assert.equal(clearLast(st), 'removed');
  const after = load(st).saves;
  assert.equal(after.l, null);
  assert.deepEqual(after.b, before);
  assert.equal(st.getItem('rifq.settings'), '{"size":2,"dark":true}');
  assert.equal(clearLast(st), 'missing');
  // A new position can be saved again afterwards (AC18: hidden until a new position is saved).
  assert.equal(setLast(st, [3, 1]), true);
  assert.deepEqual(load(st).saves.l, [3, 1]);
});

test('RQ-003 AC19: blocked or full storage reports failure and keeps the position', () => {
  const blocked = getStorage({ get localStorage(): Storage { throw new DOMException('blocked', 'SecurityError'); } } as any);
  assert.equal(clearLast(blocked), 'failed');
  const st = new Mem();
  setLast(st, [2, 7]);
  st.full = true;
  assert.equal(clearLast(st), 'failed');
  assert.deepEqual(JSON.parse(st.getItem(SAVES_KEY)!).l, [2, 7]);
});

const { src, ix } = synthetic('design');
const surahs = surahsOf(src.list);
const counts = [0, ...surahs.map((s) => s.items.length)];
const folded = ['', ...surahs.map((s) => foldName(s.ar))];
const arDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(0x660 + Number(d)));
const extDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(0x6f0 + Number(d)));

test('RQ-004 AC3: counts built from the file equal the search index counts', () => {
  for (const s of surahs) assert.equal(counts[s.n], ayahCount(ix, s.n));
  assert.equal(counts.reduce((a, b) => a + b, 0), src.list.length);
});

test('RQ-004 AC12: the index filter matches exactly the surahs search offers, for every name and prefix', () => {
  // The names the browser folds are the ones the Worker reads from its index.
  for (const s of surahs) assert.equal(foldName(surahName(ix, s.n)), folded[s.n]);
  const queries = new Set<string>();
  for (const s of surahs) {
    const cps = [...s.ar];
    for (let i = 1; i <= cps.length; i++) queries.add(cps.slice(0, i).join(''));
    queries.add(s.ar.replace(/[\u064b-\u065f]/g, ''));
  }
  for (const q of queries) {
    const r = runQuery(ix, q, 1);
    const offered = r.status === 200 ? (r.data as SearchOk).offers.filter((o) => o.kind === 'surah').map((o) => o.s) : [];
    const f = filterIndex(folded, counts, q);
    assert.equal(f.kind, 'names', q);
    assert.deepEqual(visibleRows(f), offered, `query ${[...q].map((c) => c.codePointAt(0)!.toString(16)).join(' ')}`);
  }
  assert.ok(queries.size > surahs.length);
});

test('RQ-004 AC9, AC10, AC11: numbers and references in three digit forms', () => {
  for (const q of ['2', arDigits('2'), extDigits('2'), ' 2 ']) assert.deepEqual(filterIndex(folded, counts, q), { kind: 'ref', s: 2 });
  for (const q of ['2:5', '2 : 5', arDigits('2:5'), extDigits('2:5')]) assert.deepEqual(filterIndex(folded, counts, q), { kind: 'ref', s: 2, a: 5 });
  for (const q of ['0', String(surahs.length + 1), `2:${counts[2] + 1}`, '2:0']) {
    const r = filterIndex(folded, counts, q);
    assert.equal(r.kind, 'missing', q);
    assert.deepEqual(visibleRows(r), []);
  }
});

test('RQ-004 AC14, AC15, AC17, D-091 A: no match, empty, Latin letters and the 100-character limit', () => {
  assert.deepEqual(visibleRows(filterIndex(folded, counts, String.fromCodePoint(0x6a4).repeat(3))), []);
  assert.deepEqual(filterIndex(folded, counts, ''), { kind: 'all' });
  assert.equal(visibleRows(filterIndex(folded, counts, '   ')), null);
  assert.equal(filterIndex(folded, counts, 'Synthetic 2').kind, 'latin');
  assert.equal(filterIndex(folded, counts, String.fromCodePoint(0x628).repeat(101)).kind, 'too_long');
  // One letter is not a start-of-name match (D-064), unless it is a whole name.
  const one = [...folded[1]][0];
  assert.deepEqual(matchSurahNames(folded, one), folded.slice(1).flatMap((f, i) => (f === one ? [i + 1] : [])));
});

test('RQ-004 P-6: ayah count label, and every new string exists in both languages', () => {
  assert.equal(ayatLabel('en', 7), '7 ayat');
  assert.equal(ayatLabel('ar', 7), STRINGS.ar.ayatFew.replace('{n}', '7'));
  assert.equal(ayatLabel('ar', 11), STRINGS.ar.ayatMany.replace('{n}', '11'));
  assert.equal(ayatLabel('ar', 286), STRINGS.ar.ayatMany.replace('{n}', '286'));
  assert.equal(ayatLabel('ar', 110), STRINGS.ar.ayatFew.replace('{n}', '110'));
  assert.equal(indexPath('ar'), '/surahs/');
  assert.equal(indexPath('en'), '/en/surahs/');
  for (const k of ['clearLast', 'clearLastName', 'clearLastConfirm', 'clearLastNote', 'clearLastDone', 'clearLastFailed', 'surahIndex', 'filterLabel', 'filterNone', 'filterClear'] as const) {
    assert.ok(STRINGS.ar[k] && STRINGS.en[k], k);
    assert.match(STRINGS.ar[k], /[\u0621-\u064a]/);
    assert.match(STRINGS.en[k], /[A-Za-z]/);
  }
});
