// Kit v43 (part 1), unit level.
//   D-279 (4) (QA FIND-CJ): the early inline script in Layout.astro sets html.rifq-tall-text with the
//   same rule and number as client/tabbar.ts (TALL_TEXT_REM), before the first paint, and the CSP
//   still allows inline scripts by hash only (scripts/headers.ts), never by 'unsafe-inline'.
//   D-272 A (QA FIND-CS): MiniPlayer remembers the focused control's key before a layout switch.
//   D-279 (6): the startup warm-up (src/worker/warm.ts) never throws, and a Worker made with it gives
//   the same answers as one made without it (the warm-up changes no state a request can see).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPolicy, inlineHashes } from '../../scripts/headers.ts';
import { focusedKey, MINI_KEYS } from '../../src/site/client/mini-focus.ts';

const layout = readFileSync(new URL('../../src/site/layouts/Layout.astro', import.meta.url), 'utf8');
const tabbar = readFileSync(new URL('../../src/site/client/tabbar.ts', import.meta.url), 'utf8');
const warm = readFileSync(new URL('../../src/worker/warm.ts', import.meta.url), 'utf8');

test('FIND-CJ: the early inline script sets rifq-tall-text with the same 40-line rule as tabbar.ts', () => {
  const n = Number(/export const TALL_TEXT_REM = (\d+);/.exec(tabbar)![1]);
  const early = /<script is:inline>(\(function\(\)\{[\s\S]*?\}\)\(\);)<\/script>/.exec(layout);
  assert.ok(early, 'the early inline script');
  assert.match(early![1], new RegExp(`innerHeight/r<${n}\\)d\\.classList\\.add\\('rifq-tall-text'\\)`));
  assert.match(early![1], /getComputedStyle\(d\)\.fontSize/);
  // Nothing is read from storage for the class: the rule uses the screen and the root font only.
  const part = early![1].slice(early![1].indexOf('var r=parseFloat'));
  assert.doesNotMatch(part, /localStorage/);
});

test('FIND-CJ: the inline script is allowed by its hash, and the policy has no unsafe-inline', () => {
  const html = `<html><head><script>(function(){})();</script></head></html>`;
  const h = inlineHashes(html);
  const csp = buildPolicy(h.scripts, h.styles);
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
});

test('FIND-CJ: the interface font files of the page language are preloaded, same origin, crossorigin anonymous', () => {
  assert.match(layout, /rel="preload" href=\{`\/fonts\/tajawal\/tajawal-\$\{f\}-normal\.woff2`\} as="font" type="font\/woff2" crossorigin="anonymous"/);
});

test('D-272 A: focusedKey names the focused bar control, and none for focus outside the bar or inside the sheet', () => {
  assert.deepEqual([...MINI_KEYS], ['prev', 'toggle', 'next', 'more', 'go', 'close']);
  assert.equal(focusedKey(null), null);
  const g = globalThis as unknown as { document?: unknown };
  const had = 'document' in g, old = g.document;
  const el = (attrs: string[], inSheet = false) => ({ hasAttribute: (a: string) => attrs.includes(a), closest: (s: string) => (s === '[data-mini-sheet]' && inSheet ? {} : null) });
  const box = (active: unknown) => ({ contains: (e: unknown) => e === active });
  try {
    for (const k of MINI_KEYS) {
      const a = el([`data-mini-${k}`]);
      g.document = { activeElement: a };
      assert.equal(focusedKey(box(a) as unknown as HTMLElement), k);
    }
    const s = el(['data-mini-go'], true);
    g.document = { activeElement: s };
    assert.equal(focusedKey(box(s) as unknown as HTMLElement), null, 'the sheet\'s own go to');
    const out = el(['data-mini-toggle']);
    g.document = { activeElement: out };
    assert.equal(focusedKey(box(null) as unknown as HTMLElement), null, 'focus outside the bar');
  } finally { if (had) g.document = old; else delete g.document; }
});

test('D-279 (6): the warm-up uses made-up input only and nothing the global scope forbids', () => {
  // No Request or Response objects, timers or network in the global scope (they throw in the Workers
  // runtime at startup); no Arabic letters in the source (made-up letters are built from code points).
  assert.doesNotMatch(warm.replace(/\/\/.*$/gm, ''), /new (Request|Response)\(|setTimeout|setInterval|fetch\(|caches/);
  assert.doesNotMatch(warm, /[؀-ۿ]/);
});
