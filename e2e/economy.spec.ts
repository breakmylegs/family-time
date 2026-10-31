// Approvals, Jobs and Family against the demo family, in WebKit at 390 by 844: approve a job with a
// note and Undo, Not yet, Send praise, say yes to a request, add a job paid in screen time with the
// cap in view, tick the reduction step agreed, and mark pocket money paid.
import { expect, test, type Page } from '@playwright/test';
import { reset, sessions, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-4';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

const go = async (page: Page, path: string) => {
  await page.goto(`${path}?child=${sessions().children.ollie}`);
};
const item = (page: Page, title: string) => page.locator('.item-wrap[data-gone="false"]').filter({ has: page.getByRole('heading', { name: title }) });

for (const scheme of ['light', 'dark'] as const) {
  test(`the screens, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await go(page, '/approvals');
    await expect(page.getByText('3 waiting for you')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approvals, 3 waiting' })).toBeVisible();
    await shot(page, `approvals-${scheme}`, PHASE);
    await go(page, '/tasks');
    await expect(page.getByRole('button', { name: 'Change Emptied the dishwasher' })).toBeVisible();
    await shot(page, `jobs-${scheme}`, PHASE);
    await go(page, '/family');
    await expect(page.getByText('Pocket money owed').first()).toBeVisible();
    await shot(page, `family-${scheme}`, PHASE);
    await go(page, '/');
    await page.getByRole('heading', { name: 'This week' }).scrollIntoViewIfNeeded();
    await expect(page.getByText('5 h 30 left to plan')).toBeVisible();
    await shot(page, `control-this-week-${scheme}`, PHASE);
  });
}

test('approve a job with a suggested note, then Undo', async ({ page }) => {
  await go(page, '/approvals');
  const dishes = item(page, 'Emptied the dishwasher');
  await expect(dishes.getByText('Ollie, today at 17:05')).toBeVisible();
  const suggestion = dishes.locator('.suggest button').first();
  const words = (await suggestion.textContent())!;
  await suggestion.click();
  await expect(dishes.getByLabel('Say something to Ollie')).toHaveValue(`${words}.`);
  await dishes.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('2 waiting for you')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Approved. 50p added, and your note is on its way.' })).toBeAttached();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('3 waiting for you')).toBeVisible();
});

test('Not yet, Send praise, and yes to a request from the allowance', async ({ page }) => {
  await go(page, '/approvals');
  await item(page, 'Emptied the dishwasher').getByRole('button', { name: 'Not yet' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Left for later' })).toBeAttached();
  await item(page, 'Built something with LEGO').getByRole('button', { name: 'Send praise' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Praise sent.' })).toBeAttached();
  const ask = item(page, 'Can I play Roblox with Jamie at 19:00?');
  await expect(ask.getByText('Uses 30 minutes of his own time. He has 5 h 30 left this week, and wind-down starts at 19:30.')).toBeVisible();
  await ask.getByRole('button', { name: 'Yes, 19:00 to 19:30' }).click();
  await expect(page.getByText('All done.')).toBeVisible();
  await go(page, '/');
  await expect(page.getByText('5 h left to plan')).toBeVisible();
});

test('add a job paid in screen time, with the cap in view', async ({ page }) => {
  await go(page, '/tasks');
  await page.getByRole('button', { name: 'Add a job' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a job' });
  await sheet.getByLabel('What is it?').fill('Walked the dog');
  // Pocket money first, as the brief asks.
  await expect(sheet.getByRole('button', { name: 'Pocket money' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Screen time' }).click();
  await expect(sheet.getByText(/capped at 15% of the weekly allowance: 63 min a week for a 7 h allowance/)).toBeVisible();
  // A job for one child shows that child's cap and what is left of it this week.
  await sheet.getByRole('button', { name: 'Ollie' }).click();
  await expect(sheet.getByText(/63 min a week for Ollie, 63 min left this week/)).toBeVisible();
  await shot(page, 'job-sheet-light', PHASE);
  await sheet.getByRole('button', { name: 'Add the job' }).click();
  await expect(page.getByRole('button', { name: 'Change Walked the dog' })).toContainText('15 min');
});

test('tick the step agreed at the review, and mark pocket money paid', async ({ page }) => {
  await go(page, '/family');
  await expect(page.getByText('6 h 30 from Sunday 8 November').first()).toBeVisible();
  const agreed = page.getByRole('switch', { name: 'Agreed at the family review' }).first();
  await expect(agreed).toHaveAttribute('aria-checked', 'false');
  await agreed.click();
  await expect(agreed).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Mark as paid' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Pay Ollie' });
  await sheet.getByRole('button', { name: 'Mark 70p as paid' }).click();
  await expect(page.getByRole('status').filter({ hasText: '70p marked as paid.' })).toBeAttached();
  await expect(page.getByText('Pocket money paid')).toBeVisible();
});

test('a carer sees Approvals but cannot change jobs or money', async ({ page, context }) => {
  await signInAs(context, 'gran');
  await go(page, '/tasks');
  await expect(page.getByRole('button', { name: 'Add a job' })).toHaveCount(0);
  await go(page, '/family');
  await expect(page.getByText('Pocket money owed').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
});
