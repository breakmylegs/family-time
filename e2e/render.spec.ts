// WebKit, the iPhone's engine, in light and dark. Passkeys cannot be simulated in WebKit, so this
// renders the screens that need none. The passkey flow itself runs in Chromium (accounts.spec.ts).
import { expect, test } from '@playwright/test';
import { shot } from './support';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('sign in', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await shot(page, `webkit-sign-in-${scheme}`);
    });

    test('a broken invite link explains itself', async ({ page }) => {
      await page.goto('/join');
      await expect(page.getByRole('alert')).toHaveText(/not complete/);
      await shot(page, `webkit-join-broken-${scheme}`);
    });
  });
}
