import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.pg.test.ts'],
    maxWorkers: 3,
    // PGlite takes seconds to start the first time in each file, more on a loaded laptop.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
