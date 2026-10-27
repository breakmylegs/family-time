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

/**
 * node-postgres writes a Buffer as bytea but turns a plain Uint8Array (what SimpleWebAuthn gives
 * us) into text. Convert on the way in, and hand back a plain Uint8Array on the way out.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
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
    /** For help text about a child: he, she or they. Null reads as they. */
    pronouns: text('pronouns').$type<'he' | 'she' | 'they'>(),
    createdAt: createdAt(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (t) => [
    check('people_role', sql`${t.role} in ('owner', 'parent', 'carer', 'child')`),
    check('people_oidc_owner_only', sql`${t.oidcSubject} is null or ${t.role} = 'owner'`),
    check('people_pronouns', sql`${t.pronouns} is null or ${t.pronouns} in ('he', 'she', 'they')`),
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

// ---------------------------------------------------------------------------------------------
// Phase 2: control. Children are people with role `child`.

/** An app or site parents control: an AdGuard built-in (by its id) or our own list of domains. */
export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    icon: text('icon'),
    source: text('source').$type<'adguard' | 'custom'>().notNull(),
    adguardId: text('adguard_id'),
    /** Custom services: the domains to block. Built-ins: AdGuard's own domains, for usage counts. */
    domains: text('domains').array().notNull().default(sql`'{}'::text[]`),
    category: text('category'),
    createdAt: createdAt(),
  },
  (t) => [
    check('services_source', sql`(${t.source} = 'adguard' and ${t.adguardId} is not null) or (${t.source} = 'custom' and ${t.adguardId} is null)`),
    uniqueIndex('services_household_adguard').on(t.householdId, t.adguardId),
  ],
);

export const serviceGroups = pgTable('service_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const serviceGroupMembers = pgTable(
  'service_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => serviceGroups.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.serviceId] })],
);

/** A child's rule for one service or one group. A service rule beats a group rule. */
export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    serviceId: uuid('service_id').references(() => services.id),
    groupId: uuid('group_id').references(() => serviceGroups.id),
    defaultState: text('default_state').$type<'blocked' | 'allowed'>().notNull().default('blocked'),
    alwaysAllowed: boolean('always_allowed').notNull().default(false),
    allowedDuringWindDown: boolean('allowed_during_wind_down').notNull().default(false),
    earnable: boolean('earnable').notNull().default(true),
    dailyCapMinutes: smallint('daily_cap_minutes'),
    sessionCapMinutes: smallint('session_cap_minutes'),
  },
  (t) => [
    check('policies_one_target', sql`(${t.serviceId} is null) <> (${t.groupId} is null)`),
    check('policies_default', sql`${t.defaultState} in ('blocked', 'allowed')`),
    uniqueIndex('policies_child_service').on(t.childId, t.serviceId),
    uniqueIndex('policies_child_group').on(t.childId, t.groupId),
  ],
);

export const DEVICE_TYPES = ['ipad', 'phone', 'console', 'laptop', 'tv', 'kiosk', 'other'] as const;

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    /** Null for a shared device. */
    childId: uuid('child_id').references(() => people.id),
    label: text('label').notNull(),
    type: text('type').notNull(),
    /** The persistent client's name in AdGuard. AdGuard maps it to the identifiers below. */
    adguardName: text('adguard_name').notNull(),
    /** What AdGuard recognises the device by: MAC, IP or ClientID. */
    identifiers: text('identifiers').array().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    quietSince: timestamp('quiet_since', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('devices_adguard_name').on(t.adguardName), check('devices_has_identifier', sql`cardinality(${t.identifiers}) > 0`)],
);

/** A schedule's blocks are local wall-clock times, validated by the domain package. */
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  childId: uuid('child_id').references(() => people.id),
  name: text('name').notNull(),
  weekdays: smallint('weekdays').array().notNull(),
  blocks: jsonb('blocks').notNull(),
  createdAt: createdAt(),
});

/** A parent's Allow, Block or Pause. Always ends: `ends_at` is null only for "until resume" pauses. */
export const overrides = pgTable(
  'overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    targetKind: text('target_kind').$type<'service' | 'group' | 'everything'>().notNull(),
    targetId: uuid('target_id'),
    type: text('type').$type<'allow' | 'block' | 'pause'>().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    overridesBedtime: boolean('overrides_bedtime').notNull().default(false),
    countsAgainstAllowance: boolean('counts_against_allowance').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
    /** Set when a parent taps Normal or Resume before the end. */
    endedBy: uuid('ended_by').references(() => people.id),
  },
  (t) => [
    check('overrides_type', sql`${t.type} in ('allow', 'block', 'pause')`),
    check(
      'overrides_target',
      sql`(${t.targetKind} = 'everything' and ${t.targetId} is null) or (${t.targetKind} in ('service', 'group') and ${t.targetId} is not null)`,
    ),
    check('overrides_end', sql`${t.endsAt} is not null or ${t.type} = 'pause'`),
    index('overrides_child_ends').on(t.childId, t.endsAt),
  ],
);

/** Screen time the child planned or a parent approved. The ledger side arrives in Phase 4. */
export const grants = pgTable(
  'grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    targetKind: text('target_kind').$type<'service' | 'group'>().notNull(),
    targetId: uuid('target_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    source: text('source').$type<'planned' | 'approved'>().notNull(),
    status: text('status').$type<'scheduled' | 'active' | 'paused' | 'ended' | 'refunded'>().notNull().default('scheduled'),
    approvedBy: uuid('approved_by').references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [check('grants_order', sql`${t.endsAt} > ${t.startsAt}`), index('grants_child_ends').on(t.childId, t.endsAt)],
);

/** What the reconciler last did for each device's AdGuard client. */
export const adguardSync = pgTable('adguard_sync', {
  deviceId: uuid('device_id')
    .primaryKey()
    .references(() => devices.id),
  state: text('state').$type<'pending' | 'confirmed' | 'not-confirmed'>().notNull(),
  /** The blocked services and rules last written, so the app can show what is in force. */
  applied: jsonb('applied'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  failures: smallint('failures').notNull().default(0),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Minutes in which a device asked for a service's domains. Aggregates only, never raw log lines. */
export const usageMinutes = pgTable(
  'usage_minutes',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
    minute: timestamp('minute', { withTimezone: true }).notNull(),
    queries: smallint('queries').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.serviceId, t.minute] }), index('usage_minutes_minute').on(t.minute)],
);

/** How far the usage job has read AdGuard's query log. One row. */
export const querylogCursor = pgTable(
  'querylog_cursor',
  {
    id: smallint('id').primaryKey().default(1),
    readUntil: timestamp('read_until', { withTimezone: true }).notNull(),
  },
  (t) => [check('querylog_cursor_single_row', sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------------------------
// Phase 3: the parent app.

/** A browser's Web Push subscription for one person. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    failures: smallint('failures').notNull().default(0),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint').on(t.endpoint), index('push_subscriptions_person').on(t.personId)],
);

/** "Was this helpful?" on a help topic. Stays on the home server. */
export const helpFeedback = pgTable('help_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  personId: uuid('person_id').references(() => people.id),
  topicId: text('topic_id').notNull(),
  helpful: boolean('helpful').notNull(),
  createdAt: createdAt(),
});

/** How a session ended, tapped by a parent: calm, grumble or meltdown. For the pilot's metrics. */
export const sessionEndings = pgTable(
  'session_endings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    /** What ended: an override or grant id, so one ending is tapped once. */
    ref: text('ref').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    mood: text('mood').$type<'calm' | 'grumble' | 'meltdown'>().notNull(),
    byPersonId: uuid('by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [check('session_endings_mood', sql`${t.mood} in ('calm', 'grumble', 'meltdown')`), uniqueIndex('session_endings_child_ref').on(t.childId, t.ref)],
);
