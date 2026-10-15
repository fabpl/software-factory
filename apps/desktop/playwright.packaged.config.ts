import { defineConfig } from '@playwright/test';

/** App empaquetée par `build:dir` (D2) : `e2e/packaged.spec.ts` seul, une app à la fois. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'packaged.spec.ts',
  outputDir: 'test-results',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
