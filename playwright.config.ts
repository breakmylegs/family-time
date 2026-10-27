import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LINK_FILE = join(tmpdir(), 'family-time-e2e-owner-link.txt');
const PORT = 5174;

/**
 * End-to-end tests against the real api on PGlite (apps/api/dev/server.ts), serving the parent
 * build. Build the parent app first: `corepack pnpm --filter @family-time/parent build`.
 *
 * Passkeys need Chromium, which has a virtual authenticator. WebKit (the iPhone's engine) renders
 * the screens that need no passkey, in light and dark.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: join(tmpdir(), 'family-time-e2e-results'),
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'corepack pnpm --filter @family-time/api dev',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), FT_LINK_FILE: LINK_FILE, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
  },
  projects: [
    { name: 'passkeys', testMatch: 'accounts.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    {
      name: 'webkit',
      testMatch: 'render.spec.ts',
      dependencies: ['passkeys'],
      use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } },
    },
  ],
});
