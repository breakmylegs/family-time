// Phase 8 against the demo family, in WebKit at 390 by 844: the owner's System page with health,
// the last backup, what is switched on, how long data is kept, release notes and the audit log;
// and the pilot measures on Family. Screenshots for docs/screens/phase-8.
import { expect, test } from '@playwright/test';
import { reset, sessions, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-8';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the owner's System page, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/settings?child=${sessions().children.ollie}`);
    await page.getByRole('button', { name: /^System/ }).click();
    await expect(page.getByRole('heading', { name: 'System', level: 1 })).toBeVisible();
    await expect(page.getByText(/^Done Mon,? 26 Oct/)).toBeVisible();
    await expect(page.getByText('Sign-ins, 30 days after they end')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^0\.9\.0/ })).toBeVisible();
    await shot(page, `system-${scheme}`, PHASE);
    await page.getByLabel('Show').selectOption('control');
    await expect(page.locator('.audit li').first()).toBeVisible();
    await expect(page.getByRole('link', { name: "Export the family's data" })).toHaveAttribute('href', '/api/export');
  });

  test(`pilot measures on Family, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/family?child=${sessions().children.ollie}`);
    const measures = page.getByRole('region', { name: 'Pilot measures' });
    await measures.getByRole('heading', { name: 'Pilot measures' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(measures.getByText(/YouTube 2 h 59|YouTube 3 h 1/)).toBeVisible();
    await expect(measures.getByRole('link', { name: 'Download as a spreadsheet' })).toBeVisible();
    await shot(page, `measures-${scheme}`, PHASE);
  });
}

test('the System page is for the owner only', async ({ page, context }) => {
  await signInAs(context, 'dad');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^System/ })).toHaveCount(0);
});
