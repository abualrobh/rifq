// Build pipeline. Usage:
//   node scripts/build.ts --record <source-record.json> --out <dir> --mode <development|release>
//                         [--gate on|off]
// --gate turns on the password gate (HTTP Basic auth on every request, src/worker/gate.ts). It is
// on by default in development builds and off by default in release builds, so a release build
// keeps the gate only if it is asked for.
// Steps: source gate, search index, Astro pages, security headers, byte comparison of every ayah,
// client JavaScript scan, then a local Worker config. Output goes to --out, which must be outside
// this repository unless the record is synthetic test data. Logs show counts and hashes only.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSource, readRecord, sha256 } from '../src/core/source-adapter.ts';
import { gate, type Mode } from '../src/core/source-gate.ts';
import { writeIndex } from './build-index.ts';
import { writeHeaders } from './headers.ts';
import { checkBuilt, scanClientJs } from './check-bytes.ts';

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
// the Worker runs before every asset, so nothing can be served without the password.
export function localWranglerConfig(name: string, limit: number, gateOn: boolean) {
  return {
    name, main: 'entry.ts', compatibility_date: '2026-10-01',
    workers_dev: false, preview_urls: false, send_metrics: false,
    observability: { enabled: false, logs: { enabled: false } },
    assets: { directory: './site', binding: 'ASSETS', run_worker_first: gateOn ? true : ['/api/*'], not_found_handling: '404-page', html_handling: 'auto-trailing-slash' },
    rules: [{ type: 'Data', globs: ['**/*.bin'], fallthrough: false }],
    ratelimits: [{ name: 'SEARCH_LIMIT', namespace_id: '1001', simple: { limit, period: 60 } }],
  };
}

export async function build(recordPath: string, outDir: string, mode: Mode, gateOn: boolean = mode !== 'release') {
  const t0 = performance.now();
  recordPath = resolve(recordPath); outDir = resolve(outDir);
  const log = (o: object) => console.log(JSON.stringify(o));

  // 1. Source gate. Release mode stops here unless the record is approved and the hash matches.
  const l = readRecord(recordPath);
  const g = gate(mode, l.record, l.sha256);
  log({ step: 'gate', mode, ok: g.ok, reasons: g.reasons, sha256: l.sha256 });
  if (!g.ok) { process.exitCode = 2; throw new Error('source gate failed'); }

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
  const reports = checkBuilt(src, join(outDir, 'site'));
  const js = scanClientJs(src, join(outDir, 'site'));
  for (const r of reports) log({ step: 'bytes', route: r.route, pages: r.pages, ayat: r.ayat, equal: r.equal, mismatches: r.mismatches.length, refErrors: r.refErrors.length });
  log({ step: 'client-js', files: js.files, ayatFound: js.hits });
  const bad = reports.some((r) => r.mismatches.length || r.refErrors.length || r.equal !== src.list.length) || js.hits > 0;

  // 6. Local Worker entry and configs.
  // With the gate on, the Worker runs first for every path and sets the asset headers itself.
  const cfg = {
    dev: mode !== 'release', gate: gateOn,
    record: { name: l.record.name, edition: l.record.edition, status: l.record.status },
    ...(gateOn ? { assetHeaders: hdr.headers } : {}),
  };
  log({ step: 'gate-flag', gate: gateOn });
  writeFileSync(join(outDir, 'worker-config.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(join(outDir, 'entry.ts'), `// Generated by scripts/build.ts. Local use only.
import idx from './search-index.bin';
import cfg from './worker-config.json';
import { makeWorker } from ${JSON.stringify(join(ROOT, 'src/worker/app.ts'))};
export default makeWorker(idx as ArrayBuffer, cfg);
`);
  for (const [file, limit, name] of [['wrangler.jsonc', 120, 'rifq-local'], ['wrangler.e2e.jsonc', 1000, 'rifq-local-e2e']] as const) {
    writeFileSync(join(outDir, file), JSON.stringify(localWranglerConfig(name, limit, gateOn), null, 2));
  }

  const summary = {
    mode, gate: gateOn, record: cfg.record, sourceSha256: l.sha256, indexSha256: sha256(idx.buf), index: idx.stats,
    bytes: reports.map((r) => ({ route: r.route, pages: r.pages, ayat: r.ayat, equal: r.equal, mismatches: r.mismatches, refErrors: r.refErrors })),
    clientJs: js, csp: hdr.csp, seconds: Math.round((performance.now() - t0) / 10) / 100,
  };
  mkdirSync(join(outDir, 'reports'), { recursive: true });
  writeFileSync(join(outDir, 'reports', 'build-summary.json'), JSON.stringify(summary, null, 2));
  log({ step: 'done', ok: !bad, seconds: summary.seconds });
  if (bad) { process.exitCode = 3; throw new Error('byte comparison or client JavaScript scan failed'); }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = arg('mode', 'development') as Mode;
  const i = process.argv.indexOf('--gate');
  build(arg('record'), arg('out'), mode, gateFlag(mode, i >= 0 ? process.argv[i + 1] : undefined)).catch((e) => {
    console.error(JSON.stringify({ error: (e as Error).message }));
    if (!process.exitCode) process.exitCode = 1;
  });
}
