// Kit v33, D-169 A (QA FIND-AJ): the Worker starts only with the worker-data.bin of its own build
// (build ID, size and section table, src/core/worker-data-stamp.ts). Synthetic data only; the
// hashes are made-up hex. No Quran text is typed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { synthetic } from '../fixtures/load.ts';
import { SYN_COUNTS } from '../fixtures/synthetic.ts';
import { bareAyah, lettersOnly, packLetters } from '../../src/core/tafseer-quotes.ts';
import { decodeWorkerData, encodeWorkerData, hashHex } from '../../src/core/worker-data.ts';
import { checkWorkerDataStamp, stampWorkerData, type WorkerDataStamp } from '../../src/core/worker-data-stamp.ts';
import { withWorkerData } from '../../src/worker/bundle-data.ts';

const { src } = synthetic('worker-data-stamp');
const counts = [0, ...SYN_COUNTS.slice(1)];
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const uth = src.list.map((a) => lettersOnly(bareAyah(a.aya_text)));
const hashes = (seed: number) => ({ full: src.list.map((_a, i) => ((i + 1) * seed).toString(16).padStart(64, '0')), bare: src.list.map((_a, i) => ((i + 3) * seed).toString(16).padStart(64, 'f')) });
// The two forms, as scripts/build.ts packs them (the second form is made up from the first).
const lettersOf = (u: string[]) => packLetters(counts, { uthmani: u, emlaey: u.map((l) => l.split(' ').reverse().join(' ')) }).forms;
// A module as scripts/build.ts writes it: encodeWorkerData, then the build ID (its SHA-256).
const build = (d: Parameters<typeof encodeWorkerData>[0]) => { const raw = encodeWorkerData(d); return { raw, ...stampWorkerData(raw, sha(raw)) }; };
const cfgOf = (workerData: WorkerDataStamp | undefined) => ({ dev: true, record: { name: 'S', edition: 'e', status: 's' }, lettersQuran: { counts, sha256: 'a'.repeat(64), checkVersion: 'm1-test' }, verifyHashes: { counts }, workerData }) as never;
const ab = (u: Uint8Array) => u.slice().buffer;

// Rewrites the module's JSON header in place (same header length, padded with spaces), so the
// module stays well formed.
function editHeader(bin: Uint8Array, f: (h: { v: number; build: string; sections: Record<string, [number, number, string]> }) => void): Uint8Array {
  const out = bin.slice();
  const hl = new DataView(out.buffer).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(out.subarray(12, 12 + hl)));
  f(h);
  const t = new TextEncoder().encode(JSON.stringify(h).padEnd(hl, ' '));
  assert.equal(t.length, hl, 'edited header fits');
  out.set(t, 12);
  return out;
}

const A = build({ letters: lettersOf(uth), hashes: hashes(7919) });

test('D-169 A: the stamped module reads exactly like the unstamped one; the ID is the content SHA-256', () => {
  assert.equal(A.stamp.id, sha(A.raw));
  assert.equal(A.stamp.bytes, A.bin.length);
  const h = JSON.parse(new TextDecoder().decode(A.bin.subarray(12, 12 + new DataView(A.bin.buffer).getUint32(8, true))));
  assert.equal(h.build, A.stamp.id, 'build ID in the module header');
  assert.deepEqual(h.sections, A.stamp.sections, 'section table in the config equals the header');
  for (const [, [off]] of Object.entries(A.stamp.sections)) assert.equal(off % 4, 0, 'every section on a 4-byte boundary');
  const x = decodeWorkerData(ab(A.raw)), y = decodeWorkerData(ab(A.bin));
  for (const k of ['uthmani', 'emlaey'] as const) for (const n of ['allU16', 'wordsU16', 'off', 'len', 'woff', 'seq', 'pstart', 'plist', 'wpos'] as const) {
    assert.deepEqual(Array.from((y.letters![k] as never)[n] as ArrayLike<number>), Array.from((x.letters![k] as never)[n] as ArrayLike<number>), `${k}.${n}`);
  }
  for (let i = 0; i < src.list.length; i++) { assert.equal(hashHex(y.hashes!.full, i), hashHex(x.hashes!.full, i)); assert.equal(hashHex(y.hashes!.bare, i), hashHex(x.hashes!.bare, i)); }
  // Same content, same ID: the build ID names the data, so two builds of the same data agree.
  assert.deepEqual(build({ letters: lettersOf(uth), hashes: hashes(7919) }).stamp, A.stamp);
});

test('D-169 A: the matching module of the same build starts', () => {
  assert.doesNotThrow(() => checkWorkerDataStamp(ab(A.bin), A.stamp));
  const cfg = withWorkerData(cfgOf(A.stamp), ab(A.bin));
  assert.ok(cfg.lettersQuran?.packed?.uthmani && cfg.lettersQuran.packed.emlaey && cfg.verifyHashes?.full);
  assert.equal('workerData' in cfg, false);
});

test('D-169 A: a module from another build is refused (Worker does not start)', () => {
  // Same size and the same section table, different content (other hashes): only the ID differs.
  const B = build({ letters: lettersOf(uth), hashes: hashes(104729) });
  assert.equal(B.bin.length, A.bin.length);
  assert.deepEqual(B.stamp.sections, A.stamp.sections);
  assert.notEqual(B.stamp.id, A.stamp.id);
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(B.bin)), /another build/);
  assert.throws(() => withWorkerData(cfgOf(B.stamp), ab(A.bin)), /another build/);
  // Other letters (another approved file): another size and ID.
  const C = build({ letters: lettersOf(uth.map((l) => l.split(' ').slice(1).join(' '))), hashes: hashes(7919) });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(C.bin)), /worker data: module is \d+ bytes, this build made \d+/);
  // A kit v32 module (no build ID in its header), even with exactly this build's data.
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(A.raw)), /worker data: /);
  const v32Sized = editHeader(A.bin, (h) => { delete (h as { build?: string }).build; });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(v32Sized)), /another build/);
  // A Worker config without a stamp (a kit v32 Worker given any module).
  assert.throws(() => withWorkerData(cfgOf(undefined), ab(A.bin)), /no build ID/);
});

test('D-169 A: a well-formed module with a section missing or changed is refused', () => {
  // QA FIND-AJ variants, built and stamped as their own build, then given to this build's Worker.
  const noEmlaey = build({ letters: packLetters(counts, { uthmani: uth }).forms, hashes: hashes(7919) });
  const fewHashes = build({ letters: lettersOf(uth), hashes: { full: hashes(7919).full.slice(0, 100), bare: hashes(7919).bare.slice(0, 100) } });
  const lettersOnlyMod = build({ letters: lettersOf(uth) });
  for (const m of [noEmlaey, fewHashes, lettersOnlyMod]) assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(m.bin)), /worker data: /);
  // The same module with this build's ID copied into the header: the size or table still differ.
  for (const m of [noEmlaey, fewHashes]) {
    const forged = editHeader(m.bin, (h) => { h.build = A.stamp.id; });
    assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(forged)), /worker data: (module is|section|\d+ sections)/);
  }
  // Same bytes and ID; one section dropped from the header table.
  const dropped = editHeader(A.bin, (h) => { delete h.sections['emlaey.wpos']; });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(dropped)), /sections, this build made/);
  // Same bytes and ID; one section's length, offset or kind changed.
  const shorter = editHeader(A.bin, (h) => { h.sections['uthmani.off'][1] -= 4; });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(shorter)), /section uthmani\.off differs/);
  const moved = editHeader(A.bin, (h) => { h.sections['hash.full'][0] += 4; });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(moved)), /section hash\.full differs/);
  const kind = editHeader(A.bin, (h) => { h.sections['uthmani.len'][2] = 'bytes'; });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(kind)), /section uthmani\.len differs/);
  // A section renamed (missing under its own name).
  const renamed = editHeader(A.bin, (h) => { h.sections['uthmani.lex'] = h.sections['uthmani.len']; delete h.sections['uthmani.len']; });
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(renamed)), /section uthmani\.len missing/);
  // One byte short, or one byte more, keeps everything else: refused by size.
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(A.bin.subarray(0, A.bin.length - 1))), /module is/);
  const longer = new Uint8Array(A.bin.length + 1); longer.set(A.bin);
  assert.throws(() => withWorkerData(cfgOf(A.stamp), ab(longer)), /module is/);
  // Missing, empty and malformed modules still refuse, as in kit v32.
  assert.throws(() => withWorkerData(cfgOf(A.stamp), new ArrayBuffer(0)), /worker data: /);
  assert.throws(() => withWorkerData(cfgOf({ ...A.stamp, bytes: 16 }), new Uint8Array(16).buffer), /bad magic/);
  // A config whose own table points outside the module (not made by the build) is refused too.
  const bad = { ...A.stamp, sections: { ...A.stamp.sections, 'hash.bare': [A.stamp.bytes - 4, 64, 'bytes'] as [number, number, string] } };
  const out = editHeader(A.bin, (h) => { h.sections['hash.bare'] = bad.sections['hash.bare']; });
  assert.throws(() => checkWorkerDataStamp(ab(out), bad), /outside the module/);
});

test('D-169 A: the build ID must be 64 lowercase hex', () => {
  assert.throws(() => stampWorkerData(A.raw, 'x'), /64 lowercase hex/);
});
