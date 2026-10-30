import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screens');
export const SCREENS = join(DOCS, 'phase-1');
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

/**
 * A screenshot into docs/screens/<phase>. Phase 3 on is the phone's own 390 by 844 view: a full-page
 * capture would draw the fixed tab bar, sheets and help panel part way down a long page.
 */
export async function shot(page: Page, name: string, phase = 'phase-1'): Promise<void> {
  const dir = join(DOCS, phase);
  mkdirSync(dir, { recursive: true });
  // Let sheets, the panel and the toast finish moving (all under 330ms).
  if (phase !== 'phase-1') {
    // A phone has no hover: move the desktop pointer off whatever was last tapped.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: phase === 'phase-1' });
}
