// Self-tests for the public repository check and the CSP header writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// D-071, M-1: binary, compressed and re-encoded copies are caught, whatever the file size.
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildIndex } from '../../scripts/build-index.ts';

test('M-1: index copies, compressed, UTF-16, base64 and percent-encoded copies, archives and unlisted binaries fail', () => {
  const { syn, src } = synthetic('check-m1');
  const ayah = src.list[12].aya_text;
  const cases: [string, Buffer | string, RegExp][] = [
    ['index-copy.dat', buildIndex(src).buf, /search index header/],
    ['renamed-gzip.txt', gzipSync(Buffer.from(ayah)), /not plain UTF-8/],
    ['renamed-brotli.txt', brotliCompressSync(Buffer.from(ayah)), /not plain UTF-8/],
    ['renamed-zlib.js', deflateSync(Buffer.from(ayah)), /not plain UTF-8/],
    ['utf16le.txt', Buffer.from(ayah, 'utf16le'), /not plain UTF-8/],
    ['utf16be.txt', Buffer.from(ayah, 'utf16le').swap16(), /not plain UTF-8/],
    ['b64.md', 'x ' + Buffer.from(ayah).toString('base64') + '\n', /base64 run decodes to Arabic/],
    ['pct.txt', encodeURIComponent(ayah) + '\n', /percent-encoded Arabic/],
    ['kit.zip', 'not really a zip\n', /archive or binary blob file name/],
    ['index.bin', 'text\n', /archive or binary blob file name/],
  ];
  for (const [name, data, why] of cases) {
    const d = tmp('m1-' + name);
    writeFileSync(join(d, name), data);
    const f = layer1(d);
    assert.ok(f.some((x) => why.test(x.reason)), `${name}: ${JSON.stringify(f.map((x) => x.reason))}`);
  }
  // With the source, the ayah itself is found inside each encoding and stream.
  for (const [name, data, enc] of [
    ['u16le.txt', Buffer.from(ayah, 'utf16le'), 'UTF-16LE'], ['u16be.txt', Buffer.from(ayah, 'utf16le').swap16(), 'UTF-16BE'],
    ['gz.txt', gzipSync(Buffer.from(ayah)), 'UTF-8'], ['b64gz.md', 'x ' + gzipSync(Buffer.from(ayah)).toString('base64'), 'UTF-8'],
  ] as const) {
    const d = tmp('m1s-' + name);
    writeFileSync(join(d, name), data);
    assert.ok(layer2(d, syn.recordPath).some((x) => x.reason === `ayah ${src.list[12].sora}:${src.list[12].aya_no} found (${enc})`), name);
  }
});

test('M-1: files of 8 MiB and more are scanned', () => {
  const { syn, src } = synthetic('check-big');
  const d = tmp('m1-big');
  writeFileSync(join(d, 'big.txt'), Buffer.concat([Buffer.alloc(9 * 1024 * 1024, 0x20), Buffer.from(src.list[7].aya_text)]));
  assert.ok(layer2(d, syn.recordPath).some((x) => /ayah .* found \(UTF-8\)/.test(x.reason)));
});

test('M-1: a binary file passes only with its exact path and SHA-256 on the allow list', () => {
  const d = tmp('m1-allow');
  mkdirSync(join(d, 'scripts'), { recursive: true });
  mkdirSync(join(d, 'fonts'), { recursive: true });
  const bin = Buffer.from([0, 1, 2, 3, 0xff, 0xfe]);
  writeFileSync(join(d, 'fonts/a.woff2'), bin);
  assert.ok(layer1(d).some((x) => /allow list/.test(x.reason)));
  const sha = createHash('sha256').update(bin).digest('hex');
  writeFileSync(join(d, 'scripts/binary-allowlist.json'), JSON.stringify({ files: [{ path: 'fonts/a.woff2', sha256: sha, reason: 'test' }] }));
  assert.equal(layer1(d).length, 0);
  writeFileSync(join(d, 'fonts/a.woff2'), Buffer.concat([bin, Buffer.from([9])]));
  assert.ok(layer1(d).some((x) => /allow list/.test(x.reason)), 'a changed file fails again');
});

test('M-1: .gitignore blocks build output, archives and secrets', () => {
  const g = readFileSync('.gitignore', 'utf8').split('\n').map((l) => l.trim());
  for (const p of ['*.bin', '*.zip', '*.gz', 'build/', '.dev.vars*', '.env*', '*.pem', '*.key']) assert.ok(g.includes(p), p);
});
