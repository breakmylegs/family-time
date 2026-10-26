import { households, invites, people, type Db, type InviteKind, type Role } from '@family-time/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomToken, sha256 } from './tokens.js';

export const JOIN_INVITE_MS = 7 * 24 * 60 * 60 * 1000;
export const OWNER_INVITE_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_LINK_MS = 30 * 60 * 1000;

/** The token goes after `#`, so browsers never send it to a server or in a Referer header. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/join#${token}`;
}

export async function createJoinInvite(
  db: Db,
  input: { householdId: string; role: Exclude<Role, 'child'>; displayName: string; createdBy: string | null; now: Date; ttlMs: number },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  const rows = await db
    .insert(invites)
    .values({
      householdId: input.householdId,
      kind: 'join',
      tokenHash: sha256(token),
      role: input.role,
      displayName: input.displayName,
      createdBy: input.createdBy,
      createdAt: input.now,
      expiresAt,
    })
    .returning({ id: invites.id });
  return { id: rows[0]!.id, token, expiresAt };
}

export async function createRecoveryLink(
  db: Db,
  input: { householdId: string; personId: string; now: Date },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(input.now.getTime() + RECOVERY_LINK_MS);
  const rows = await db
    .insert(invites)
    .values({ householdId: input.householdId, kind: 'recovery', tokenHash: sha256(token), personId: input.personId, createdAt: input.now, expiresAt })
    .returning({ id: invites.id });
  return { id: rows[0]!.id, token, expiresAt };
}

export interface UsableInvite {
  id: string;
  householdId: string;
  householdName: string;
  kind: InviteKind;
  role: Role | null;
  displayName: string | null;
  personId: string | null;
  personName: string | null;
}

/** An invite that is not used, revoked or expired. A recovery link also needs its person active. */
export async function findUsableInvite(db: Db, token: string, now: Date): Promise<UsableInvite | undefined> {
  const rows = await db
    .select({
      id: invites.id,
      householdId: invites.householdId,
      householdName: households.name,
      kind: invites.kind,
      role: invites.role,
      displayName: invites.displayName,
      personId: invites.personId,
      personName: people.displayName,
      personActive: people.active,
    })
    .from(invites)
    .innerJoin(households, eq(households.id, invites.householdId))
    .leftJoin(people, eq(people.id, invites.personId))
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now)));
  const row = rows[0];
  if (!row) return undefined;
  if (row.kind === 'recovery' && !row.personActive) return undefined;
  const { personActive: _active, ...invite } = row;
  return invite;
}

/** Marks an invite used, once. False when another request got there first. */
export async function consumeInvite(db: Db, inviteId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(invites)
    .set({ usedAt: now })
    .where(and(eq(invites.id, inviteId), isNull(invites.usedAt), isNull(invites.revokedAt)))
    .returning({ id: invites.id });
  return rows.length === 1;
}
