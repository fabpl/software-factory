import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';

/**
 * Process principal : les paquets `@factory/*` sont du TypeScript source, donc bundlés ; leurs
 * dépendances npm restent externes et sont déclarées dans `package.json` (carte #4). Le SDK Claude
 * doit rester externe : il localise son binaire natif depuis son propre fichier.
 */
export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@factory/orchestrator', '@factory/conventions'] },
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          probe: 'src/main/probe.ts',
          screenshot: 'src/main/screenshot.ts',
          e2e: 'src/main/e2e.ts',
        },
      },
    },
  },
  preload: {
    // `sandbox: true` : le preload est chargé hors du système de modules Node, donc CommonJS.
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [tailwindcss()],
  },
});
