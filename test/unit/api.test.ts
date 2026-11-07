// RQ-002 input rules and offers: TP2-28, TP2-29, TP2-30, TP2-31, TP2-32, TP2-35, TP2-36 (unit level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { handleJson, runQuery, validate, parseRef, type SearchOk } from '../../src/core/api.ts';

const { src, ix } = synthetic('api');
const AR = (n: number) => String.fromCodePoint(0x628).repeat(n);
const arDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(0x660 + Number(d)));

test('TP2-32: 100 characters accepted, 101 refused by the server', () => {
  assert.equal(validate(AR(100)), null);
  assert.equal(validate(AR(101)), 'too_long');
  assert.equal(handleJson(ix, JSON.stringify({ q: AR(101) })).status, 400);
  assert.equal(handleJson(ix, 'x'.repeat(5000)).status, 413);
});

test('TP2-30: Latin letters give the Arabic-only error and no results or offers', () => {
  for (const q of ['hello', 'Synthetic 2', '2:a', 'café']) {
    const r = runQuery(ix, q, 1);
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { error: 'latin' });
  }
});

test('TP2-31: Arabic with Latin digits is not treated as English', () => {
  assert.equal(validate(AR(3) + ' 12'), null);
});

test('TP2-28: references in Latin and Arabic digits are offered', () => {
  for (const q of ['2', '2:5', ' 2 : 5 ', arDigits('2:5'), arDigits('5')]) {
    const r = runQuery(ix, q, 1).data as SearchOk;
    assert.equal(r.ref, 'found', q);
    assert.equal(r.offers.length, 1);
  }
  const r = runQuery(ix, '2:5', 1).data as SearchOk;
  assert.deepEqual([r.offers[0].kind, r.offers[0].s, (r.offers[0] as any).a], ['ayah', 2, 5]);
});

test('TP2-28: surah names in Arabic are offered, with or without marks', () => {
  const name = src.list.find((a) => a.sora === 4)!.sora_name_ar;
  const bare = name.replace(/[\u064b-\u065f]/g, '');
  for (const q of [name, bare]) {
    const r = runQuery(ix, q, 1).data as SearchOk;
    assert.ok(r.offers.some((o) => o.kind === 'surah' && o.s === 4), 'surah 4 offered');
  }
});

test('TP2-29: references that do not exist offer nothing', () => {
  for (const q of ['8', '0', '2:41', '2:0', arDigits('99:1')]) {
    const r = runQuery(ix, q, 1).data as SearchOk;
    assert.equal(r.ref, 'missing', q);
    assert.equal(r.offers.length, 0);
  }
  assert.equal(parseRef('2:5:1'), null);
});

test('TP2-35: empty and space-only queries are refused with "empty"', () => {
  assert.deepEqual(runQuery(ix, '', 1).data, { error: 'empty' });
  assert.deepEqual(runQuery(ix, '   ', 1).data, { error: 'empty' });
  assert.deepEqual(handleJson(ix, '{"q":null}').data, { error: 'empty' });
});

test('TP2-36: script and injection payloads are plain text', () => {
  assert.deepEqual(runQuery(ix, '<script>alert(1)</script>', 1).data, { error: 'latin' });
  const r = runQuery(ix, AR(2) + ` "'<>&;--`, 1);
  assert.equal(r.status, 200);
  assert.equal((r.data as SearchOk).total, 0);
  assert.equal(handleJson(ix, '{"q":').status, 400);
  assert.equal(handleJson(ix, '{"__proto__":{"q":"x"}}').status, 400);
});
