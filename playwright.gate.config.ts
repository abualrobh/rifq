// Playwright against a local build made with the password gate on (--gate on), on 127.0.0.1 only.
// RIFQ_BUILD names the build folder; RIFQ_GATE_DIR can name another folder that holds a Worker
// config (for example a copy of the deploy kit) and RIFQ_GATE_CONFIG its file name.
// The browser context sends Basic auth through httpCredentials, as a person signed in would.
// The credentials are made up for the test and given to the local Worker with --var.
import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';

// One id per run (the config is read again by the workers, which keep it): it names the local
// Worker state folders (scripts/serve-local.sh) and the in-place counts file, so a run never reuses
// the previous run's rate-limit state and nothing has to be removed between runs (QA v26 FIND-J).
process.env.RIFQ_RUN_ID ??= new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 18) + '-' + process.pid;

const BUILD = resolve(process.env.RIFQ_BUILD ?? '.out/synthetic');
const DIR = resolve(process.env.RIFQ_GATE_DIR ?? BUILD);
const CFG = process.env.RIFQ_GATE_CONFIG ?? 'wrangler.e2e.jsonc';
export const GATE_USER = process.env.RIFQ_GATE_USER ?? 'e2e';
export const GATE_PASSWORD = process.env.RIFQ_GATE_PASSWORD ?? 'e2e-made-up-password';
const PORT = 8814;

export default defineConfig({
  testDir: 'test/e2e-gate',
  outputDir: join(BUILD, 'test-results-gate'),
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['json', { outputFile: join(BUILD, 'reports', 'e2e-gate-results.json') }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    httpCredentials: { username: GATE_USER, password: GATE_PASSWORD, send: 'unauthorized' },
    screenshot: 'off', trace: 'off', video: 'off',
    locale: 'ar',
    launchOptions: { args: ['--no-proxy-server'] },
  },
  webServer: [{
    command: `scripts/serve-local.sh ${DIR} ${PORT} ${CFG} --var SITE_USER:${GATE_USER} --var SITE_PASSWORD:${GATE_PASSWORD}`,
    url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'pipe',
  }],
});
