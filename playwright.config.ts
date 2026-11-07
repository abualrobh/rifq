// Playwright against a local build only (127.0.0.1). RIFQ_BUILD names the build folder.
// Two local Workers run from the same build: 8813 has the real 30-per-minute server limit (used by
// the rate limit tests); 8812 has a high limit so other tests are not slowed by it.
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
    { command: `scripts/serve-local.sh ${BUILD} 8812 wrangler.e2e.jsonc`, url: 'http://127.0.0.1:8812/', reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'pipe' },
    { command: `scripts/serve-local.sh ${BUILD} 8813 wrangler.jsonc`, url: 'http://127.0.0.1:8813/', reuseExistingServer: false, timeout: 60_000, stdout: 'ignore', stderr: 'pipe' },
  ],
});
