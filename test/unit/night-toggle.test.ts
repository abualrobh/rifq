// Night toggle strings: the button names its next action in both languages; the reviewed `night`
// string is unchanged (D-104).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../../src/core/strings.ts';

test('night toggle: action labels exist in both languages and differ by state; night is unchanged', () => {
  assert.equal(STRINGS.en.toDark, 'Switch to dark mode');
  assert.equal(STRINGS.en.toLight, 'Switch to light mode');
  for (const l of ['ar', 'en'] as const) {
    assert.ok(STRINGS[l].toDark && STRINGS[l].toLight);
    assert.notEqual(STRINGS[l].toDark, STRINGS[l].toLight);
  }
  assert.equal(STRINGS.en.night, 'Night mode');
});
