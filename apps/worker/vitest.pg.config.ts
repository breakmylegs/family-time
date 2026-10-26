import { defineConfig } from 'vitest/config';

// Real Postgres tests. Run only inside the deploy's test project, where DATABASE_URL is set.
export default defineConfig({
  test: {
    include: ['test/**/*.pg.test.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
