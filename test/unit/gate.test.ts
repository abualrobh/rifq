// RQ-001 AC7 source gate: TP1-18, TP1-19, TP1-20. Records are made up and hold no Quran text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { D045_SHA256, gate } from '../../src/core/source-gate.ts';

const SHA = 'a'.repeat(64);
const rec = (status: string, sha = SHA) => ({ name: 'Test source', edition: 'v0', file: 'x.json', sha256: sha, status });

test('TP1-18: approved record with matching hash passes in release mode', () => {
  assert.deepEqual(gate('release', rec('approved'), SHA), { ok: true, reasons: [] });
});

test('TP1-19: Candidate, Not selected, Selected, wrong case and missing records fail in release mode', () => {
  for (const s of ['Candidate', 'Not selected', 'Selected', 'Selected under D-011', 'Approved', 'approved ', '']) {
    assert.equal(gate('release', rec(s), SHA).ok, false, JSON.stringify(s));
  }
  assert.equal(gate('release', null, SHA).ok, false);
  assert.equal(gate('release', { name: 'x', edition: 'y', file: 'z', sha256: SHA }, SHA).ok, false);
});

test('TP1-20: the D-045 file fails release even if its record were marked approved', () => {
  assert.equal(gate('release', rec('UNVERIFIED, development only (D-045)', D045_SHA256), D045_SHA256).ok, false);
  const r = gate('release', rec('approved', D045_SHA256), D045_SHA256);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /D-045/);
});

test('hash mismatch or missing file fails in both modes; development allows unverified records', () => {
  assert.equal(gate('release', rec('approved'), 'b'.repeat(64)).ok, false);
  assert.equal(gate('development', rec('UNVERIFIED'), 'b'.repeat(64)).ok, false);
  assert.equal(gate('development', rec('UNVERIFIED'), null).ok, false);
  assert.equal(gate('development', rec('UNVERIFIED'), SHA).ok, true);
  assert.equal(gate('staging' as any, rec('approved'), SHA).ok, false);
});
