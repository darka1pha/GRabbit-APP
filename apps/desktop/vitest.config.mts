import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests. The Electron smoke test needs a build and runs with `pnpm test:e2e`
// (vitest.e2e.config.mts).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
