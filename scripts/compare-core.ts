// Checks that the TypeScript search core gives the same response as a reference core (the round 4
// file) on every given query. Since round 2 (D-072, D-073) the core uses the approved D-027 rules
// and index format version 2, so this comparison holds only against a reference built the same way. Run on the private side, because the query files hold Quran words.
//   node scripts/compare-core.ts --reference <core.mjs> --index <bin> --queries <json>... [--generator <mjs> --n <N>]
// Query files hold either [{raw}] (request bodies) or [{q, page}]. Output: counts only.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleRound4, openIndex } from '../src/core/search-core.ts';
import { handleJson } from '../src/core/api.ts';

const argv = process.argv.slice(2);
const all = (k: string) => argv.flatMap((a, i) => (argv[i - 1] === '--' + k ? [a] : []));
const one = (k: string) => all(k)[0];
const load = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

const ref = await import(pathToFileURL(resolve(one('reference'))).href);
const buf = load(one('index'));
const ixRef = ref.openIndex(buf), ixNew = openIndex(buf);
const sets: Record<string, string[]> = {};
for (const f of all('queries')) {
  const j = JSON.parse(readFileSync(f, 'utf8')) as any[];
  sets[f.split('/').pop()!] = j.map((x) => x.raw ?? JSON.stringify({ q: x.q, page: x.page }));
}
if (one('generator')) {
  const g = await import(pathToFileURL(resolve(one('generator'))).href);
  sets.generated = (g.generate(Number(one('n') ?? 32000)) as any[]).map((x) => x.raw);
}
const out: Record<string, object> = {};
let diffs = 0, apiDiffs = 0, apiCompared = 0, latinOnlyNonAscii = 0;
for (const [name, list] of Object.entries(sets)) {
  let d = 0;
  for (const raw of list) {
    const a = ref.handle(ixRef, raw), b = handleRound4(ixNew, raw);
    if (a.status !== b.status || a.body !== b.body) d++;
    // The Worker API must agree with the reference on status, total, page and results.
    const c = handleJson(ixNew, raw);
    if (c.status === 400 && (c.data as any).error === 'latin' && a.status === 200) { latinOnlyNonAscii++; continue; }
    apiCompared++;
    if (c.status !== a.status) { apiDiffs++; continue; }
    if (a.status === 200) {
      const x = JSON.parse(a.body), y = c.data as any;
      if (JSON.stringify([x.total, x.page, x.results]) !== JSON.stringify([y.total, y.page, y.results])) apiDiffs++;
    } else if (a.body !== JSON.stringify(c.data)) apiDiffs++;
  }
  diffs += d;
  out[name] = { compared: list.length, differences: d };
}
console.log(JSON.stringify({ sets: out, coreDifferences: diffs, apiCompared, apiDifferences: apiDiffs, apiLatinScriptOnlyRefusals: latinOnlyNonAscii }));
process.exit(diffs || apiDiffs ? 1 : 0);
