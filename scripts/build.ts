// Build pipeline. Usage:
//   node scripts/build.ts --record <source-record.json> --out <dir> --mode <development|release>
//                         [--gate on|off] [--tafseer on|off] [--fingerprints <file>]
//                         [--tafseer-record <file>]
// --gate turns on the password gate (HTTP Basic auth on every request, src/worker/gate.ts). It is
// on by default in development builds and off by default in release builds, so a release build
// keeps the gate only if it is asked for.
// --tafseer turns on RQ-005 (the Tafseer screen, the per-ayah links and /api/tafseer). It is on by
// default in development builds and off by default in release builds. A release build with
// Tafseer on runs the Tafseer release check first (scripts/tafseer-release-check.ts: AC15 records,
// D-078 quotes, D-079 fingerprints) and stops unless it passes. No Tafseer is fetched by any other
// build, and none is ever written into a build (AC14).
// --fingerprints names the D-079 store (private data repository); --tafseer-record the AC15 record.
// Steps: source gate, search index, Astro pages, security headers, byte comparison of every ayah,
// client JavaScript scan, then a local Worker config. Output goes to --out, which must be outside
// this repository unless the record is synthetic test data. Logs show counts and hashes only.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSource, readRecord, sha256 } from '../src/core/source-adapter.ts';
import { gate, type Mode } from '../src/core/source-gate.ts';
import { writeIndex } from './build-index.ts';
import { writeHeaders } from './headers.ts';
import { checkBuilt, extractAyat, READER_ROUTES, sameBytes, scanClientJs, TAFSEER_ROUTES } from './check-bytes.ts';
import { bareAyah } from '../src/core/tafseer-quotes.ts';
import { checkFingerprints, type FingerprintFile } from '../src/core/tafseer-fingerprints.ts';
import { TAFSEER_LIMIT_PER_MINUTE } from '../src/worker/tafseer.ts';
import { readJson, runTafseerCheck, type TafseerRecord } from './tafseer-release-check.ts';
import type { QfSecrets } from '../src/worker/qf.ts';
import { AUTH_LIMIT_PER_MINUTE } from '../src/worker/gate.ts';
import { RULES_AWAITING_D012_REVIEWER } from '../src/core/search-config.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}

// --gate on|off; on by default except in release mode.
export function gateFlag(mode: Mode, value?: string): boolean {
  const v = value ?? (mode === 'release' ? 'off' : 'on');
  if (v !== 'on' && v !== 'off') throw new Error('--gate must be on or off');
  return v === 'on';
}

// Local Worker config. No account id; workers.dev and previews off; logs off. With the gate on,
// the Worker runs before every asset, so nothing can be served without the password, and failed
// sign-ins are counted by AUTH_LIMIT (D-071, M-2).
export function localWranglerConfig(name: string, limit: number, gateOn: boolean, authLimit = AUTH_LIMIT_PER_MINUTE, tafseerLimit: number | null = null) {
  return {
    name, main: 'entry.ts', compatibility_date: '2026-10-01',
    workers_dev: false, preview_urls: false, send_metrics: false,
    observability: { enabled: false, logs: { enabled: false } },
    assets: { directory: './site', binding: 'ASSETS', run_worker_first: gateOn ? true : ['/api/*'], not_found_handling: '404-page', html_handling: 'auto-trailing-slash' },
    rules: [{ type: 'Data', globs: ['**/*.bin'], fallthrough: false }],
    ratelimits: [
      { name: 'SEARCH_LIMIT', namespace_id: '1001', simple: { limit, period: 60 } },
      ...(gateOn ? [{ name: 'AUTH_LIMIT', namespace_id: '1002', simple: { limit: authLimit, period: 60 } }] : []),
      ...(tafseerLimit !== null ? [{ name: 'TAFSEER_LIMIT', namespace_id: '1003', simple: { limit: tafseerLimit, period: 60 } }] : []),
    ],
  };
}

export type TafseerOpts = { on: boolean; fingerprints?: string; record?: string };

export async function build(recordPath: string, outDir: string, mode: Mode, gateOn: boolean = mode !== 'release', tf: TafseerOpts = { on: mode !== 'release' }) {
  const t0 = performance.now();
  recordPath = resolve(recordPath); outDir = resolve(outDir);
  const log = (o: object) => console.log(JSON.stringify(o));

  // 1. Source gate. Release mode stops here unless the record is approved and the hash matches.
  const l = readRecord(recordPath);
  const g = gate(mode, l.record, l.sha256);
  log({ step: 'gate', mode, ok: g.ok, reasons: g.reasons, sha256: l.sha256 });
  if (!g.ok) { process.exitCode = 2; throw new Error('source gate failed'); }

  // 1b. RQ-005 inputs. The fingerprint store and the Tafseer record hold no Tafseer text.
  let fingerprints: FingerprintFile | null = null;
  let tRecord: TafseerRecord | null = null;
  if (tf.on) {
    const srcCounts = [0];
    for (const a of loadSource(recordPath).list) srcCounts[a.sora] = a.aya_no;
    if (tf.fingerprints) {
      fingerprints = readJson<FingerprintFile>(tf.fingerprints);
      const p = checkFingerprints(fingerprints, srcCounts);
      log({ step: 'tafseer-fingerprints', entries: fingerprints?.entries?.length ?? 0, problems: p });
      if (p.length) { process.exitCode = 2; throw new Error('fingerprint store is not valid'); }
    }
    if (tf.record) tRecord = readJson<TafseerRecord>(tf.record);
    if (mode === 'release') {
      const rep = await runTafseerCheck({ recordPath, record: tRecord, fingerprints, env: process.env as QfSecrets, mode: 'release' });
      const { mismatches, ...short } = rep;
      log({ step: 'tafseer-release-check', ...short, mismatches: mismatches.length });
      if (!rep.ok) { process.exitCode = 2; throw new Error('Tafseer release check failed'); }
    }
  }
  log({ step: 'tafseer-flag', tafseer: tf.on });

  // Astro empties its output folder before a build. Rule 2 forbids deleting anything, so each
  // build must go to a new or empty folder.
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error('output folder is not empty; use a new --out folder (nothing is deleted)');
  const inRepo = !relative(ROOT, outDir).startsWith('..');
  if (inRepo && !/synthetic/i.test(l.record.name)) throw new Error('output for real source data must be outside the public repository');

  // 2. Source bytes and search index (format unchanged from the prototype).
  const src = loadSource(recordPath);
  const idx = writeIndex(src, join(outDir, 'search-index.bin'));
  const textSection = Buffer.concat(src.slices);
  const after = readRecord(recordPath).sha256;
  log({ step: 'index', ...idx.stats, sha256: sha256(idx.buf), sourceUnchanged: after === l.sha256, textSectionSha256: sha256(textSection) });
  if (after !== l.sha256) throw new Error('source file changed during build');

  // 3. Astro static pages.
  process.env.RIFQ_RECORD = recordPath;
  process.env.RIFQ_MODE = mode;
  process.env.RIFQ_SITE_OUT = join(outDir, 'site');
  process.env.RIFQ_TAFSEER = tf.on ? 'on' : 'off';
  process.env.ASTRO_TELEMETRY_DISABLED = '1';
  const { build: astroBuild } = await import('astro');
  // Astro puts its temporary prerender bundle inside outDir only when outDir "starts with" the
  // working folder, compared as plain strings. A sibling such as /x/rifq-app/... starts with /x/rifq
  // but is outside it, so the bundle lands where node_modules cannot be found. In that case the
  // build runs from node_modules, whose .astro folder is then used for the temporary bundle.
  const cwd = process.cwd();
  const siteOut = join(outDir, 'site');
  const prefixClash = siteOut.startsWith(cwd) && !siteOut.startsWith(cwd.endsWith(sep) ? cwd : cwd + sep);
  if (prefixClash) process.chdir(join(ROOT, 'node_modules'));
  try { await astroBuild({ root: ROOT, logLevel: 'warn' }); } finally { process.chdir(cwd); }

  // 4. Security headers with hashes for every inline script and style.
  const hdr = writeHeaders(join(outDir, 'site'));
  log({ step: 'headers', inlineScripts: hdr.scripts, inlineStyles: hdr.styles });

  // 5. Byte comparison of every ayah in both routes, and the client JavaScript scan.
  const reports = checkBuilt(src, join(outDir, 'site'), tf.on ? [...READER_ROUTES, ...TAFSEER_ROUTES] : READER_ROUTES);
  const js = scanClientJs(src, join(outDir, 'site'));
  for (const r of reports) log({ step: 'bytes', route: r.route, pages: r.pages, ayat: r.ayat, equal: r.equal, mismatches: r.mismatches.length, refErrors: r.refErrors.length });
  log({ step: 'client-js', files: js.files, ayatFound: js.hits });
  // Development pages: the font check shows a fixed set of ayat, which must be the source bytes.
  let devBad = false;
  if (mode !== 'release') {
    const fc = join(outDir, 'site', 'dev', 'font-check', 'index.html');
    const got = existsSync(fc) ? extractAyat(readFileSync(fc)) : [];
    const byRef = new Map<string, Buffer>(src.list.map((a, n) => [`${a.sora}:${a.aya_no}`, src.slices[n]]));
    const bad = got.filter((g) => !byRef.has(g.ref) || !sameBytes(g.bytes, byRef.get(g.ref)!)).length;
    devBad = !got.length || bad > 0;
    log({ step: 'bytes-font-check', ayat: got.length, mismatches: bad });
  }
  const bad0 = reports.some((r) => r.mismatches.length || r.refErrors.length || r.equal !== src.list.length) || js.hits > 0;

  // 6. Local Worker entry and configs.
  // With the gate on, the Worker runs first for every path and sets the asset headers itself.
  const cfg = {
    dev: mode !== 'release', gate: gateOn,
    record: { name: l.record.name, edition: l.record.edition, status: l.record.status },
    ...(gateOn ? { assetHeaders: hdr.headers } : {}),
    tafseer: tf.on,
    // D-081 (development builds only): two SHA-256 hashes per ayah of the approved file's bytes, as
    // stored and with the D-068 ending cut. Hashes only; no text goes to the Worker.
    ...(mode !== 'release' ? { verifyHashes: {
      counts: [0, ...surahCounts(src.list)],
      full: src.slices.map((b) => sha256(b)),
      bare: src.list.map((a) => sha256(Buffer.from(bareAyah(a.aya_text), 'utf8'))),
    } } : {}),
    ...(tf.on ? {
      counts: [0, ...surahCounts(src.list)],
      fingerprints: fingerprints ?? { format: 'rifq-tafseer-fingerprints/1', entries: [] },
      // AC7: edition and publisher come only from the record approved by Hamzeh, never from an agent.
      tafseerSource: tRecord ? { title: tRecord.title ?? undefined, author: tRecord.author ?? undefined, edition: tRecord.edition ?? undefined, publisher: tRecord.publisher ?? undefined } : null,
    } : {}),
  };
  log({ step: 'gate-flag', gate: gateOn });
  writeFileSync(join(outDir, 'worker-config.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(join(outDir, 'entry.ts'), `// Generated by scripts/build.ts. Local use only.
import idx from './search-index.bin';
import cfg from './worker-config.json';
import { makeWorker } from ${JSON.stringify(join(ROOT, 'src/worker/app.ts'))};
export default makeWorker(idx as ArrayBuffer, cfg);
`);
  // The e2e config has high limits so tests that send many refused requests are not locked out;
  // wrangler.jsonc has the real limits (120 searches, 10 failed sign-ins per minute).
  for (const [file, limit, name, auth, tl] of [['wrangler.jsonc', 120, 'rifq-local', AUTH_LIMIT_PER_MINUTE, TAFSEER_LIMIT_PER_MINUTE], ['wrangler.e2e.jsonc', 1000, 'rifq-local-e2e', 1000, 1000]] as const) {
    writeFileSync(join(outDir, file), JSON.stringify(localWranglerConfig(name, limit, gateOn, auth, tf.on ? tl : null), null, 2));
  }

  const summary = {
    mode, gate: gateOn, tafseer: tf.on, fingerprintEntries: fingerprints?.entries.length ?? 0, record: cfg.record, sourceSha256: l.sha256, indexSha256: sha256(idx.buf), index: idx.stats,
    rulesAwaitingD012Reviewer: RULES_AWAITING_D012_REVIEWER,
    bytes: reports.map((r) => ({ route: r.route, pages: r.pages, ayat: r.ayat, equal: r.equal, mismatches: r.mismatches, refErrors: r.refErrors })),
    clientJs: js, csp: hdr.csp, seconds: Math.round((performance.now() - t0) / 10) / 100,
  };
  mkdirSync(join(outDir, 'reports'), { recursive: true });
  writeFileSync(join(outDir, 'reports', 'build-summary.json'), JSON.stringify(summary, null, 2));
  const bad = bad0 || devBad;
  log({ step: 'done', ok: !bad, seconds: summary.seconds });
  if (bad) { process.exitCode = 3; throw new Error('byte comparison or client JavaScript scan failed'); }
  return summary;
}

function surahCounts(list: { sora: number; aya_no: number }[]): number[] {
  const c: number[] = [];
  for (const a of list) c[a.sora - 1] = a.aya_no;
  return c;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = arg('mode', 'development') as Mode;
  const i = process.argv.indexOf('--gate');
  const ti = process.argv.indexOf('--tafseer');
  const tv = ti >= 0 ? process.argv[ti + 1] : (mode === 'release' ? 'off' : 'on');
  if (tv !== 'on' && tv !== 'off') throw new Error('--tafseer must be on or off');
  const fi = process.argv.indexOf('--fingerprints'), ri = process.argv.indexOf('--tafseer-record');
  const tf: TafseerOpts = { on: tv === 'on', fingerprints: fi >= 0 ? process.argv[fi + 1] : undefined, record: ri >= 0 ? process.argv[ri + 1] : undefined };
  build(arg('record'), arg('out'), mode, gateFlag(mode, i >= 0 ? process.argv[i + 1] : undefined), tf).catch((e) => {
    console.error(JSON.stringify({ error: (e as Error).message }));
    if (!process.exitCode) process.exitCode = 1;
  });
}
