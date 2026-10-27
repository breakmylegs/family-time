// Commands run on the server's command line. Kept free of Fastify: a test follows the imports.
import { households, people, type Db } from '@family-time/db';
import { and, asc, eq } from 'drizzle-orm';
import { audit } from '../audit.js';
import { createJoinInvite, createRecoveryLink, inviteLink, OWNER_INVITE_MS } from '../auth/invites.js';
import { normaliseOrigin, SETTING_PUBLIC_ORIGIN, setSetting, theHousehold, webOrigin } from '../settings.js';

export class CliError extends Error {}

export interface OwnerInviteOptions {
  origin: string;
  ownerName?: string;
  familyName?: string;
}

/**
 * First-time setup: records the web address and makes a 24-hour link for the first owner. Refuses
 * once any owner exists, so it cannot be used to add a second owner behind the first one's back.
 */
export async function ownerInvite(db: Db, options: OwnerInviteOptions, now: Date): Promise<{ link: string; expiresAt: Date }> {
  const origin = normaliseOrigin(options.origin);
  let household = await theHousehold(db);
  if (household) {
    const owners = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.householdId, household.id), eq(people.role, 'owner'), eq(people.active, true)))
      .limit(1);
    if (owners.length) {
      throw new CliError('An owner already exists. Use recovery-link to get back in, or invite people from the app.');
    }
    const current = await webOrigin(db, household.id);
    if (current && current.origin !== origin) {
      throw new CliError(`This install is already set up for ${current.origin}. Passkeys are tied to that address.`);
    }
  } else {
    const rows = await db
      .insert(households)
      .values({ name: options.familyName?.trim() || 'Our family', createdAt: now })
      .returning({ id: households.id, name: households.name });
    household = rows[0]!;
  }
  await setSetting(db, household.id, SETTING_PUBLIC_ORIGIN, origin);
  const invite = await createJoinInvite(db, {
    householdId: household.id,
    role: 'owner',
    displayName: options.ownerName?.trim() || 'Owner',
    createdBy: null,
    now,
    ttlMs: OWNER_INVITE_MS,
  });
  await audit(db, { householdId: household.id, actor: { label: 'cli' }, action: 'setup.owner_invite_issued', targetType: 'invite', targetId: invite.id, after: { origin } });
  return { link: inviteLink(origin, invite.token), expiresAt: invite.expiresAt };
}

/**
 * Break-glass: a 30-minute link that lets an owner add a new passkey, for a lost or replaced
 * phone. Old passkeys stay. With several owners, name one with `person`.
 */
export async function recoveryLink(db: Db, options: { person?: string }, now: Date): Promise<{ link: string; expiresAt: Date; for: string }> {
  const household = await theHousehold(db);
  const site = household ? await webOrigin(db, household.id) : undefined;
  if (!household || !site) throw new CliError('Nothing is set up yet. Run owner-invite first.');
  const owners = await db
    .select({ id: people.id, displayName: people.displayName })
    .from(people)
    .where(and(eq(people.householdId, household.id), eq(people.role, 'owner'), eq(people.active, true)))
    .orderBy(asc(people.createdAt));
  if (!owners.length) throw new CliError('There is no owner yet. Run owner-invite first.');
  const wanted = options.person?.trim().toLowerCase();
  const matches = wanted ? owners.filter((o) => o.id === wanted || o.displayName.toLowerCase() === wanted) : owners;
  if (matches.length !== 1) {
    const list = owners.map((o) => `  ${o.displayName} (${o.id})`).join('\n');
    throw new CliError(`${wanted ? `No single owner matches "${options.person}".` : 'There is more than one owner.'} Choose one with --person:\n${list}`);
  }
  const owner = matches[0]!;
  const link = await createRecoveryLink(db, { householdId: household.id, personId: owner.id, now });
  await audit(db, { householdId: household.id, actor: { label: 'cli' }, action: 'recovery.link_issued', targetType: 'person', targetId: owner.id });
  return { link: inviteLink(site.origin, link.token), expiresAt: link.expiresAt, for: owner.displayName };
}
