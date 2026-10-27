import { people, sessions, type Db, type Role } from '@family-time/db';
import { and, eq, gt } from 'drizzle-orm';
import { randomToken, sha256 } from './tokens.js';

/** Signed out after 30 days without use, and after 180 days whatever happens. */
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 180 * 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often, so reads do not become writes. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export interface SessionPerson {
  id: string;
  householdId: string;
  displayName: string;
  role: Role;
}

export interface AuthContext {
  person: SessionPerson;
  sessionHash: string;
}

/** A new session. Returns the raw id for the cookie; only its hash is stored. */
export async function createSession(db: Db, personId: string, userAgent: string | undefined, now: Date): Promise<string> {
  const id = randomToken();
  await db.insert(sessions).values({
    idHash: sha256(id),
    personId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return id;
}

/** The signed-in person for a raw session id, or undefined when it is unknown, expired, idle or the person is inactive. */
export async function findSession(db: Db, rawId: string, now: Date): Promise<AuthContext | undefined> {
  const idHash = sha256(rawId);
  const rows = await db
    .select({
      lastSeenAt: sessions.lastSeenAt,
      person: { id: people.id, householdId: people.householdId, displayName: people.displayName, role: people.role },
    })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, now), eq(people.active, true)));
  const row = rows[0];
  if (!row) return undefined;
  const idleFor = now.getTime() - row.lastSeenAt.getTime();
  if (idleFor > SESSION_IDLE_MS) {
    await db.delete(sessions).where(eq(sessions.idHash, idHash));
    return undefined;
  }
  if (idleFor > TOUCH_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.idHash, idHash));
  }
  return { person: row.person, sessionHash: idHash };
}

export async function endSession(db: Db, sessionHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.idHash, sessionHash));
}

/** Signs a person out everywhere, for example when their role changes or they are removed. */
export async function revokeAllSessions(db: Db, personId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.personId, personId));
}
