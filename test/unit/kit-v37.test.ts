// Kit v37: RQ-008 v1.0 stage 1 (tab bar, home, Saved and Settings screens), unit level.
//   recently read (D-182 A, AC20): at most 3 surah numbers, most recent first, no other data;
//   clear recently read (D-183 A, AC74): removes only its own entry;
//   juzOfAyah: the juz of an ayah from the 30 juz starts (AC11), checked against every ayah's jozz;
//   strings: every new key exists in both tables, interface text only (no surah names: the
//   check-no-quran scan covers that), and the tab bar order and paths.
// Storage here is an in-memory fake holding made-up numbers only (D-051). No Arabic characters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRecent, clearRecent, juzOfAyah, loadRecent, MAX_RECENT, parseRecent, RECENT_KEY } from '../../src/core/recent.ts';
import { addBookmark, load, SAVES_KEY, setLast, type StorageLike } from '../../src/core/store.ts';
import { juzStarts } from '../../src/core/source-adapter.ts';
import { savedPath, searchPath, settingsPath, STRINGS, t } from '../../src/core/strings.ts';
import { synthetic } from '../fixtures/load.ts';

class Mem implements StorageLike {
  m = new Map<string, string>();
  full = false;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.full) throw new DOMException('full', 'QuotaExceededError'); this.m.set(k, v); }
  removeItem(k: string) { if (this.full) throw new DOMException('blocked', 'SecurityError'); this.m.delete(k); }
}

test('recently read: most recent first, at most 3, a surah already listed moves to the front', () => {
  const st = new Mem();
  for (const s of [1, 2, 18]) assert.equal(addRecent(st, s), true);
  assert.deepEqual(loadRecent(st).list, [18, 2, 1]);
  assert.equal(addRecent(st, 2), true);
  assert.deepEqual(loadRecent(st).list, [2, 18, 1]);
  assert.equal(addRecent(st, 36), true);
  assert.deepEqual(loadRecent(st).list, [36, 2, 18]);
  assert.equal(loadRecent(st).list.length, MAX_RECENT);
  // Only surah numbers are stored: no dates, times, counts or durations.
  assert.deepEqual(JSON.parse(st.getItem(RECENT_KEY)!), { v: 1, s: [36, 2, 18] });
});

test('recently read: adding the surah already first writes nothing', () => {
  const st = new Mem();
  addRecent(st, 5);
  let writes = 0;
  const set = st.setItem.bind(st);
  st.setItem = (k, v) => { writes++; set(k, v); };
  assert.equal(addRecent(st, 5), true);
  assert.equal(writes, 0);
});

test('recently read: stored values are untrusted and checked on every read', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('not json'), []);
  assert.deepEqual(parseRecent(JSON.stringify({ v: 2, s: [1] })), []);
  assert.deepEqual(parseRecent(JSON.stringify({ v: 1, s: 'x' })), []);
  assert.deepEqual(parseRecent(JSON.stringify({ v: 1, s: [0, -1, 1.5, '2', 3, 3, 4, 5, 6] })), [3, 4, 5]);
  assert.deepEqual(parseRecent('x'.repeat(2000)), []);
});

test('recently read: blocked or full storage fails without throwing', () => {
  assert.equal(addRecent(null, 1), false);
  assert.deepEqual(loadRecent(null), { ok: false, list: [] });
  assert.equal(clearRecent(null), 'failed');
  const st = new Mem(); st.full = true;
  assert.equal(addRecent(st, 1), false);
  assert.equal(addRecent(new Mem(), 0), false);
});

test('D-183 A (AC74): clear recently read removes only its own entry', () => {
  const st = new Mem();
  addBookmark(st, [2, 5]); setLast(st, [3, 7]);
  st.setItem('rifq.settings', JSON.stringify({ size: 2, dark: true }));
  addRecent(st, 2); addRecent(st, 3);
  const before = st.getItem(SAVES_KEY);
  assert.equal(clearRecent(st), 'removed');
  assert.deepEqual(loadRecent(st).list, []);
  assert.equal(st.getItem(SAVES_KEY), before);
  assert.deepEqual(load(st).saves, { v: 1, b: [[2, 5]], l: [3, 7] });
  assert.equal(st.getItem('rifq.settings'), JSON.stringify({ size: 2, dark: true }));
  assert.equal(clearRecent(st), 'missing');
  addRecent(st, 4); st.full = true;
  assert.equal(clearRecent(st), 'failed');
});

test('AC11: juzOfAyah from the juz starts equals every ayah\'s own jozz (synthetic source)', () => {
  const { src } = synthetic('kit-v37');
  const starts = juzStarts(src.list);
  let n = 0;
  for (const x of src.list) {
    if (!Number.isInteger(x.jozz)) continue;
    assert.equal(juzOfAyah(starts, x.sora, x.aya_no), x.jozz, `${x.sora}:${x.aya_no}`);
    n++;
  }
  assert.ok(n > 0);
  assert.equal(juzOfAyah([{ juz: 1, s: 1, a: 1 }, { juz: 2, s: 2, a: 142 }], 2, 141), 1);
  assert.equal(juzOfAyah([{ juz: 1, s: 1, a: 1 }, { juz: 2, s: 2, a: 142 }], 2, 142), 2);
  assert.equal(juzOfAyah([], 1, 1), 0);
});

const NEW_KEYS = ['tabBarLabel', 'tabHome', 'tabRead', 'tabSaved', 'tabSettings', 'mySaved', 'viewAll', 'bookmarkKind', 'continueCard', 'cardAyahJuz', 'allSurahs', 'recentTitle', 'textSize', 'appearance', 'interfaceLanguage', 'langArabic', 'deviceData', 'clearRecent', 'clearRecentConfirm', 'clearRecentDone', 'clearRecentFailed', 'settingsNotRemembered'] as const;

test('RQ-008 stage 1 strings: in both tables, English as drafted in RQ-008 v1.0', () => {
  for (const k of NEW_KEYS) for (const l of ['ar', 'en'] as const) assert.ok(STRINGS[l][k] && STRINGS[l][k].trim(), `${l}.${k}`);
  assert.equal(STRINGS.en.tabBarLabel, 'Main');
  assert.equal(STRINGS.en.mySaved, 'My saved');
  assert.equal(t('en', 'cardAyahJuz', { a: 255, j: 3 }), 'Ayah 255 · Juz 3');
  assert.equal(STRINGS.en.settingsNotRemembered, 'This setting will not be remembered on this device because storage is blocked or full.');
  // The night switch keeps the reviewed `night` label (AC71).
  assert.equal(STRINGS.en.night, 'Night mode');
});

test('tab paths', () => {
  assert.deepEqual([searchPath('ar'), savedPath('ar'), settingsPath('ar')], ['/search/', '/saved/', '/settings/']);
  assert.deepEqual([searchPath('en'), savedPath('en'), settingsPath('en')], ['/en/search/', '/en/saved/', '/en/settings/']);
});
