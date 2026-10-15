import { defineConfig } from '@playwright/test';

/** E2E de l'app construite en mode `fake` (H1) : une seule app Electron à la fois. */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  // H8 : 15 s par attente (30 ticks de 500 ms), 120 s pour le test entier ; les actions sur la
  // fenêtre Electron prennent leur délai dans le test (`page.setDefaultTimeout`).
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
