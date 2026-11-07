// Self-tests for the public repository check and the CSP header writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layer1, layer2 } from '../../scripts/check-no-quran.ts';
import { inlineHashes, buildPolicy } from '../../scripts/headers.ts';
import { synthetic } from '../fixtures/load.ts';

// Each case gets its own new folder inside .synthetic/ (ignored by the check). Nothing is deleted.
function tmp(name: string) {
  const d = join(process.cwd(), '.synthetic', `check-${process.pid}`, name);
  mkdirSync(join(d, 'src/core'), { recursive: true });
  return d;
}
const ar = String.fromCodePoint(0x628, 0x64a, 0x62a);

test('layer 1: clean folder passes; Arabic outside the strings file fails; Quranic sign fails anywhere', () => {
  const d = tmp('l1');
  writeFileSync(join(d, 'a.ts'), 'export const x = 1;\n');
  assert.equal(layer1(d).length, 0);
  writeFileSync(join(d, 'src/core/strings.ts'), `export const s = '${ar}';\n`);
  assert.equal(layer1(d).length, 0, 'Arabic allowed in the strings file');
  writeFileSync(join(d, 'b.ts'), `export const y = '${ar}';\n`);
  assert.equal(layer1(d).length, 1);
  writeFileSync(join(d, 'src/core/strings.ts'), `export const s = '${ar}${String.fromCodePoint(0x6d6)}';\n`);
  assert.equal(layer1(d).filter((f) => f.reason === 'Quranic sign').length, 1);
  const B = String.fromCharCode(92);
  writeFileSync(join(d, 'c.ts'), `export const z = '${[0x628, 0x650, 0x633, 0x652].map((c) => B + 'u0' + c.toString(16)).join('')}';\n`);
  assert.ok(layer1(d).some((f) => f.reason.startsWith('run of 4')));
});

test('layer 2: an ayah, a surah name, or a 3-word run from the source is caught', () => {
  const { syn, src } = synthetic('check');
  const d = tmp('l2');
  writeFileSync(join(d, 'ok.md'), 'nothing here\n');
  assert.equal(layer2(d, syn.recordPath).length, 0);
  writeFileSync(join(d, 'ayah.txt'), src.list[10].aya_text);
  assert.ok(layer2(d, syn.recordPath).some((f) => /ayah/.test(f.reason)));
  writeFileSync(join(d, 'ayah.txt'), 'replaced\n'); // overwritten, not deleted (Rule 2)
  writeFileSync(join(d, 'src/core/strings.ts'), `export const s = 'x ${src.list[0].sora_name_ar} y';\n`);
  assert.ok(layer2(d, syn.recordPath).some((f) => /Arabic name/.test(f.reason)));
  writeFileSync(join(d, 'src/core/strings.ts'), `export const s = '${src.list[20].aya_text.split(' ').slice(1, 4).join(' ')}';\n`);
  assert.ok(layer2(d, syn.recordPath).some((f) => /3-word/.test(f.reason)));
  writeFileSync(join(d, 'src/core/strings.ts'), 'export const s = 1;\n');
  writeFileSync(join(d, 'names.txt'), 'see Synthetic 3 here');
  assert.ok(layer2(d, syn.recordPath).some((f) => /English name/.test(f.reason)));
});

test('CSP writer hashes inline scripts and refuses inline style attributes', () => {
  const r = inlineHashes('<script>a()</script><script src="/x.js"></script><style>b{}</style>');
  assert.equal(r.scripts.size, 1);
  assert.equal(r.styles.size, 1);
  const p = buildPolicy(r.scripts, r.styles);
  assert.ok(!p.includes('unsafe-inline') && !p.includes('unsafe-eval'));
  assert.ok(inlineHashes('<p style="color:red">x</p>').problems.length === 1);
  assert.ok(inlineHashes('<a onclick="x()">x</a>').problems.length === 1);
});
