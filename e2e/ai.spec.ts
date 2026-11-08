// Phase 7 against the demo family, in WebKit at 390 by 844: the owner's AI and connected apps
// settings, words on Control becoming a card on Approvals, and the screen where a parent connects
// an assistant. The demo has a model that always suggests an hour of YouTube, and no network.
// Each test switches AI on through the api; the reset switches it off again.
import { expect, test, type Page } from '@playwright/test';
import { reset, sessions, signInAs } from './demo';
import { shot } from './support';

const PHASE = 'phase-7';

test.beforeEach(async ({ context, request }) => {
  await reset(request);
  await signInAs(context, 'mum');
});

/** A change as the signed-in owner, from inside the page, so Origin and the CSRF token are the app's own. */
async function call(page: Page, method: string, path: string, body: unknown): Promise<number> {
  return page.evaluate(
    async ([m, p, b]) => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('__Host-ft_csrf='))?.split('=')[1] ?? '';
      const r = await fetch(p as string, { method: m as string, headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) }, body: JSON.stringify(b) });
      return r.status;
    },
    [method, path, body] as const,
  );
}

async function switchOn(page: Page) {
  await page.goto('/settings');
  expect(await call(page, 'PUT', '/api/ai/keys/anthropic', { key: 'demo-key-not-real-WXYZ' })).toBe(200);
  const control = { on: true, provider: 'anthropic', model: 'claude-haiku-5-5', monthlyCapPence: 100, levelTwo: true };
  expect(await call(page, 'PUT', '/api/ai', { on: true, features: { control }, mcp: { on: true } })).toBe(200);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the owner's AI and connected apps settings, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await switchOn(page);
    await page.reload();
    const heading = page.getByRole('heading', { name: 'AI and connected apps' });
    await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await expect(page.getByText('Key ending WXYZ')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Use AI' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, `ai-settings-${scheme}`, PHASE);
  });
}

test('words on Control become a card that only a parent tap carries out', async ({ page }) => {
  await switchOn(page);
  await page.goto(`/?child=${sessions().children.ollie}`);
  const ask = page.getByRole('region', { name: 'Ask in your own words' });
  await ask.getByRole('textbox').fill('YouTube for an hour after homework');
  await ask.getByRole('button', { name: 'Make a card to approve' }).click();
  await expect(ask.getByText(/A card is waiting on Approvals/)).toBeVisible();
  await ask.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'ask-ai-light', PHASE);

  await page.goto(`/approvals?child=${sessions().children.ollie}`);
  const card = page.locator('.item-wrap[data-gone="false"]').filter({ hasText: 'Suggested by AI' });
  await expect(card.getByRole('heading', { name: /^Allow YouTube for .+ for an hour$/ })).toBeVisible();
  await expect(card.getByText('YouTube for an hour after homework')).toBeVisible();
  await shot(page, 'suggestion-card-light', PHASE);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Done: Allow YouTube/ })).toBeAttached();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`connecting an assistant asks the parent first, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await switchOn(page);
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: 'https://claude.example/oauth/client.json',
      redirect_uri: 'https://claude.example/callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      scope: 'read propose',
      state: 'demo',
    });
    await page.goto(`/oauth/authorize?${q}`);
    await expect(page.getByRole('heading', { name: 'Claude would like to:' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, connect it' })).toBeVisible();
    await shot(page, `consent-${scheme}`, PHASE);
  });
}
