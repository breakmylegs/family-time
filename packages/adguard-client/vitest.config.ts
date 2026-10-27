import { defineConfig } from 'vitest/config';

// The contract tests run here against the fake AdGuard (ADGUARD_URL unset), and in the deploy's
// test project against the real container (vitest.adguard.config.ts).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    maxWorkers: 3,
    testTimeout: 30_000,
  },
});
