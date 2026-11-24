// Kit v38: RQ-008 v1.0 stage 2 (ayah actions panel, Tafseer panel, reciter button), unit level.
//   strings: the 15 new keys exist in both tables, interface text only, the English text exactly as
//   drafted in RQ-008 v1.0's table (rows 9, 17 to 29 and 34); the Arabic text is compared with the
//   table by a private check outside the repository (no Arabic characters in test files);
//   fill(): a string's placeholders are filled in the string's own order, and S:A is one isolated,
//   left-to-right reference (AC36).
// No Arabic characters and no Quran text in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STRINGS, t } from '../../src/core/strings.ts';
import { fill, refNode } from '../../src/site/client/fill.ts';

const EN: Record<string, string> = {
  bookmarkDeviceOnly: 'Bookmarks are saved on this device only',
  ayahActions: 'Options for ayah {a}',
  ayahActionsTitle: '{name} · Ayah {a}',
  ayahActionsSub: '{s}:{a} · Juz {j}',
  playFromHere: 'Play from here',
  addBookmark: 'Add bookmark',
  removeBookmarkShort: 'Remove bookmark',
  bookmarkedMark: 'Bookmarked',
  copyRef: 'Copy reference {s}:{a}',
  copied: 'Reference {s}:{a} copied.',
  copyFailed: 'Could not copy. The reference is {s}:{a}.',
  close: 'Close',
  tafseerPanelTitle: 'Tafseer · {name} {a}',
  closeTafseer: 'Close Tafseer',
  reciterChip: 'Reciter: {name}',
};

test('RQ-008 stage 2 strings: 15 new keys in both tables; English as drafted in RQ-008 v1.0', () => {
  assert.equal(Object.keys(EN).length, 15);
  for (const [k, v] of Object.entries(EN)) {
    assert.equal((STRINGS.en as Record<string, string>)[k], v, `en.${k}`);
    const ar = (STRINGS.ar as Record<string, string>)[k];
    assert.ok(ar && ar.trim(), `ar.${k}`);
    // The same placeholders in both languages.
    assert.deepEqual((ar.match(/\{\w+\}/g) ?? []).sort(), (v.match(/\{\w+\}/g) ?? []).sort(), `placeholders of ${k}`);
  }
  assert.equal(Object.keys(STRINGS.ar).length, Object.keys(STRINGS.en).length);
  assert.equal(t('en', 'copied', { s: 1, a: 5 }), 'Reference 1:5 copied.');
});

test('fill(): placeholders filled in the string\'s order; S:A one isolated left-to-right reference (AC36)', () => {
  const html = (n: ReturnType<typeof fill>) => renderToStaticMarkup(createElement('p', null, n));
  assert.equal(html(fill('en', 'copyRef', { ref: refNode(2, 255) })), '<p>Copy reference <bdi dir="ltr">2:255</bdi></p>');
  assert.equal(html(fill('en', 'ayahActionsSub', { ref: refNode(1, 5), j: '1' })), '<p><bdi dir="ltr">1:5</bdi> · Juz 1</p>');
  assert.equal(html(fill('en', 'ayahActionsTitle', { name: createElement('bdi', null, 'X'), a: 3 })), '<p><bdi>X</bdi> · Ayah 3</p>');
  // A string without {s}:{a} is unchanged by ref.
  assert.equal(html(fill('en', 'reciterChip', { name: 'N' })), '<p>Reciter: N</p>');
  // Every Arabic template that names S:A has it as one piece, so it is isolated as a whole.
  for (const k of ['ayahActionsSub', 'copyRef', 'copied', 'copyFailed'] as const) assert.ok(STRINGS.ar[k].includes('{s}:{a}'), k);
});
