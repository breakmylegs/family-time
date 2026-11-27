import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.pg.test.ts'],
    maxWorkers: 3,
    // Every test here starts its own PGlite and applies every migration. The first one in each file
    // also pays PGlite's cold start, which took over 30 s on a slow two-core server (ADR 0024).
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
