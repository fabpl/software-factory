import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Fonctions pures et effets testables en CI : 100 %. `auth.ts` (gh) et `cli.ts` ne sont
      // exercés qu'à la main contre le vrai GitHub (point de contrôle 3).
      include: [
        'src/state.ts',
        'src/reconcile.ts',
        'src/handlers.ts',
        'src/rules.ts',
        'src/log.ts',
        'src/orchestrator.ts',
        'src/worktree.ts',
        'src/github.ts',
        'src/octokit.ts',
        'src/counter.ts',
      ],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
