// The owner's Set-up screen (Phase 9) against the demo family, in WebKit at 390 by 844: devices,
// the rule for a group, and a schedule, each saved through the same commands as the command line.
import { expect, test } from '@playwright/test';
import { reset, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-9';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Set-up, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/settings');
    await page.getByRole('button', { name: /^Set-up/ }).click();
    await expect(page.getByRole('heading', { name: 'Set-up', level: 1 })).toBeVisible();
    await expect(page.getByText("Ollie's iPad")).toBeVisible();
    await expect(page.getByText(/^Blocked unless planned or allowed\. YouTube\.$/)).toBeVisible();
    await shot(page, `setup-${scheme}`, PHASE);
  });
}

test('add a device, then remove it', async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('button', { name: 'Add a device' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a device' });
  await sheet.getByLabel('Name').fill('Switch');
  await sheet.getByRole('button', { name: 'Games console' }).click();
  await sheet.getByLabel('Its addresses').fill('192.168.1.50');
  await sheet.getByRole('button', { name: 'Add the device' }).click();
  // One address, one device: the sheet says why and stays open.
  await expect(sheet.getByText("Ollie's iPad already uses 192.168.1.50. Each address belongs to one device.")).toBeVisible();
  await sheet.getByLabel('Its addresses').fill('192.168.1.70');
  await sheet.getByRole('button', { name: 'Add the device' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Switch. Its rules start within a minute, on home Wi-Fi.' })).toBeAttached();
  await page.getByRole('button', { name: 'Change Switch' }).click();
  await page.getByRole('dialog', { name: 'Change Switch' }).getByRole('button', { name: 'Remove this device' }).click();
  await expect(page.getByRole('button', { name: 'Change Switch' })).toHaveCount(0);
});

test("change a group's rule, and a schedule's bedtime", async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('group', { name: 'Whose rules' }).getByRole('button', { name: 'Ollie' }).click();
  await page.getByRole('button', { name: 'Change the rule for Video, Ollie' }).click();
  const rule = page.getByRole('dialog', { name: 'Video for Ollie' });
  await rule.getByRole('switch', { name: 'Fine in wind-down' }).click();
  await rule.getByRole('button', { name: 'Save the rule' }).click();
  await expect(page.getByText(/^Blocked unless planned or allowed\. Fine in wind-down\. YouTube\.$/)).toBeVisible();

  await page.getByRole('button', { name: 'Change School night' }).click();
  const s = page.getByRole('dialog', { name: 'Change School night' });
  await expect(s.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByLabel('Part 6: from').fill('20:45');
  await s.getByRole('button', { name: 'Save the schedule' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved School night.' })).toBeAttached();
  await expect(page.getByText(/Bedtime 20:45 to 07:00/)).toBeVisible();
});
