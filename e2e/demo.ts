// The demo family on the frozen clock (apps/api/dev/demo.ts). WebKit cannot make a passkey in a
// test, so these sign in with the cookies the dev server wrote for Mum, Dad and Gran.
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { DEMO_PORT, SESSION_FILE } from '../playwright.config';

interface Sessions {
  mum: { session: string; csrf: string };
  dad: { session: string; csrf: string };
  gran: { session: string; csrf: string };
  children: { ollie: string; jamie: string };
}

export function sessions(): Sessions {
  if (!existsSync(SESSION_FILE)) throw new Error(`No ${SESSION_FILE}. The demo server writes it on start.`);
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Sessions;
}

export async function signInAs(context: BrowserContext, who: 'mum' | 'dad' | 'gran'): Promise<void> {
  const s = sessions()[who];
  const url = `http://localhost:${DEMO_PORT}`;
  await context.clearCookies();
  await context.addCookies([
    { name: '__Host-ft_session', value: s.session, url, secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: '__Host-ft_csrf', value: s.csrf, url, secure: true, sameSite: 'Lax' },
  ]);
}

/** Back to the mock's 18:32. Uses the test's own request context, which carries no session. */
export async function reset(request: APIRequestContext): Promise<void> {
  const origin = `http://localhost:${DEMO_PORT}`;
  const res = await request.post(`${origin}/__dev/reset`, { headers: { origin } });
  if (!res.ok()) throw new Error(`reset failed: ${res.status()}`);
}
