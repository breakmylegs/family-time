import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.pg.test.ts'],
    maxWorkers: 3,
    // Tests here start PGlite and apply every migration; on a slow two-core server that took over 30 s (ADR 0024).
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
