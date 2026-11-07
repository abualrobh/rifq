// RQ-002 AC8 counter and backstop: TP2-18 (unit level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT, MemoryLimiter, SearchCounter } from '../../src/core/ratelimit.ts';

test('TP2-18: 30 searches pass inside one minute, the 31st waits, and the window rolls', () => {
  let now = 1_000_000;
  const c = new SearchCounter(null, () => now);
  for (let i = 0; i < LIMIT; i++) { assert.equal(c.take(), 0); now += 1000; }
  const wait = c.take();
  assert.ok(wait >= 1 && wait <= 60, String(wait));
  now = 1_000_000 + 60_001;
  assert.equal(c.take(), 0);
});

test('counter stores times only and survives broken storage', () => {
  const st = { v: '', getItem() { return this.v || null; }, setItem(_k: string, v: string) { this.v = v; } };
  const c = new SearchCounter(st as any, () => 5);
  c.take();
  assert.equal(st.v, '[5]');
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const c2 = new SearchCounter(bad as any, () => 5);
  assert.equal(c2.take(), 0);
});

test('server backstop: 30 per key per window', () => {
  let now = 0;
  const m = new MemoryLimiter(30, 60_000, () => now);
  for (let i = 0; i < 30; i++) assert.equal(m.allow('k'), true);
  assert.equal(m.allow('k'), false);
  assert.equal(m.allow('other'), true);
  now = 60_001;
  assert.equal(m.allow('k'), true);
});
