// The Control screen against the demo family, in WebKit at 390 by 844: Allow with the sheet, Undo,
// Block, Normal, Pause everything with its confirmation, Resume, the conflict tap, and roles.
import { expect, test, type Page } from '@playwright/test';
import { reset, sessions, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-3';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

async function openOllie(page: Page) {
  await page.goto(`/?child=${sessions().children.ollie}`);
  await expect(page.getByRole('heading', { name: 'Right now', level: 2 })).toBeVisible();
  // The reconciler has confirmed what the demo starts with.
  await expect(page.getByText(/Starting on|Blocking on/)).toHaveCount(0);
}

const row = (page: Page, name: string) => page.locator('.svc').filter({ has: page.getByRole('heading', { name }) });

for (const scheme of ['light', 'dark'] as const) {
  test(`looks like the mock, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openOllie(page);
    await expect(page.getByText('Free time now.')).toBeVisible();
    await expect(page.getByText('Wind-down starts at 19:30.')).toBeVisible();
    await expect(row(page, 'YouTube').getByText('Allowed until 19:00')).toBeVisible();
    await expect(row(page, 'YouTube').getByText('Ollie planned 30 minutes of screen time.')).toBeVisible();
    await expect(row(page, 'Minecraft').getByText('Allowed until 19:30')).toBeVisible();
    await expect(row(page, 'Minecraft').getByText('Dad allowed it.')).toBeVisible();
    await expect(row(page, 'Roblox').locator('.svc-line')).toHaveText('Blocked');
    await expect(page.getByText('Dad allowed Minecraft until 19:30.')).toBeVisible();
    await expect(page.getByText('YouTube unlocked. Ollie planned 30 minutes.')).toBeVisible();
    await shot(page, `control-${scheme}`, PHASE);
  });
}

test('Allow with the sheet, then Undo', async ({ page }) => {
  await openOllie(page);
  await row(page, 'Roblox').getByRole('button', { name: 'Allow' }).click();
  const sheet = page.getByRole('dialog', { name: 'Allow Roblox' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Ollie hasn't planned any Roblox time today.")).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /For 30 minutes/ })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByRole('radio', { name: /For 30 minutes/ })).toContainText('until 19:02');
  await sheet.getByRole('radio', { name: /For 1 hour/ }).click();
  await expect(sheet.getByRole('radio', { name: /For 1 hour/ })).toContainText('Runs into wind-down');
  await expect(sheet.getByRole('switch', { name: "Count it in Ollie's weekly time" })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByText("Takes up to a minute to start on Ollie's iPad.")).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `sheet-allow-${scheme}`, PHASE);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await sheet.getByRole('button', { name: 'Allow Roblox for 1 hour' }).click();
  await expect(sheet).toBeHidden();

  const roblox = row(page, 'Roblox');
  await expect(roblox.locator('.svc-line')).toHaveText('Allowed until 19:32');
  await expect(roblox.getByText('Mum allowed it.')).toBeVisible();
  await expect(roblox.getByText("Starting on Ollie's iPad. Takes up to a minute.")).toBeVisible();
  await expect(roblox.getByText("Working on Ollie's iPad now.")).toBeVisible();
  await expect(roblox.getByRole('button', { name: 'Allow' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Roblox allowed for 1 hour.' })).toBeVisible();
  await shot(page, 'control-after-allow', PHASE);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(roblox.locator('.svc-line')).toHaveText('Blocked');
  await expect(roblox.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Undone. Takes up to a minute to change back.' })).toBeAttached();
});

test('Block during planned time, Normal, and Undo of Normal', async ({ page }) => {
  await openOllie(page);
  const youtube = row(page, 'YouTube');
  await youtube.getByRole('button', { name: 'Block' }).click();
  const sheet = page.getByRole('dialog', { name: 'Block YouTube' });
  await expect(sheet.getByText("It's in Ollie's planned time right now.")).toBeVisible();
  await expect(sheet.getByText('His planned time pauses, and the minutes not used go back to him. Takes up to a minute.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Block YouTube for 30 minutes' }).click();
  await expect(youtube.locator('.svc-line')).toHaveText('Blocked until 19:02');
  await expect(youtube.getByText("Blocked on Ollie's iPad now.")).toBeVisible();

  await youtube.getByRole('button', { name: 'Normal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'YouTube back to normal. Allowed until 19:00.' })).toBeVisible();
  await expect(youtube.locator('.svc-line')).toHaveText('Allowed until 19:00');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(youtube.locator('.svc-line')).toHaveText('Blocked until 19:02');
});

test('Pause everything asks first, then Resume', async ({ page }) => {
  await openOllie(page);
  await page.getByRole('button', { name: 'Pause everything', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Pause everything' });
  await expect(sheet.getByText("Pauses Minecraft, Roblox and YouTube on Ollie's iPad. Takes up to a minute, and a video that's already playing may finish first.")).toBeVisible();
  await expect(sheet.getByText('Best for meals and family time, rather than as a punishment.')).toBeVisible();
  await expect(sheet.getByRole('radio')).toHaveCount(4);
  await sheet.getByRole('radio', { name: /Until I resume/ }).click();
  await shot(page, 'sheet-pause-light', PHASE);
  await sheet.getByRole('button', { name: 'Pause everything until you resume' }).click();

  await expect(page.locator('.now-line')).toHaveText('Everything is paused until someone resumes it. Mum started it.');
  for (const name of ['YouTube', 'Roblox', 'Minecraft']) await expect(row(page, name).locator('.svc-line')).toHaveText('Paused');
  await expect(row(page, 'Roblox').getByRole('button', { name: 'Allow' })).toBeDisabled();
  await expect(page.locator('.rail-pause')).toHaveAttribute('data-on', 'true');
  await expect(page.getByText('Mum paused everything until someone resumes it.')).toBeVisible();
  await expect(page.getByText('Everything is paused. Tap Resume now to change an app.')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.getByText(/Pausing on/)).toHaveCount(0);
    await shot(page, `control-paused-${scheme}`, PHASE);
  }

  await page.getByRole('button', { name: 'Resume now' }).click();
  await expect(page.getByRole('status').filter({ hasText: "Everything's back to normal. Takes up to a minute." })).toBeVisible();
  await expect(page.locator('.now-line')).toHaveText('Free time now. Wind-down starts at 19:30.');
  await expect(row(page, 'YouTube').locator('.svc-line')).toHaveText('Allowed until 19:00');
  // Undo of Resume puts the pause back as it was.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.now-line')).toHaveText('Everything is paused until someone resumes it. Mum started it.');
});

test('the conflict tap: one tap on how it went, kept after a reload', async ({ page }) => {
  await openOllie(page);
  await row(page, 'Roblox').getByRole('button', { name: 'Block' }).click();
  await page.getByRole('dialog', { name: 'Block Roblox' }).getByRole('button', { name: 'Block Roblox for 30 minutes' }).click();
  const moods = page.getByRole('group', { name: 'How did it go? Mum blocked Roblox until 19:02.' });
  await expect(moods).toBeVisible();
  await moods.getByRole('button', { name: 'Grumble' }).click();
  await expect(moods.getByRole('button', { name: 'Grumble' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('group', { name: 'How did it go? Mum blocked Roblox until 19:02.' }).getByRole('button', { name: 'Grumble' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.hist').scrollIntoViewIfNeeded();
  await shot(page, 'control-today-light', PHASE);
});

test('switches child', async ({ page }) => {
  await openOllie(page);
  await page.getByRole('button', { name: 'Showing Ollie. Switch child' }).click();
  await page.getByRole('dialog', { name: 'Choose a child' }).getByRole('radio', { name: 'Jamie' }).click();
  await expect(page.getByRole('button', { name: 'Showing Jamie. Switch child' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`child=${sessions().children.jamie}`));
});

test('a carer can pause but not allow or block', async ({ page, context }) => {
  await signInAs(context, 'gran');
  await openOllie(page);
  await expect(page.getByRole('button', { name: 'Pause everything', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
});

test('a sheet can be left without changing anything', async ({ page }) => {
  await openOllie(page);
  await row(page, 'Roblox').getByRole('button', { name: 'Block' }).click();
  const sheet = page.getByRole('dialog', { name: 'Block Roblox' });
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(row(page, 'Roblox').locator('.svc-line')).toHaveText('Blocked');
  await expect(row(page, 'Roblox').getByRole('button', { name: 'Block' })).toBeFocused();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Settings, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openOllie(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByText("Ollie's iPad")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on alerts' })).toBeVisible();
    await shot(page, `settings-${scheme}`, PHASE);
  });
}
