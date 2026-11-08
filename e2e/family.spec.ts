// The whole family (Phase 9) against the demo family, in WebKit at 390 by 844: the parents' own
// screen time beside the challenge, We did it, and the minutes to find a stopping point.
import { expect, test } from '@playwright/test';
import { reset, sessions, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-9';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the whole family on Family, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/family?child=${sessions().children.ollie}`);
    const section = page.getByRole('region', { name: 'The whole family' });
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText('Your screen time this week')).toBeVisible();
    await expect(section.getByText("Dad's screen time this week")).toBeVisible();
    await expect(section.getByText('4 h 30. Earlier weeks: 5 h 30')).toBeVisible();
    await expect(section.getByText('Family challenge: Screen-free tea')).toBeVisible();
    await expect(section.getByText(/^2 of 5 times/)).toBeVisible();
    await shot(page, `whole-family-${scheme}`, PHASE);
  });
}

test('We did it, your own screen time, and the stopping point', async ({ page }) => {
  await page.goto(`/family?child=${sessions().children.ollie}`);
  const section = page.getByRole('region', { name: 'The whole family' });
  await section.getByRole('button', { name: 'We did it' }).click();
  await expect(page.getByRole('status').filter({ hasText: '3 of 5 times this week.' })).toBeAttached();
  await expect(section.getByText(/^3 of 5 times/)).toBeVisible();

  await section.getByRole('button', { name: 'Change your screen time this week' }).click();
  const mine = page.getByRole('dialog', { name: 'Your screen time this week' });
  await mine.getByRole('button', { name: 'This week: 30 min less' }).click();
  await mine.getByRole('button', { name: 'Save 9 h 30' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved: 9 h 30 this week.' })).toBeAttached();

  await section.getByRole('button', { name: 'Change: time to find a stopping point' }).click();
  const stop = page.getByRole('dialog', { name: 'Time to find a stopping point' });
  await stop.getByRole('button', { name: 'Extra minutes: 5 minutes more' }).click();
  await stop.getByRole('button', { name: 'Save 10 minutes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved: 10 minutes to find a stopping point.' })).toBeAttached();
  await expect(section.getByText('10 minutes', { exact: true })).toBeVisible();
});

test('a carer can say We did it but not change the challenge', async ({ page, context }) => {
  await signInAs(context, 'gran');
  await page.goto(`/family?child=${sessions().children.ollie}`);
  const section = page.getByRole('region', { name: 'The whole family' });
  await expect(section.getByRole('button', { name: 'We did it' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Change the family challenge' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Change your screen time this week' })).toHaveCount(0);
});
