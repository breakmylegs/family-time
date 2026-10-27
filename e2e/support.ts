import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCREENS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screens', 'phase-1');
mkdirSync(SCREENS, { recursive: true });

/**
 * A phone with its own passkey store, unlocked by "Face ID": Chromium's virtual authenticator,
 * with resident keys and user verification, like an iPhone.
 */
export async function phone(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return page;
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SCREENS, `${name}.png`), fullPage: true });
}
