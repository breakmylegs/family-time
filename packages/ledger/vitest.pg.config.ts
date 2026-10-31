import { defineConfig } from 'vitest/config';

// Real Postgres tests. Run only inside the deploy's test project, where DATABASE_URL is set.
export default defineConfig({
  test: {
    include: ['test/**/*.pg.test.ts'],
    maxWorkers: 1,
    // The real chain makes a block a second, and each ledger test waits for its entries to land.
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
});
