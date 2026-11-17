// The kiosk against the demo family, in Chromium at the Fire tablet's 1280 by 800 (brief Part 19):
// setting up with a code, the home screen from the mock, planning a session (and why a time is
// greyed), I did it, an idea, asking a grown-up, and what Mum and Dad can see.
import { expect, test, type Page } from '@playwright/test';
import { DEMO_PORT } from '../playwright.config';
import { reset, sessions } from './demo';
import { shot } from './support';

const PHASE = 'phase-6';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

/** The kiosk already paired, as the demo server set it up. */
async function open(page: Page) {
  const token = sessions().kiosk;
  await page.addInitScript((t) => localStorage.setItem('ft-kiosk-token', t), token);
  await page.goto('/');
  // The demo family has two children, so the kiosk asks who is here first.
  await page.getByRole('button', { name: 'Ollie' }).click();
  await expect(page.getByRole('heading', { name: 'Hi Ollie' })).toBeVisible();
}

test('asks who is here when there are two children', async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem('ft-kiosk-token', t), sessions().kiosk);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Who's here?" })).toBeVisible();
  await shot(page, 'kiosk-who-light', PHASE);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`home, from the mock, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expect(page.getByText('Monday 18:32')).toBeVisible();
    await expect(page.getByText('Wind-down at 19:30')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'YouTube until 19:00' })).toBeVisible();
    await expect(page.getByText("New videos won't start after 19:00. The one you're watching can finish.")).toBeVisible();
    await expect(page.getByText(/left to plan this week/)).toBeVisible();
    await expect(page.getByText('Trampoline tricks')).toBeVisible();
    await shot(page, `kiosk-home-${scheme}`, PHASE);
  });
}

test('the family challenge, ticked from the kiosk', async ({ page }) => {
  await open(page);
  const card = page.getByRole('region', { name: 'Our family' });
  await expect(card.getByRole('heading', { name: 'Our challenge: Screen-free tea' })).toBeVisible();
  await expect(card.getByText('2 of 5 times this week')).toBeVisible();
  await expect(card.getByText("Mum and Dad's screen time this week: 4 h 30")).toBeVisible();
  await shot(page, 'kiosk-family-light', 'phase-9');
  await card.getByRole('button', { name: 'We did it' }).click();
  await expect(card.getByRole('status')).toHaveText('Nice one! That counts for everyone.');
  await expect(card.getByText('3 of 5 times this week')).toBeVisible();
});

test('setting up asks for the code, and says when it is wrong', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set up this kiosk' })).toBeVisible();
  for (const n of '123456') await page.getByRole('button', { name: n, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText("That code didn't work. Check the six numbers, or make a new code on your phone in Settings, then Kiosk.");
  await shot(page, 'kiosk-setup-light', PHASE);
});

test('plans a session, and a greyed time says why', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Plan my time' }).click();
  await page.getByRole('button', { name: 'Roblox' }).click();
  await page.getByRole('button', { name: '30 minutes' }).click();
  await expect(page.getByText(/30 minutes is 1 block/)).toBeVisible();
  // 20:00 is in wind-down: marked as won't fit, to the eye and to a screen reader, and tapping it says so in Ollie's words.
  await page.getByRole('button', { name: "20:00, won't fit", exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Wind-down is on then. Pick another time.');
  await expect(page.getByRole('button', { name: 'Plan it' })).toHaveCount(0);
  await shot(page, 'kiosk-plan-light', PHASE);
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await page.getByRole('button', { name: 'Plan it' }).click();
  await expect(page.getByText('Planned: Roblox, starting now.')).toBeVisible();
});

test('I did it sends a job to Mum or Dad', async ({ page }) => {
  await open(page);
  const jobs = page.getByRole('region', { name: 'My jobs' });
  const job = jobs.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'I did it' }) }).first();
  const title = (await job.locator('.job-title').textContent())!;
  await job.getByRole('button', { name: 'I did it' }).click();
  const sheet = page.getByRole('dialog', { name: title });
  await expect(sheet.getByText('Want to show them? Take a photo, or just send it.')).toBeVisible();
  await shot(page, 'kiosk-did-it-light', PHASE);
  await sheet.getByRole('button', { name: 'Send to Mum or Dad' }).click();
  await expect(page.getByText('Sent to Mum or Dad. Nice one!')).toBeVisible();
  await expect(jobs.getByRole('listitem').filter({ hasText: title }).getByText('With Mum or Dad')).toBeVisible();
});

test('adds an idea, and asks a grown-up for a time outside the plan', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add an idea' }).click();
  await page.getByLabel("Something fun to do when you're bored").fill('Make a kite');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText('Make a kite')).toBeVisible();

  await page.getByRole('button', { name: 'Ask a grown-up' }).click();
  await page.getByRole('button', { name: 'Roblox' }).click();
  await page.getByRole('button', { name: '20:00', exact: true }).click();
  await page.getByRole('button', { name: 'Ask a grown-up' }).click();
  await expect(page.getByText('Asked! A grown-up will say yes or not this time.')).toBeVisible();
});

test('Me: closed without a PIN when two children share the kiosk', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Me', exact: true }).click();
  await expect(page.getByText('This page is just for you, so it needs your own four numbers. Ask Mum or Dad to choose them with you.')).toBeVisible();
});

test('Me: something I did, something I am learning, and a question about a rule', async ({ page, request }) => {
  // Two children share the demo kiosk, so Me needs Ollie's own PIN: Mum sets it.
  const s = sessions();
  const origin = `http://localhost:${DEMO_PORT}`;
  const set = await request.put(`${origin}/api/kiosks/pins/${s.children.ollie}`, {
    headers: { origin, cookie: `__Host-ft_session=${s.mum.session}; __Host-ft_csrf=${s.mum.csrf}`, 'x-csrf-token': s.mum.csrf },
    data: { pin: '4826' },
  });
  expect(set.ok()).toBe(true);
  await page.addInitScript((t) => localStorage.setItem('ft-kiosk-token', t), s.kiosk);
  await page.goto('/');
  await page.getByRole('button', { name: 'Ollie' }).click();
  for (const n of '4826') await page.getByRole('button', { name: n, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hi Ollie' })).toBeVisible();

  await page.getByRole('button', { name: 'Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Things I did' })).toBeVisible();

  await page.getByRole('button', { name: 'Add something I did' }).click();
  await page.getByLabel('What did you do away from screens?').fill('Built a den');
  await page.getByRole('button', { name: 'Tent' }).click();
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText('Built a den')).toBeVisible();

  await page.getByRole('button', { name: "Add something I'm learning" }).click();
  await page.getByLabel('What are you learning to do?').fill('Ride my bike');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText('Ride my bike')).toBeVisible();

  await page.getByRole('button', { name: 'Ask about a rule' }).click();
  await page.getByLabel('Which rule would you like to talk about, and why?').fill('Could I have more time on Saturdays?');
  await page.getByRole('button', { name: 'Send it' }).click();
  await expect(page.getByText('Waiting for a grown-up')).toBeVisible();
  await shot(page, 'kiosk-me-light', 'phase-11');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Hi Ollie' })).toBeVisible();
});

test('shows what Mum and Dad can see', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'What Mum and Dad can see' }).click();
  await expect(page.getByRole('heading', { name: "They can't see" })).toBeVisible();
  await shot(page, 'kiosk-parents-see-light', PHASE);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Hi Ollie' })).toBeVisible();
});
