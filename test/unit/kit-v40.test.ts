// Kit v40, unit level.
//   RQ-008 stage 4 (D-199): the 12 tip strings in both tables, the English text exactly as drafted in
//   RQ-008 v1.0's table rows 54 to 65 (row 63's key "skip" is tipSkip: "skip" is the skip link); the
//   Arabic text is compared with the table by a private check outside the repository (no Arabic
//   characters in test files). "Tips seen" storage (AC80, AC81, AC85) and the AC83 tip list.
//   D-216 A: the Go to how-to hint exists in both tables; the removed keys are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../../src/core/strings.ts';
import { clearTipsSeen, markTipsSeen, tipList, tipsSeen, TIPS_KEY } from '../../src/core/tips.ts';
import type { StorageLike } from '../../src/core/store.ts';

const EN: Record<string, string> = {
  tipsAgain: 'Show tips again',
  tipsAgainDone: 'The tips will show when you open the reader.',
  tipOf: 'Tip {n} of {m}',
  tip1Title: 'Tap any ayah',
  tip1Body: 'Play from there, open its Tafseer in English, bookmark it on this device, or copy its reference.',
  tip2Title: 'Go anywhere',
  tip2Body: 'Type an ayah like 2:255, a surah name or "juz 30" in the Go to box.',
  tip3Title: 'Make reading comfortable',
  tip3Body: 'Change text size, night mode and language in Settings.',
  tipSkip: 'Skip',
  next: 'Next',
  done: 'Done',
};

test('RQ-008 stage 4 strings: 12 keys in both tables; English as drafted in RQ-008 v1.0', () => {
  assert.equal(Object.keys(EN).length, 12);
  for (const [k, v] of Object.entries(EN)) {
    assert.equal((STRINGS.en as Record<string, string>)[k], v, `en.${k}`);
    const ar = (STRINGS.ar as Record<string, string>)[k];
    assert.ok(ar && ar.trim(), `ar.${k}`);
    assert.deepEqual((ar.match(/\{\w+\}/g) ?? []).sort(), (v.match(/\{\w+\}/g) ?? []).sort(), `placeholders of ${k}`);
  }
  // The skip link keeps its own key and text.
  assert.equal(STRINGS.en.skip, 'Skip to the text');
});

test('D-216 A: gotoHowTo in both tables; searchTextTitle and searchTextHint removed', () => {
  assert.ok(STRINGS.en.gotoHowTo.includes('Enter'));
  assert.ok(STRINGS.ar.gotoHowTo.includes('Enter'));
  for (const k of ['searchTextTitle', 'searchTextHint']) assert.ok(!(k in STRINGS.en) && !(k in STRINGS.ar), k);
});

function mem(): StorageLike & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); } } as never;
}
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as StorageLike;

test('AC80, AC85: tips seen is one yes/no value under rifq.tips; anything but "1" is not seen', () => {
  const st = mem();
  assert.deepEqual(tipsSeen(st), { ok: true, seen: false });
  assert.equal(markTipsSeen(st), true);
  assert.equal(st.m.get(TIPS_KEY), '1');
  assert.equal(st.m.size, 1);
  assert.deepEqual(tipsSeen(st), { ok: true, seen: true });
  for (const bad of ['0', 'true', '{"v":1}', ' 1', '']) { st.m.set(TIPS_KEY, bad); assert.equal(tipsSeen(st).seen, false, bad); }
  st.m.set(TIPS_KEY, '1');
  assert.equal(clearTipsSeen(st), true);
  assert.equal(st.m.has(TIPS_KEY), false);
});

test('AC81: blocked or failing storage: not ok, nothing recorded, nothing thrown', () => {
  assert.deepEqual(tipsSeen(null), { ok: false, seen: false });
  assert.deepEqual(tipsSeen(broken), { ok: false, seen: false });
  assert.equal(markTipsSeen(null), false);
  assert.equal(markTipsSeen(broken), false);
  assert.equal(clearTipsSeen(broken), false);
});

test('AC83: tip 1 (playing and Tafseer) only in a build with both; tips 2 and 3 always', () => {
  assert.deepEqual(tipList(true, true), [1, 2, 3]);
  assert.deepEqual(tipList(false, true), [2, 3]);
  assert.deepEqual(tipList(true, false), [2, 3]);
  assert.deepEqual(tipList(false, false), [2, 3]);
});
