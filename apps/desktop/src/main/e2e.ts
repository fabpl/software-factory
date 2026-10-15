import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapFake } from '@factory/orchestrator/fake';
import { runApp } from './app';
import { packageRoot } from './paths';

/**
 * Entrée du test E2E (D2) : l'app réelle sur `bootstrapFake`, GitHub en mémoire et dossiers
 * temporaires. Lancée par Playwright (`pnpm --filter desktop test:e2e`), jamais par `index.ts`.
 */
runApp({
  root: packageRoot(import.meta.url),
  bootstrap: bootstrapFake,
  home: mkdtempSync(join(tmpdir(), 'factory-e2e-')),
});
