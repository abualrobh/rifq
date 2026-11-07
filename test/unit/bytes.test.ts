// RQ-001 AC4 harness self-tests: TP1-10 and TP1-37 (synthetic mismatch). No Quran text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSurahPage, extractAyat, sameBytes, type ByteReport } from '../../scripts/check-bytes.ts';
import { SYN_EQUIV_A, SYN_EQUIV_B } from '../fixtures/synthetic.ts';
import { synthetic } from '../fixtures/load.ts';

const enc = (s: string) => Buffer.from(s, 'utf8');

test('TP1-10: canonically equivalent strings with different bytes are reported as different', () => {
  assert.equal(SYN_EQUIV_A.normalize('NFC'), SYN_EQUIV_B.normalize('NFC'), 'the pair is canonically equivalent');
  assert.equal(sameBytes(enc(SYN_EQUIV_A), enc(SYN_EQUIV_B)), false);
  assert.equal(sameBytes(enc(SYN_EQUIV_A), enc(SYN_EQUIV_A)), true);
});

test('extractAyat reads raw bytes between the markers', () => {
  const html = enc(`<ol><li><p class="ayah" data-r="1:1">${SYN_EQUIV_A}</p></li><li><p class="ayah" lang="ar" data-r="1:2">${SYN_EQUIV_B}</p></li></ol>`);
  const got = extractAyat(html);
  assert.deepEqual(got.map((g) => g.ref), ['1:1', '1:2']);
  assert.ok(got[0].bytes.equals(enc(SYN_EQUIV_A)));
  assert.ok(got[1].bytes.equals(enc(SYN_EQUIV_B)));
});

test('TP1-37: a one-byte change, a reordered pair, a missing ayah and an entity are all caught', () => {
  const { src } = synthetic('bytes');
  const s = 2;
  const items = src.list.map((a, n) => ({ a, n })).filter((x) => x.a.sora === s);
  const page = (f: (b: Buffer, i: number) => Buffer | null) => Buffer.concat(items.flatMap((x, i) => {
    const b = f(Buffer.from(src.slices[x.n]), i);
    return b ? [enc(`<li><p class="ayah" data-r="${s}:${x.a.aya_no}">`), b, enc('</p></li>')] : [];
  }));
  const run = (html: Buffer) => { const r: ByteReport = { route: '/', pages: 0, ayat: 0, equal: 0, mismatches: [], refErrors: [] }; compareSurahPage(src, s, html, r); return r; };
  assert.equal(run(page((b) => b)).equal, items.length);
  assert.equal(run(page((b, i) => { if (i === 3) b[0] ^= 1; return b; })).mismatches.length, 1);
  assert.equal(run(page((b, i) => (i === 4 ? enc(SYN_EQUIV_B) : b))).mismatches.length, 1);
  assert.ok(run(page((b, i) => (i === 0 ? null : b))).refErrors.length > 0);
  assert.equal(run(page((b, i) => (i === 1 ? Buffer.concat([b, enc('&amp;')]) : b))).mismatches.length, 1);
});
