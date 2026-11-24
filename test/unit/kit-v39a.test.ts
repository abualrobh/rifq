// Kit v39 part A (fixes to kit v38), unit level: D-208 C (RQ-008 AC43). The Tafseer previous and next
// buttons show the target ayah (the existing audioNowAyah); their accessible names (prevAyahTo,
// nextAyahTo, new strings for B-09) keep the direction and contain the visible label (WCAG 2.5.3).
// No Arabic characters and no Quran text in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../../src/core/strings.ts';

test('D-208 C: the Tafseer previous/next names contain the visible label and keep the direction', () => {
  for (const lang of ['ar', 'en'] as const) {
    for (const [k, dir] of [['prevAyahTo', 'prevAyah'], ['nextAyahTo', 'nextAyah']] as const) {
      const name = t(lang, k, { a: 6 });
      assert.ok(name.includes(t(lang, 'audioNowAyah', { a: 6 })), `${lang}.${k} contains the visible label`);
      assert.ok(name.startsWith(t(lang, dir)), `${lang}.${k} starts with the direction`);
      assert.deepEqual(STRINGS[lang][k].match(/\{\w+\}/g), ['{a}']);
    }
  }
  assert.equal(t('en', 'nextAyahTo', { a: 6 }), 'Next ayah: Ayah 6');
  assert.equal(t('en', 'prevAyahTo', { a: 4 }), 'Previous ayah: Ayah 4');
});
