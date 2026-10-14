import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Fonctions pures et effets testables en CI : 100 %. `index.ts` (fenêtre réelle), `probe.ts`
      // (sonde SDK, hors CI), le preload et `main.tsx` ne s'exercent qu'avec Electron.
      include: [
        'src/main/home.ts',
        'src/main/ipc.ts',
        'src/main/lifecycle.ts',
        'src/main/notifications.ts',
        'src/main/paths.ts',
        'src/main/runtime.ts',
        'src/main/tray.ts',
        'src/main/window.ts',
        'src/renderer/App.tsx',
        'src/renderer/components/**/*.tsx',
        'src/renderer/labels.ts',
        'src/renderer/send.ts',
        'src/shared/api.ts',
      ],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
