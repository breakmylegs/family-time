import { defineConfig } from 'vitest/config';

// The contract tests only, against the real AdGuard named by ADGUARD_URL. Run by scripts/test-pg.mjs
// in the deploy's throwaway test project.
export default defineConfig({
  test: {
    include: ['test/contract.test.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
