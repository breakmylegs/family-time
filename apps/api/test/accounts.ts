// Fixtures for account tests: a household with an origin, people, and signed-in sessions.
import { households, people, type Db, type Role } from '@family-time/db';
import { createSession } from '../src/auth/sessions.js';
import { randomToken } from '../src/auth/tokens.js';
import { SETTING_PUBLIC_ORIGIN, setSetting } from '../src/settings.js';
import { NOW } from './helpers.js';

export const ORIGIN = 'http://localhost:5174';

export async function seedHousehold(db: Db): Promise<string> {
  const rows = await db.insert(households).values({ name: 'The Testers' }).returning({ id: households.id });
  const id = rows[0]!.id;
  await setSetting(db, id, SETTING_PUBLIC_ORIGIN, ORIGIN);
  return id;
}

export async function seedPerson(db: Db, householdId: string, role: Role, displayName = `${role} person`): Promise<string> {
  const rows = await db.insert(people).values({ householdId, role, displayName }).returning({ id: people.id });
  return rows[0]!.id;
}

/** Headers for a signed-in person's state-changing request: cookies, CSRF header and Origin. */
export async function signedIn(db: Db, personId: string): Promise<Record<string, string>> {
  const session = await createSession(db, personId, 'test', NOW);
  const csrf = randomToken();
  return {
    cookie: `__Host-ft_session=${session}; __Host-ft_csrf=${csrf}`,
    'x-csrf-token': csrf,
    origin: ORIGIN,
  };
}
