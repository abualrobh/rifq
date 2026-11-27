// Kit v42, unit level.
//   D-270 A: the one-row mini-player at large text. Its switch point (MiniPlayer.tsx FIT_REM) must
//   match the kit v41 bar's second row in global.css, so a change to that CSS is caught here.
//   D-267 A (QA FIND-CO): the source details columns cannot grow past the panel, and stack where the
//   panel is narrow for its text.
//   The new string miniMore exists in both tables (its Arabic wording is compared with the B-09
//   proposal by a private check outside the repository; no Arabic characters in test files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../../src/core/strings.ts';

const css = readFileSync(new URL('../../src/site/styles/global.css', import.meta.url), 'utf8');
const mini = readFileSync(new URL('../../src/site/islands/MiniPlayer.tsx', import.meta.url), 'utf8');
const rem = (v: string) => { const m = /^([\d.]+)rem$/.exec(v.trim()); assert.ok(m, `rem value: ${v}`); return Number(m![1]); };
const rule = (sel: string) => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, `rule ${sel}`); return css.slice(i, css.indexOf('}', i)); };
const prop = (r: string, p: string) => { const m = new RegExp(`(?:^|[;{ ])${p}:\\s*([^;]+);`).exec(r); assert.ok(m, `${p} in ${r}`); return m![1]; };

test('D-270 A: FIT_REM is the kit v41 bar\'s second row (surah line, go to, close, two gaps) plus the bar\'s inline padding', () => {
  const fit = Number(/export const FIT_REM = ([\d.]+);/.exec(mini)![1]);
  const info = rem(prop(rule('.mini-info'), 'flex').split(' ')[2]);
  const btn = rem(prop(rule('.mini .btn.icon-btn'), 'min-width'));
  const bar = rule('.mini');
  const gap = rem(prop(bar, 'gap'));
  const pad = /padding: [\d.]+rem max\(([\d.]+)rem,/.exec(bar);
  assert.ok(pad, 'the bar\'s inline padding');
  assert.equal(info + 2 * btn + 2 * gap + 2 * Number(pad![1]), fit);
});

test('D-270 A: the kit v39 large-text rules for the mini-player are gone; the one-row bar keeps 44 px height, 8 px gaps and at least 24 px width', () => {
  assert.doesNotMatch(css, /rifq-tall-text \.mini/);
  const btn = rule('.mini-row .btn.icon-btn');
  assert.equal(prop(btn, 'height'), '44px');
  assert.equal(prop(btn, 'min-height'), '44px');
  assert.equal(prop(btn, 'min-width'), '24px');
  assert.equal(prop(rule('.mini-row'), 'gap'), '8px');
  assert.equal(prop(rule('.mini-row'), 'flex-wrap'), 'nowrap');
});

test('D-267 A: the source details columns are bounded and stack in a narrow panel', () => {
  assert.match(prop(rule('.ap-source'), 'grid-template-columns'), /minmax\(0, 1fr\)$/);
  assert.match(css, /div\.ap-more, \.src-box \{ container-type: inline-size; \}/);
  const i = css.indexOf('@container (max-width: 15em)');
  assert.ok(i > 0);
  assert.match(css.slice(i, i + 200), /\.ap-source \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('D-270 A: miniMore in both tables; English as proposed', () => {
  assert.equal(STRINGS.en.miniMore, 'Player options');
  assert.ok(STRINGS.ar.miniMore.length > 0);
  assert.doesNotMatch(STRINGS.ar.miniMore, /[A-Za-z{}]/);
});
