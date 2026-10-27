import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { LINK_FILE } from '../playwright.config';
import { phone, shot } from './support';

test('owner joins, invites Mum, both sign in with passkeys, and a removed person cannot', async ({ browser }) => {
  await expect.poll(() => existsSync(LINK_FILE)).toBe(true);
  const ownerLink = readFileSync(LINK_FILE, 'utf8').trim();

  // The owner opens the link from ./scripts/ft.sh owner-invite on their phone.
  const ownerContext = await browser.newContext();
  const owner = await phone(ownerContext);
  await owner.goto(ownerLink.replace(/^https?:\/\/[^/]+/, ''));
  await expect(owner.getByRole('heading', { name: 'Hi Owner' })).toBeVisible();
  await expect(owner.getByText('join Dev family as an owner')).toBeVisible();
  await shot(owner, 'join-owner');
  await owner.getByLabel('Name this phone').fill("Owner's iPhone");
  await owner.getByRole('button', { name: 'Make my passkey' }).click();
  await expect(owner.getByRole('heading', { name: 'Hi Owner' })).toBeVisible();
  await expect(owner.getByText('You are signed in as owner')).toBeVisible();
  await expect(owner).toHaveURL(/\/$/);
  await shot(owner, 'home-owner');

  // The link works once.
  const reused = await browser.newContext();
  const reusedPage = await reused.newPage();
  await reusedPage.goto(ownerLink.replace(/^https?:\/\/[^/]+/, ''));
  await expect(reusedPage.getByRole('alert')).toHaveText(/expired or has already been used/);
  await shot(reusedPage, 'join-used-link');
  await reused.close();

  // The owner invites Mum as a parent.
  await owner.getByRole('button', { name: 'People' }).click();
  await expect(owner.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  await owner.getByLabel('Their name').fill('Mum');
  await owner.getByRole('button', { name: 'Parent' }).click();
  await owner.getByRole('button', { name: 'Make an invite link for Mum' }).click();
  const mumLink = (await owner.getByTestId('invite-link').textContent())!.trim();
  expect(mumLink).toMatch(/\/join#[A-Za-z0-9_-]{43}$/);
  await expect(owner.getByText('Waiting to join')).toBeVisible();
  await shot(owner, 'people-invite-made');

  // Mum joins on her own phone.
  const mumContext = await browser.newContext();
  const mum = await phone(mumContext);
  await mum.goto(mumLink.replace(/^https?:\/\/[^/]+/, ''));
  await expect(mum.getByRole('heading', { name: 'Hi Mum' })).toBeVisible();
  await expect(mum.getByText('join Dev family as a parent')).toBeVisible();
  await shot(mum, 'join-parent');
  await mum.getByRole('button', { name: 'Make my passkey' }).click();
  await expect(mum.getByRole('heading', { name: 'Hi Mum' })).toBeVisible();
  await expect(mum.getByText('You are signed in as parent')).toBeVisible();

  // A parent sees People but cannot invite or remove.
  await mum.getByRole('button', { name: 'People' }).click();
  await expect(mum.getByText('Owner', { exact: true })).toBeVisible();
  await expect(mum.getByRole('heading', { name: 'Invite someone' })).toHaveCount(0);
  await expect(mum.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await shot(mum, 'people-as-parent');
  await mum.getByRole('button', { name: 'Back' }).click();

  // Mum signs out, then back in with one tap: the passkey is on her phone, no name to type.
  await mum.getByRole('button', { name: 'Sign out' }).click();
  await expect(mum.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await shot(mum, 'sign-in');
  await mum.getByRole('button', { name: 'Sign in' }).click();
  await expect(mum.getByRole('heading', { name: 'Hi Mum' })).toBeVisible();

  // The owner signs out and back in too.
  await owner.getByRole('button', { name: 'Back' }).click();
  await owner.getByRole('button', { name: 'Sign out' }).click();
  await owner.getByRole('button', { name: 'Sign in' }).click();
  await expect(owner.getByRole('heading', { name: 'Hi Owner' })).toBeVisible();

  // The owner cannot remove themselves (the last owner), and is told why.
  await owner.getByRole('button', { name: 'People' }).click();
  await expect(owner.getByRole('button', { name: 'Remove Owner' })).toHaveCount(0);

  // The owner removes Mum. Her open session ends, and her passkey no longer signs her in.
  owner.once('dialog', (d) => void d.accept());
  await owner.getByRole('button', { name: 'Remove Mum' }).click();
  await expect(owner.getByText('Mum', { exact: true })).toHaveCount(0);
  await mum.reload();
  await expect(mum.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await mum.getByRole('button', { name: 'Sign in' }).click();
  await expect(mum.getByRole('alert')).toHaveText(/not recognised/);
  await shot(mum, 'sign-in-removed');

  await ownerContext.close();
  await mumContext.close();
});
