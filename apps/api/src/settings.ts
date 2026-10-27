import { households, settings, type Db } from '@family-time/db';
import { and, asc, eq } from 'drizzle-orm';

export const SETTING_PUBLIC_ORIGIN = 'public_origin';

export async function getSetting<T>(db: Db, householdId: string, key: string): Promise<T | undefined> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.householdId, householdId), eq(settings.key, key)));
  return rows[0]?.value as T | undefined;
}

export async function setSetting(db: Db, householdId: string, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ householdId, key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value, updatedAt: new Date() } });
}

/** V1 has one household per install. The oldest is it. */
export async function theHousehold(db: Db): Promise<{ id: string; name: string } | undefined> {
  const rows = await db.select({ id: households.id, name: households.name }).from(households).orderBy(asc(households.createdAt)).limit(1);
  return rows[0];
}

export interface WebOrigin {
  /** For example `https://family.example.com`. */
  origin: string;
  /** The WebAuthn relying party id: the hostname. */
  rpId: string;
}

/** The origin the owner set with `owner-invite`. Passkeys are bound to its hostname. */
export async function webOrigin(db: Db, householdId: string): Promise<WebOrigin | undefined> {
  const origin = await getSetting<string>(db, householdId, SETTING_PUBLIC_ORIGIN);
  if (!origin) return undefined;
  return { origin, rpId: new URL(origin).hostname };
}

/** Accepts `https://host` (or `http://localhost` for development) and returns it without a path. */
export function normaliseOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${input} is not a URL. Give the address the parent app is reached at, for example https://family.example.com`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${input} must start with https://. Passkeys only work over HTTPS (or on localhost while developing)`);
  }
  return url.origin;
}
