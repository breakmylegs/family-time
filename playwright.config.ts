import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LINK_FILE = join(tmpdir(), 'family-time-e2e-owner-link.txt');
export const SESSION_FILE = join(tmpdir(), 'family-time-e2e-sessions.json');
const PORT = 5174;
/** The mock's family, frozen at Monday 26 October 2026, 18:32 London. */
export const DEMO_PORT = 5175;
/** The same demo family's kiosk. */
export const KIOSK_PORT = 5176;

/**
 * End-to-end tests against the real api on PGlite (apps/api/dev/server.ts), serving the parent
 * build. Build the parent app first: `corepack pnpm --filter @family-time/parent build`.
 *
 * Passkeys need Chromium, which has a virtual authenticator. WebKit (the iPhone's engine) runs
 * the Control screen and the help panel against the demo family, signed in by cookie.
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
  webServer: [
    {
      command: 'corepack pnpm --filter @family-time/api dev',
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(PORT), FT_LINK_FILE: LINK_FILE, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    },
    {
      command: 'corepack pnpm --filter @family-time/api dev',
      url: `http://localhost:${DEMO_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(DEMO_PORT), KIOSK_PORT: String(KIOSK_PORT), FT_DEV_DEMO: '1', FT_SESSION_FILE: SESSION_FILE, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    },
  ],
  projects: [
    { name: 'passkeys', testMatch: 'accounts.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    {
      name: 'webkit',
      testMatch: 'render.spec.ts',
      dependencies: ['passkeys'],
      use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'control',
      testMatch: ['control.spec.ts', 'help.spec.ts', 'economy.spec.ts', 'system.spec.ts', 'ai.spec.ts', 'family.spec.ts', 'setup.spec.ts'],
      // Playwright's WebKit on Windows hangs the page when asked for a push subscription. Push is
      // checked on a real iPhone instead; the tests block the service worker.
      use: { ...devices['Desktop Safari'], baseURL: `http://localhost:${DEMO_PORT}`, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' },
    },
    {
      // The kiosk in Chromium at the Fire tablet's 1280 by 800 (brief Part 19).
      name: 'kiosk',
      testMatch: 'kiosk.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${KIOSK_PORT}`, viewport: { width: 1280, height: 800 } },
    },
  ],
});
