// Kit v32 (Cloudflare CPU after kit v31): the Worker's large private data as one binary Data module
// (worker-data.bin next to search-index.bin), instead of a JavaScript object literal in the bundle.
// In kit v31 the letters-only matching data (D-157) and the D-081 hashes were written into the
// bundle as a 6.9 MB object literal (escaped strings and long number lists). Parsing and building
// it is the Worker's startup work: about 35 to 45 ms of CPU locally (Node 22), of which about 2 ms
// is left without it. Here nothing large is parsed or decoded at startup: the numbers are Int32Array
// views and the letters Uint16Array views (UTF-16 code units) on the module's bytes (no copy, not
// scanned by the garbage collector), read a piece at a time (see PackedForm), and the hashes stay
// bytes until the D-081 page needs one.
//
// Layout: "RIFQWD01", a 32-bit little-endian header length, the header (JSON: section name ->
// [byte offset, byte length, kind]), then the sections; Int32 sections start on a 4-byte boundary.
// Kinds: "u16" (a string as UTF-16 code units, Uint16Array), "i32" (Int32Array), "bytes" (Uint8Array).
// Sections: <form>.all, <form>.words (u16); <form>.off, .len, .woff, .seq, .pstart, .plist, .wpos (i32)
//   for each letters form (see PackedForm in tafseer-quotes.ts); hash.full, hash.bare (bytes, 32 per
//   ayah, D-081); "check" (i32 [0x01020304], so a reader with another byte order fails closed).
// D-157: this module holds the letters-only Quran text; it is part of the Worker bundle only. The
// build never writes it into site/, and nothing in the Worker ever sends it in a response.
import type { Form, PackedForm } from './tafseer-quotes.ts';

const MAGIC = 'RIFQWD01';
const CHECK = 0x01020304;
const I32 = ['off', 'len', 'woff', 'seq', 'pstart', 'plist', 'wpos'] as const;
type Kind = 'u16' | 'i32' | 'bytes';
export type HashBytes = { bytes: Uint8Array };
export type WorkerData = { letters: Partial<Record<Form, PackedForm>> | null; hashes: { full: HashBytes; bare: HashBytes } | null };

export function encodeWorkerData(d: { letters?: Partial<Record<Form, PackedForm>> | null; hashes?: { full: string[]; bare: string[] } | null }): Uint8Array {
  const parts: { name: string; kind: Kind; bytes: Uint8Array }[] = [];
  const enc = new TextEncoder();
  const i32 = (x: ArrayLike<number>) => { const a = Int32Array.from(x); return new Uint8Array(a.buffer, a.byteOffset, a.byteLength); };
  const u16 = (t: string) => { const a = new Uint16Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return new Uint8Array(a.buffer); };
  const text = (f: PackedForm, n: 'all' | 'words') => (typeof f[n] === 'string' ? (f[n] as string) : undefined);
  parts.push({ name: 'check', kind: 'i32', bytes: i32([CHECK]) });
  for (const [k, f] of Object.entries(d.letters ?? {}) as [Form, PackedForm][]) {
    const all = text(f, 'all'), words = text(f, 'words');
    if (all === undefined) throw new Error('worker data: a form without its text');
    parts.push({ name: `${k}.all`, kind: 'u16', bytes: u16(all) });
    if (words !== undefined) parts.push({ name: `${k}.words`, kind: 'u16', bytes: u16(words) });
    for (const n of I32) { const v = f[n]; if (v) parts.push({ name: `${k}.${n}`, kind: 'i32', bytes: i32(v) }); }
  }
  if (d.hashes) for (const n of ['full', 'bare'] as const) {
    const list = d.hashes[n];
    const b = new Uint8Array(list.length * 32);
    list.forEach((h, i) => { if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('hash is not 64 lowercase hex'); for (let j = 0; j < 32; j++) b[i * 32 + j] = parseInt(h.slice(j * 2, j * 2 + 2), 16); });
    parts.push({ name: `hash.${n}`, kind: 'bytes', bytes: b });
  }
  // The header holds offsets, so its length is found first with placeholder offsets of the final width.
  const layout = (start: number) => {
    const sections: Record<string, [number, number, Kind]> = {};
    let at = start;
    for (const p of parts) { at = (at + 3) & ~3; sections[p.name] = [at, p.bytes.length, p.kind]; at += p.bytes.length; }
    return { sections, end: at };
  };
  let head = enc.encode(JSON.stringify({ v: 1, sections: layout(1e9).sections }));
  let start = 12 + head.length;
  for (;;) {
    const l = layout(start);
    head = enc.encode(JSON.stringify({ v: 1, sections: l.sections }).padEnd(start - 12, ' '));
    if (head.length === start - 12) {
      const out = new Uint8Array(l.end);
      out.set(enc.encode(MAGIC), 0);
      new DataView(out.buffer).setUint32(8, head.length, true);
      out.set(head, 12);
      for (const p of parts) out.set(p.bytes, l.sections[p.name][0]);
      return out;
    }
    start = 12 + head.length;
  }
}

export function decodeWorkerData(buf: ArrayBuffer): WorkerData {
  const u8 = new Uint8Array(buf);
  const dec = new TextDecoder('utf-8', { fatal: true });
  if (u8.length < 12 || dec.decode(u8.subarray(0, 8)) !== MAGIC) throw new Error('worker data: bad magic');
  const hl = new DataView(buf).getUint32(8, true);
  const head = JSON.parse(dec.decode(u8.subarray(12, 12 + hl))) as { v: number; sections: Record<string, [number, number, Kind]> };
  if (head.v !== 1) throw new Error('worker data: version');
  const get = (name: string) => {
    const s = head.sections[name];
    if (!s) return undefined;
    const [off, len, kind] = s;
    if (kind === 'u16') return new Uint16Array(buf, off, len / 2);
    if (kind === 'i32') return new Int32Array(buf, off, len / 4);
    return u8.subarray(off, off + len);
  };
  const check = get('check');
  if (!(check instanceof Int32Array) || check[0] !== CHECK) throw new Error('worker data: byte order');
  const letters: Partial<Record<Form, PackedForm>> = {};
  for (const k of ['uthmani', 'emlaey'] as Form[]) {
    const all = get(`${k}.all`);
    if (!(all instanceof Uint16Array)) continue;
    const f: Record<string, unknown> = { allU16: all };
    const words = get(`${k}.words`);
    if (words instanceof Uint16Array) f.wordsU16 = words;
    for (const n of I32) { const v = get(`${k}.${n}`); if (v instanceof Int32Array) f[n] = v; }
    letters[k] = f as unknown as PackedForm;
  }
  const full = get('hash.full'), bare = get('hash.bare');
  return {
    letters: Object.keys(letters).length ? letters : null,
    hashes: full instanceof Uint8Array && bare instanceof Uint8Array ? { full: { bytes: full }, bare: { bytes: bare } } : null,
  };
}

// The i-th SHA-256 of a hash list as 64 lowercase hex characters (undefined past the end).
export function hashHex(list: readonly string[] | HashBytes, i: number): string | undefined {
  if (Array.isArray(list)) return list[i];
  const b = (list as HashBytes).bytes;
  if (!Number.isInteger(i) || i < 0 || (i + 1) * 32 > b.length) return undefined;
  let s = '';
  for (let j = i * 32; j < i * 32 + 32; j++) s += (b[j] < 16 ? '0' : '') + b[j].toString(16);
  return s;
}
