// D-079: a SHA-256 fingerprint of each Tafseer passage is recorded at review, and every fetched
// passage is compared with it. Only fingerprints are kept, never the passage.
//
// Store format (a JSON file in the private data repository, never in the public one):
//   {
//     "format": "rifq-tafseer-fingerprints/1",
//     "entries": [
//       { "ref": "2:255", "tafsirId": 123, "sha256": "<64 lowercase hex>", "reviewed": "2026-11-08" }
//     ]
//   }
// - ref: "S:A", the ayah the passage was requested for (surah and ayah numbers of the D-011 file).
// - tafsirId: the Quran Foundation tafsir resource ID the passage came from.
// - sha256: SHA-256 of the UTF-8 bytes of the API's `text` string exactly as delivered (no
//   decoding, trimming or Unicode normalization).
// - reviewed: the date of the D-012 review, YYYY-MM-DD.
// One entry per (tafsirId, ref). The file holds no Tafseer text, no reader data and no reviewer
// personal data. Whether keeping fingerprints is allowed is to be confirmed with Quran Foundation
// (D-079); their Developer Terms dated 2026-10-11 do not mention hashes or fingerprints.
// Pure TypeScript using Web Crypto, so the Worker and Node share it.

export const FINGERPRINT_FORMAT = 'rifq-tafseer-fingerprints/1';
export type FingerprintEntry = { ref: string; tafsirId: number; sha256: string; reviewed: string };
export type FingerprintFile = { format: string; entries: FingerprintEntry[] };

const REF = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,2})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Checks a parsed store. Returns the problems found (empty when valid). Messages never include
// anything but field names, positions and references.
export function checkFingerprints(x: unknown, counts?: number[]): string[] {
  const out: string[] = [];
  if (!x || typeof x !== 'object') return ['store is not an object'];
  const f = x as Record<string, unknown>;
  if (f.format !== FINGERPRINT_FORMAT) out.push(`format must be "${FINGERPRINT_FORMAT}"`);
  if (!Array.isArray(f.entries)) return [...out, 'entries must be an array'];
  const seen = new Set<string>();
  f.entries.forEach((e: unknown, i: number) => {
    if (!e || typeof e !== 'object') { out.push(`entry ${i}: not an object`); return; }
    const r = e as Record<string, unknown>;
    const extra = Object.keys(r).filter((k) => !['ref', 'tafsirId', 'sha256', 'reviewed'].includes(k));
    if (extra.length) out.push(`entry ${i}: unknown fields ${extra.join(', ')}`);
    const m = typeof r.ref === 'string' ? REF.exec(r.ref) : null;
    if (!m) out.push(`entry ${i}: ref must be "S:A"`);
    else if (counts && !(Number(m[1]) < counts.length && Number(m[2]) <= counts[Number(m[1])])) out.push(`entry ${i}: ref ${r.ref} is not in the Quran source`);
    if (!Number.isInteger(r.tafsirId) || (r.tafsirId as number) < 1) out.push(`entry ${i}: tafsirId must be a positive integer`);
    if (typeof r.sha256 !== 'string' || !HEX64.test(r.sha256)) out.push(`entry ${i}: sha256 must be 64 lowercase hex characters`);
    if (typeof r.reviewed !== 'string' || !DATE.test(r.reviewed) || Number.isNaN(Date.parse(r.reviewed + 'T00:00:00Z'))) out.push(`entry ${i}: reviewed must be a date YYYY-MM-DD`);
    const key = `${r.tafsirId}|${r.ref}`;
    if (seen.has(key)) out.push(`entry ${i}: duplicate for tafsir ${r.tafsirId} ${r.ref}`);
    seen.add(key);
  });
  return out;
}

export function emptyFingerprints(): FingerprintFile { return { format: FINGERPRINT_FORMAT, entries: [] }; }

// Lookup table: "tafsirId|S:A" -> entry.
export function fingerprintMap(f: FingerprintFile | null | undefined): Map<string, FingerprintEntry> {
  const m = new Map<string, FingerprintEntry>();
  for (const e of f?.entries ?? []) m.set(`${e.tafsirId}|${e.ref}`, e);
  return m;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

export type ReviewState =
  | { state: 'none' }
  | { state: 'match'; reviewed: string }
  | { state: 'changed'; reviewed: string };

// Compares a delivered passage with its fingerprint, when one exists.
export async function reviewState(map: Map<string, FingerprintEntry>, tafsirId: number, ref: string, text: string): Promise<ReviewState> {
  const e = map.get(`${tafsirId}|${ref}`);
  if (!e) return { state: 'none' };
  return (await sha256Hex(text)) === e.sha256 ? { state: 'match', reviewed: e.reviewed } : { state: 'changed', reviewed: e.reviewed };
}
