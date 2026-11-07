// Source gate (RQ-001 AC7, architecture section 3 step 4). Pure logic; scripts/gate.ts runs it.
// Release mode stops unless the source record says exactly "approved" and the file's SHA-256
// matches the record. The D-045 development file can never pass in release mode.
export type Mode = 'release' | 'development';
export type SourceRecord = {
  name: string;
  edition: string;
  file: string;
  sha256: string;
  status: string;
  decision?: string;
  recorded?: string;
};

export const D045_SHA256 = '5d8bb91726e482839d0057633cb1973031e4d706fa9604eea5e08892f20ba140';
const HEX64 = /^[0-9a-f]{64}$/;

export function checkRecordShape(r: unknown): string[] {
  const out: string[] = [];
  if (!r || typeof r !== 'object') return ['record missing or not an object'];
  const x = r as Record<string, unknown>;
  for (const k of ['name', 'edition', 'file', 'sha256', 'status']) {
    if (typeof x[k] !== 'string' || !(x[k] as string).trim()) out.push(`record field "${k}" missing`);
  }
  if (typeof x.sha256 === 'string' && !HEX64.test(x.sha256)) out.push('record sha256 is not 64 lowercase hex characters');
  return out;
}

export function gate(mode: Mode, record: unknown, fileSha256: string | null): { ok: boolean; reasons: string[] } {
  const reasons = checkRecordShape(record);
  const r = record as SourceRecord;
  if (fileSha256 === null) reasons.push('source file missing');
  else if (!reasons.length && fileSha256 !== r.sha256) reasons.push('source file SHA-256 does not match the record');
  if (mode === 'release') {
    if (r?.status !== 'approved') reasons.push(`source status is "${r?.status ?? 'missing'}", not "approved"`);
    if (fileSha256 === D045_SHA256 || r?.sha256 === D045_SHA256) reasons.push('the D-045 development file is UNVERIFIED and can never be released');
  } else if (mode !== 'development') {
    reasons.push(`unknown mode "${String(mode)}"`);
  }
  return { ok: reasons.length === 0, reasons };
}
