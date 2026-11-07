// Playwright against a local build only (127.0.0.1). RIFQ_BUILD names the build folder.
// Two local Workers run from the same build: 8813 has the real 30-per-minute server limit (used by
// the rate limit tests); 8812 has a high limit so other tests are not slowed by it.
// The e2e tests expect a build made with --gate off (development builds have the gate on by
// default; the gate itself is covered by test/unit/password-gate.test.ts).
// Screenshots, traces and videos are off: pages show Quran text, which stays out of this repo.
import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';

const BUILD = resolve(process.env.RIFQ_BUILD ?? '.out/synthetic');
const OUT = join(BUILD, 'test-results');

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: OUT,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['json', { outputFile: join(BUILD, 'reports', 'e2e-results.json') }]],
  use: {
    baseURL: 'http://127.0.0.1:8812',
    screenshot: 'off', trace: 'off', video: 'off',
    locale: 'ar',
    launchOptions: { args: ['--no-proxy-server'] },
  },
  webServer: [
    // RQ-005: the mock Quran Foundation API on 127.0.0.1:8815 (test/mock/qf-mock.ts). Only the
    // Worker on 8812 is pointed at it, with made-up credentials and tafsir ID; the browser never is.
    { command: `node test/mock/qf-mock.ts 8815`, url: 'http://127.0.0.1:8815/__mock/stats', reuseExistingServer: false, timeout: 30_000, stdout: 'ignore', stderr: 'pipe' },
    { command: `scripts/serve-local.sh ${BUILD} 8812 wrangler.e2e.jsonc --var QF_ENV:prelive --var QF_CLIENT_ID:mock-client-id --var QF_CLIENT_SECRET:mock-client-secret-made-up --var TAFSIR_ID:901 --var QF_TEST_BASE:http://127.0.0.1:8815`, url: 'http://127.0.0.1:8812/', reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'pipe' },
    { command: `scripts/serve-local.sh ${BUILD} 8813 wrangler.jsonc`, url: 'http://127.0.0.1:8813/', reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'pipe' },
  ],
});
