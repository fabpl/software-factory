import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      // Fonctions pures et handlers : 100 %. Le câblage SDK (options, serveur MCP, boucle query)
      // n'est couvert que par le test live, hors CI.
      include: [
        'src/claude/translate.ts',
        'src/claude/hooks.ts',
        'src/claude/policy.ts',
        'src/claude/handlers.ts',
        'src/claude/state.ts',
        'src/fake/**/*.ts',
      ],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
