// D-169 A (QA FIND-AJ, kit v32): the Worker checks at startup that worker-data.bin comes from the
// same build as the Worker itself, and refuses to start otherwise (fail closed, like a missing,
// short or empty module).
//
// At build time (scripts/build.ts) the module made by encodeWorkerData (src/core/worker-data.ts,
// unchanged) is laid out once more with a build ID in its JSON header: {"v":1,"build":"<id>",
// "sections":{...}}. The ID is the SHA-256 of the module as encodeWorkerData made it, so it names
// the data content. The same ID, the module's final size and its section table (name -> [byte
// offset, byte length, kind]) go into the Worker config (worker-config.json, part of the bundle) as
// `workerData`. decodeWorkerData reads only "v" and "sections", so the added key changes nothing
// in how the data is read.
//
// At startup (checkWorkerDataStamp, called by withWorkerData before anything is decoded) the Worker
// compares the module's size, the header's build ID and every section's offset, length and kind
// with the values in its config, and checks each section lies inside the module. Nothing is hashed
// at startup: the header (about 1 KB) is parsed and a few numbers are compared.
//
// Layout rules are those of encodeWorkerData: "RIFQWD01", a 32-bit little-endian header length,
// the header, then the sections in the same order, each on a 4-byte boundary.
// Holds no Quran or Tafseer text; pure TypeScript so the Worker and Node share it.

const MAGIC = 'RIFQWD01';
export type Section = [number, number, string];
export type WorkerDataStamp = { id: string; bytes: number; sections: Record<string, Section> };
type Header = { v: number; build?: unknown; sections: Record<string, Section> };

function readHeader(u8: Uint8Array): Header {
  const dec = new TextDecoder('utf-8', { fatal: true });
  if (u8.length < 12 || dec.decode(u8.subarray(0, 8)) !== MAGIC) throw new Error('worker data: bad magic');
  const hl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(8, true);
  if (12 + hl > u8.length) throw new Error('worker data: header longer than the module');
  const head = JSON.parse(dec.decode(u8.subarray(12, 12 + hl))) as Header;
  if (!head || typeof head !== 'object' || !head.sections || typeof head.sections !== 'object') throw new Error('worker data: no section table');
  return head;
}

// Build time: the module laid out again with `id` in its header. Section bytes and order are
// unchanged; only their offsets move. Returns the new module and the stamp for the Worker config.
export function stampWorkerData(bin: Uint8Array, id: string): { bin: Uint8Array; stamp: WorkerDataStamp } {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('worker data: build ID must be 64 lowercase hex');
  const head = readHeader(bin);
  const parts = Object.entries(head.sections).map(([name, [off, len, kind]]) => ({ name, kind, bytes: bin.subarray(off, off + len) }));
  const enc = new TextEncoder();
  const layout = (start: number) => {
    const sections: Record<string, Section> = {};
    let at = start;
    for (const p of parts) { at = (at + 3) & ~3; sections[p.name] = [at, p.bytes.length, p.kind]; at += p.bytes.length; }
    return { sections, end: at };
  };
  const json = (sections: Record<string, Section>) => JSON.stringify({ v: head.v, build: id, sections });
  let start = 12 + enc.encode(json(layout(1e9).sections)).length;
  for (;;) {
    const l = layout(start);
    const h = enc.encode(json(l.sections).padEnd(start - 12, ' '));
    if (h.length === start - 12) {
      const out = new Uint8Array(l.end);
      out.set(enc.encode(MAGIC), 0);
      new DataView(out.buffer).setUint32(8, h.length, true);
      out.set(h, 12);
      for (const p of parts) out.set(p.bytes, l.sections[p.name][0]);
      return { bin: out, stamp: { id, bytes: out.length, sections: l.sections } };
    }
    start = 12 + h.length;
  }
}

// Startup: throws unless the module is the one this Worker was built with.
export function checkWorkerDataStamp(buf: ArrayBuffer, stamp: WorkerDataStamp | undefined | null): void {
  if (!stamp || typeof stamp.id !== 'string' || !stamp.sections) throw new Error('worker data: this Worker has no build ID for its data module');
  if (buf.byteLength !== stamp.bytes) throw new Error(`worker data: module is ${buf.byteLength} bytes, this build made ${stamp.bytes}`);
  const head = readHeader(new Uint8Array(buf));
  if (head.build !== stamp.id) throw new Error('worker data: module comes from another build (build ID differs)');
  const want = Object.keys(stamp.sections), got = Object.keys(head.sections);
  if (want.length !== got.length) throw new Error(`worker data: ${got.length} sections, this build made ${want.length}`);
  for (const name of want) {
    const a = stamp.sections[name], b = head.sections[name];
    if (!b) throw new Error(`worker data: section ${name} missing`);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) throw new Error(`worker data: section ${name} differs from this build`);
    if (!(b[0] >= 0 && b[1] >= 0 && b[0] + b[1] <= buf.byteLength)) throw new Error(`worker data: section ${name} outside the module`);
  }
}
