import { defineConfig } from 'vitest/config';

// Launches the built app (out/) with Playwright. Run `pnpm test:e2e`, which builds first.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
