// The kiosk's optional PIN for siblings (brief Part 8). A child with a PIN is unlocked on a tablet by
// typing it, which gives that tablet a ticket for that child. Every kiosk route for the child then
// needs the ticket, so a brother or sister cannot open someone else's home, plan with their time or
// say a job is done for them. The PIN is a salted scrypt hash; wrong tries are limited per tablet.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { people, type Db } from '@family-time/db';
import { and, eq } from 'drizzle-orm';
import { audit } from '../audit.js';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/**
 * How long an unlock lasts without use. Each use starts it again, so a child playing keeps it, and a
 * tablet put down locks itself. The kiosk app also forgets it when the screen goes off.
 */
export const TICKET_MS = 30 * 60_000;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function pinMatches(stored: string, pin: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(pin, Buffer.from(salt, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Sets or removes a child's PIN. Audited without the PIN itself. */
export async function setKioskPin(db: Db, input: { householdId: string; childId: string; by: string; pin: string | null; ip?: string }) {
  const rows = await db
    .update(people)
    .set({ kioskPinHash: input.pin ? await hashPin(input.pin) : null })
    .where(and(eq(people.id, input.childId), eq(people.householdId, input.householdId), eq(people.role, 'child')))
    .returning({ id: people.id });
  if (!rows.length) return false;
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: input.pin ? 'kiosk.pin.set' : 'kiosk.pin.removed', targetType: 'person', targetId: input.childId, ...(input.ip ? { ip: input.ip } : {}) });
  return true;
}

export async function pinOf(db: Db, householdId: string, childId: string): Promise<string | null> {
  const row = (await db.select({ pin: people.kioskPinHash }).from(people).where(and(eq(people.id, childId), eq(people.householdId, householdId))))[0];
  return row?.pin ?? null;
}

/** Tickets live in memory: a restart means typing the PIN again, which is fine for a family tablet. */
export class Tickets {
  private readonly byToken = new Map<string, { childId: string; deviceId: string; pinHash: string; expires: number }>();

  /** `pinHash` is the PIN as it is now: a new PIN (a new salt, so a new hash) ends every ticket for the old one. */
  issue(childId: string, deviceId: string, pinHash: string, now: Date): string {
    const token = randomBytes(24).toString('base64url');
    for (const [t, v] of this.byToken) if (v.expires <= now.getTime() || (v.deviceId === deviceId && v.childId === childId)) this.byToken.delete(t);
    this.byToken.set(token, { childId, deviceId, pinHash, expires: now.getTime() + TICKET_MS });
    return token;
  }

  valid(token: string | undefined, childId: string, deviceId: string, pinHash: string, now: Date): boolean {
    if (!token) return false;
    const t = this.byToken.get(token);
    if (!t || t.childId !== childId || t.deviceId !== deviceId || t.pinHash !== pinHash || t.expires <= now.getTime()) return false;
    t.expires = now.getTime() + TICKET_MS;
    return true;
  }
}
