import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * One row, written by the worker's heartbeat job. Readiness reads it, so a stale row means the
 * job queue has stopped, not just that the worker process is up.
 */
export const workerHeartbeat = pgTable(
  'worker_heartbeat',
  {
    id: smallint('id').primaryKey().default(1),
    beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
    commit: text('commit').notNull(),
  },
  (t) => [check('worker_heartbeat_single_row', sql`${t.id} = 1`)],
);

/** One per install in V1. Every other row hangs off a household, so V2 can hold several. */
export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/London'),
  /** Day and time the week closes, in the household's time zone, for example `SUN 18:00`. */
  weekResets: text('week_resets').notNull().default('SUN 18:00'),
  pilotPhase: text('pilot_phase').notNull().default('baseline'),
  createdAt: createdAt(),
});

/** Settings a person changes in the app, never in `.env`. */
export const settings = pgTable(
  'settings',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.key] })],
);

export const ROLES = ['owner', 'parent', 'carer', 'child'] as const;
export type Role = (typeof ROLES)[number];

export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    displayName: text('display_name').notNull(),
    role: text('role').$type<Role>().notNull(),
    avatarColour: text('avatar_colour'),
    active: boolean('active').notNull().default(true),
    /** Optional OIDC subject, for the owner only. */
    oidcSubject: text('oidc_subject'),
    createdAt: createdAt(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (t) => [
    check('people_role', sql`${t.role} in ('owner', 'parent', 'carer', 'child')`),
    check('people_oidc_owner_only', sql`${t.oidcSubject} is null or ${t.role} = 'owner'`),
    uniqueIndex('people_oidc_subject').on(t.oidcSubject),
    index('people_household').on(t.householdId),
  ],
);

/** WebAuthn credentials. A person can have several (phone, iPad, a recovery key). */
export const passkeys = pgTable(
  'passkeys',
  {
    /** The credential id, base64url. */
    id: text('id').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    publicKey: bytea('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array().notNull().default(sql`'{}'::text[]`),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    label: text('label').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_person').on(t.personId)],
);

/** Only a SHA-256 hash of the session id is stored, so a database copy holds no live sessions. */
export const sessions = pgTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_person').on(t.personId)],
);

export const INVITE_KINDS = ['join', 'recovery'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

/**
 * A single-use link. `join` adds a new person with `role`; `recovery` lets an existing person
 * (`person_id`) add a passkey. Only a hash of the token is stored.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    kind: text('kind').$type<InviteKind>().notNull(),
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<Role>(),
    displayName: text('display_name'),
    personId: uuid('person_id').references(() => people.id),
    /** Null when made on the server's command line. */
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invites_token_hash').on(t.tokenHash),
    check('invites_kind', sql`${t.kind} in ('join', 'recovery')`),
    check(
      'invites_shape',
      // Every test is written to be true or false, never null: a null CHECK passes.
      sql`(${t.kind} = 'join' and ${t.role} is not null and ${t.role} in ('owner', 'parent', 'carer')
            and ${t.displayName} is not null and ${t.personId} is null)
       or (${t.kind} = 'recovery' and ${t.personId} is not null and ${t.role} is null)`,
    ),
  ],
);

/** A WebAuthn challenge, kept until it is answered or five minutes pass. */
export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').$type<'register' | 'authenticate'>().notNull(),
  inviteId: uuid('invite_id').references(() => invites.id),
  personId: uuid('person_id').references(() => people.id),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/**
 * Append-only: a trigger refuses UPDATE, DELETE and TRUNCATE. The actor is a person or a system
 * label (for example `cli`), never both and never neither.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    householdId: uuid('household_id').references(() => households.id),
    actorPersonId: uuid('actor_person_id').references(() => people.id),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
  },
  (t) => [
    check('audit_events_one_actor', sql`(${t.actorPersonId} is null) <> (${t.actorLabel} is null)`),
    index('audit_events_at').on(t.at),
    index('audit_events_actor').on(t.actorPersonId),
    index('audit_events_target').on(t.targetType, t.targetId),
  ],
);
