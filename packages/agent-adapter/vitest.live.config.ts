import { defineConfig } from 'vitest/config';

/** `pnpm --filter @factory/agent-adapter test:live` : un vrai run court, hors CI. */
export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
