// The help panel: open from a (?), related topics with a back link, close by button, Escape and a
// tap outside with focus returning, a deep link, Was this helpful, and turning the icons off.
import { expect, test, type Page } from '@playwright/test';
import { reset, sessions, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-3';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

async function openOllie(page: Page, query = '') {
  await page.goto(`/?child=${sessions().children.ollie}${query}`);
  await expect(page.getByRole('heading', { name: 'Right now', level: 2 })).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test(`opens from its (?) with the child's name and live values, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openOllie(page);
    await page.getByRole('button', { name: 'Help: Pause everything' }).click();
    const panel = page.getByRole('dialog', { name: 'Pause everything' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Stops managed apps on his devices, within about a minute.')).toBeVisible();
    await expect(panel.getByText('Moderate evidence.')).toBeVisible();
    await expect(panel.getByText('What Ollie sees')).toBeVisible();
    await expect(panel.locator('.dl')).toContainText('Not paused');
    await expect(panel.locator('.dl')).toContainText('17:30 to 18:15');
    await expect(page.getByRole('heading', { name: 'Pause everything' })).toBeFocused();
    await shot(page, `help-${scheme}`, PHASE);
  });
}

test('follows a related topic and comes back', async ({ page }) => {
  await openOllie(page);
  await page.getByRole('button', { name: 'Help: Pause everything' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Allow, Block and Normal' }).click();
  await expect(panel.getByRole('heading', { name: 'Allow, Block and Normal' })).toBeFocused();
  await panel.getByRole('button', { name: 'Back to Pause everything' }).click();
  await expect(panel.getByRole('heading', { name: 'Pause everything' })).toBeVisible();
  await expect(panel.locator('.crumb')).toHaveText('Help');
});

test('closes by its button, Escape and a tap outside, giving focus back', async ({ page }) => {
  await openOllie(page);
  const trigger = page.getByRole('button', { name: 'Help: Allow, Block and Normal' });

  await trigger.click();
  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(12, 400);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('opens from a deep link, and tidies the address on close', async ({ page }) => {
  await openOllie(page, '&help=device-gone-quiet');
  const panel = page.getByRole('dialog', { name: 'A device has gone quiet' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("One of Ollie's devices has stopped checking in with your home server for 30 minutes, outside bedtime.")).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(new URL(page.url()).searchParams.has('help')).toBe(false);
});

test('ignores a deep link to a topic that does not exist', async ({ page }) => {
  await openOllie(page, '&help=nope');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('asks if it helped, and thanks', async ({ page }) => {
  await openOllie(page);
  await page.getByRole('button', { name: 'Help: How did it end?' }).click();
  const panel = page.getByRole('dialog', { name: 'How did it end?' });
  await expect(panel.getByText('Early evidence.')).toBeVisible();
  await panel.getByRole('button', { name: 'Yes' }).click();
  await expect(panel.getByText('Thanks. Your answer stays in your own Family time and is never sent anywhere else.')).toBeVisible();
});

test('help buttons can be turned off in Settings', async ({ page }) => {
  await openOllie(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Show help buttons' }).click();
  await page.getByRole('button', { name: 'Control' }).click();
  await expect(page.getByRole('heading', { name: 'Right now', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Help:/ })).toHaveCount(0);
  // A deep link still works, so an alert can always explain itself.
  await openOllie(page, '&help=alerts');
  await expect(page.getByRole('dialog', { name: 'Alerts on your phone' })).toBeVisible();
});
