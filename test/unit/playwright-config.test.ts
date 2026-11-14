// QA v28 FIND-U: every Playwright run writes its JSON report and its output folder under its own
// run id, so no run empties or overwrites another run's results (never-delete rule).
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Cfg = { outputDir: string; reporter: [string, { outputFile?: string }?][] };
async function load(file: string, id: string): Promise<Cfg> {
  process.env.RIFQ_RUN_ID = id;
  process.env.RIFQ_BUILD = '/tmp/rifq-build-for-config-test';
  // A query string gives a fresh module, so the run id is read again.
  return (await import(`../../${file}?run=${id}`)).default as Cfg;
}

for (const file of ['playwright.config.ts', 'playwright.gate.config.ts']) {
  test(`FIND-U: ${file} names its report and output folder by the run id`, async () => {
    const a = await load(file, 'run-a-1');
    const b = await load(file, 'run-b-2');
    const json = (c: Cfg) => c.reporter.find((r) => r[0] === 'json')?.[1]?.outputFile ?? '';
    assert.match(json(a), /run-a-1\.json$/);
    assert.match(json(b), /run-b-2\.json$/);
    assert.notEqual(json(a), json(b));
    assert.match(a.outputDir, /run-a-1$/);
    assert.notEqual(a.outputDir, b.outputDir);
  });
}
