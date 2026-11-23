import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
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
    /** With the Besu ledger: when the worker last reached the node. Readiness reads it (the api cannot reach Besu). */
    chainSeenAt: timestamp('chain_seen_at', { withTimezone: true }),
    /** When the worker last had any answer from AdGuard. Readiness reads it: the api holds no AdGuard password (ADR 0022). */
    adguardSeenAt: timestamp('adguard_seen_at', { withTimezone: true }),
  },
  (t) => [check('worker_heartbeat_single_row', sql`${t.id} = 1`)],
);

/**
 * The discovery helper's questions, answered by the worker, which alone talks to AdGuard: one
 * device's DNS questions in the last 30 minutes. The api deletes each row once it has read it, and
 * the retention sweep removes any left after an hour, so no query history is kept.
 */
export const discoveryRequests = pgTable(
  'discovery_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** The device's questions: time, client, client name and domain only. */
    result: jsonb('result'),
    error: text('error'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('discovery_requests_at').on(t.requestedAt)],
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
    /** A child's optional kiosk PIN (brief Part 8), for siblings sharing a tablet: a salted scrypt hash. */
    kioskPinHash: text('kiosk_pin_hash'),
    /** A child's age band (research, Age bands): `5-7`, `8-10`, `11-13` or `14+`. Null until a parent sets it. */
    ageBand: text('age_band').$type<'5-7' | '8-10' | '11-13' | '14+'>(),
    /** A child's platform setup checklist: the ids of the items a parent has ticked. */
    setupDone: text('setup_done').array().notNull().default(sql`'{}'::text[]`),
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
    /** Removed in Settings: kept for its usage history, and its AdGuard client is taken away. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
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
    /** The end chosen when it was set, kept when a parent ends it early, so Undo can put it back. */
    plannedEndsAt: timestamp('planned_ends_at', { withTimezone: true }),
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

// ---------------------------------------------------------------------------------------------
// Phase 4: the economy.

/**
 * The ledger (ADR 0012). Append-only, refused UPDATE and DELETE by a trigger. Each row carries the
 * SHA-256 of the previous row's hash and its own canonical JSON, numbered per household, so a
 * changed or missing row shows up when the chain is checked. One row is one event, with signed
 * changes to the child's three balances. There is no deduction: see `LEDGER_KINDS`.
 */
export const LEDGER_KINDS = ['allowance', 'award', 'spend', 'refund', 'convert', 'close', 'payout', 'reversal'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    kind: text('kind').$type<LedgerKind>().notNull(),
    /** Minutes of screen time. */
    time: integer('time').notNull().default(0),
    /** Pence. */
    money: integer('money').notNull().default(0),
    /** Flex points. */
    flex: integer('flex').notNull().default(0),
    /** The idempotency reference: the same action twice is one entry. */
    ref: text('ref').notNull(),
    /** For people: "Emptied the dishwasher", "Unused time, week of 25 October". */
    reason: text('reason').notNull(),
    data: jsonb('data').notNull().default({}),
    byPersonId: uuid('by_person_id').references(() => people.id),
    /** When it happened, from the app's clock (the fake one in tests). */
    at: timestamp('at', { withTimezone: true }).notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    /** Set by the Besu indexer (Phase 5); null on the Postgres ledger. */
    blockNumber: bigint('block_number', { mode: 'number' }),
    txHash: text('tx_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    check('ledger_entries_kind', sql`${t.kind} in ('allowance', 'award', 'spend', 'refund', 'convert', 'close', 'payout', 'reversal')`),
    uniqueIndex('ledger_entries_household_seq').on(t.householdId, t.seq),
    uniqueIndex('ledger_entries_household_ref').on(t.householdId, t.ref),
    uniqueIndex('ledger_entries_hash').on(t.hash),
    index('ledger_entries_child_at').on(t.childId, t.at),
  ],
);

/**
 * The Besu ledger's contracts (ADR 0014), one row per deployment. Contracts are immutable, so a
 * new version is a new row and the history is replayed onto it; only one is active at a time.
 * `indexedBlock` is how far the indexer has read its events.
 */
export const ledgerContracts = pgTable(
  'ledger_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    address: text('address').notNull(),
    chainId: integer('chain_id').notNull(),
    version: text('version').notNull(),
    deployedBlock: bigint('deployed_block', { mode: 'number' }).notNull(),
    indexedBlock: bigint('indexed_block', { mode: 'number' }),
    active: boolean('active').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ledger_contracts_address').on(t.chainId, t.address), uniqueIndex('ledger_contracts_one_active').on(t.active).where(sql`${t.active}`)],
);

export const LEDGER_TX_STATUSES = ['pending', 'sent', 'mined', 'failed'] as const;
export type LedgerTxStatus = (typeof LEDGER_TX_STATUSES)[number];

/**
 * The signer's queue: one transaction per ledger entry per contract, written in the same database
 * transaction as the entry. The signer sends them in `position` order, one at a time per nonce.
 * Unlike the ledger itself, rows here change: pending, sent, then mined or failed.
 */
export const ledgerTx = pgTable(
  'ledger_tx',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    position: bigserial('position', { mode: 'number' }).notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => ledgerContracts.id),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => ledgerEntries.id),
    /** The keccak-256 of the entry's ref: what the contract sees. */
    refHash: text('ref_hash').notNull(),
    status: text('status').$type<LedgerTxStatus>().notNull().default('pending'),
    nonce: integer('nonce'),
    txHash: text('tx_hash'),
    blockNumber: bigint('block_number', { mode: 'number' }),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ledger_tx_status', sql`${t.status} in ('pending', 'sent', 'mined', 'failed')`),
    uniqueIndex('ledger_tx_contract_entry').on(t.contractId, t.entryId),
    index('ledger_tx_contract_status').on(t.contractId, t.status, t.position),
  ],
);

/**
 * What the indexer read from the chain: one row per ledger event, idempotent on block and log
 * index. The ledger's own rows never change, so the chain's confirmation lives here.
 */
export const ledgerConfirmations = pgTable(
  'ledger_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => ledgerContracts.id),
    refHash: text('ref_hash').notNull(),
    event: text('event').notNull(),
    childAddress: text('child_address').notNull(),
    time: integer('time').notNull().default(0),
    money: integer('money').notNull().default(0),
    flex: integer('flex').notNull().default(0),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    logIndex: integer('log_index').notNull(),
    txHash: text('tx_hash').notNull(),
    /** The entry's time as the app wrote it, carried in the event. */
    at: timestamp('at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ledger_confirmations_log').on(t.contractId, t.blockNumber, t.logIndex), uniqueIndex('ledger_confirmations_ref').on(t.contractId, t.refHash)],
);

/** A child's weekly screen time allowance, agreed at the family review. */
export const allowances = pgTable('allowances', {
  childId: uuid('child_id')
    .primaryKey()
    .references(() => people.id),
  weeklyMinutes: integer('weekly_minutes').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The allowance coming down a step at a time. A step applies only once ticked agreed at the review. */
export const reductionPlans = pgTable('reduction_plans', {
  childId: uuid('child_id')
    .primaryKey()
    .references(() => people.id),
  stepMinutes: integer('step_minutes').notNull(),
  everyWeeks: smallint('every_weeks').notNull(),
  floorMinutes: integer('floor_minutes').notNull(),
  nextStepOn: date('next_step_on', { mode: 'string' }).notNull(),
  agreedStepOn: date('agreed_step_on', { mode: 'string' }),
  agreedBy: uuid('agreed_by').references(() => people.id),
  agreedAt: timestamp('agreed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const REWARD_TYPES = ['money', 'flex', 'time', 'praise'] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

/** A job or activity. Praise-only ones carry no points (brief Part 6). */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    /** Null: any child in the family. */
    childId: uuid('child_id').references(() => people.id),
    title: text('title').notNull(),
    /** An icon name from the app's fixed set. */
    picture: text('picture').notNull().default('star'),
    rewardType: text('reward_type').$type<RewardType>().notNull(),
    /** Pence, points or minutes. Zero for praise only. */
    amount: integer('amount').notNull().default(0),
    /** `{ "kind": "once" }`, `{ "kind": "daily" }` or `{ "kind": "weekly", "weekdays": [1, 3] }`. */
    recurrence: jsonb('recurrence').notNull().default({ kind: 'daily' }),
    ageBand: text('age_band'),
    needsPhoto: boolean('needs_photo').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('tasks_reward', sql`${t.rewardType} in ('money', 'flex', 'time', 'praise')`),
    check('tasks_amount', sql`(${t.rewardType} = 'praise' and ${t.amount} = 0) or (${t.rewardType} <> 'praise' and ${t.amount} > 0)`),
    index('tasks_household').on(t.householdId),
  ],
);

/** "I did it": the child logs a job; a parent approves it with a note, or says not yet. */
export const completions = pgTable(
  'completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull(),
    /** Local file, deleted 30 days after approval (Phase 6 and 8). */
    photoPath: text('photo_path'),
    status: text('status').$type<'waiting' | 'approved' | 'not-yet'>().notNull().default('waiting'),
    /** The parent's note, shown on the kiosk. */
    note: text('note'),
    /** What was paid, as decided at approval: the time cap can make it less than the task's amount. */
    paid: jsonb('paid'),
    decidedBy: uuid('decided_by').references(() => people.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [check('completions_status', sql`${t.status} in ('waiting', 'approved', 'not-yet')`), index('completions_child_status').on(t.childId, t.status)],
);

/** "Ask a grown-up": time outside the plan. Approving makes a grant that uses the allowance. */
export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    targetKind: text('target_kind').$type<'service' | 'group'>().notNull(),
    targetId: uuid('target_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    minutes: integer('minutes').notNull(),
    /** What the child wrote, shown as they wrote it. Never sent to AI. */
    detail: text('detail'),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull(),
    status: text('status').$type<'waiting' | 'approved' | 'not-yet'>().notNull().default('waiting'),
    /** Approved as extra: not taken from the allowance. */
    asExtra: boolean('as_extra').notNull().default(false),
    grantId: uuid('grant_id').references(() => grants.id),
    decidedBy: uuid('decided_by').references(() => people.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [check('requests_status', sql`${t.status} in ('waiting', 'approved', 'not-yet')`), check('requests_minutes', sql`${t.minutes} > 0`)],
);

/** The child's savings goal. Progress reads from the MONEY balance. */
/**
 * A kiosk tablet (ADR 0015). Its long-lived token is stored as a SHA-256 hash; removing the kiosk
 * in Settings sets `revokedAt`, and the next request it makes is refused.
 */
export const kioskDevices = pgTable(
  'kiosk_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('kiosk_devices_token').on(t.tokenHash)],
);

/** A 6-digit code a parent makes in Settings, swapped once by the kiosk for its token. */
export const kioskPairings = pgTable(
  'kiosk_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    codeHash: text('code_hash').notNull(),
    label: text('label').notNull(),
    createdBy: uuid('created_by').references(() => people.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('kiosk_pairings_code').on(t.codeHash)],
);

/** The photo from "I did it": a JPEG the kiosk has already shrunk. Deleted 30 days after the decision. */
export const completionPhotos = pgTable('completion_photos', {
  completionId: uuid('completion_id')
    .primaryKey()
    .references(() => completions.id),
  jpeg: bytea('jpeg').notNull(),
  createdAt: createdAt(),
});

/** The child's own boredom ideas, shown on the kiosk as a row of chips. */
export const ideas = pgTable(
  'ideas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    text: text('text').notNull(),
    picture: text('picture').notNull().default('star'),
    createdAt: createdAt(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [index('ideas_child').on(t.childId)],
);

/** The Sunday reflection: three short answers about the week, one per child per week. */
export const reflections = pgTable(
  'reflections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    /** The week it is about: the date that week began. */
    week: date('week').notNull(),
    wentWell: text('went_well').notNull().default(''),
    wasHard: text('was_hard').notNull().default(''),
    nextGoal: text('next_goal').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('reflections_child_week').on(t.childId, t.week)],
);

// ---------------------------------------------------------------------------------------------
// Phase 11: enhancements from the research. Praise, never points; nothing shown to siblings.

/** Something the child did away from screens, in their words. Parents may answer with praise. */
export const journal = pgTable(
  'journal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    text: text('text').notNull(),
    picture: text('picture').notNull().default('star'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    praise: text('praise'),
    praisedBy: uuid('praised_by').references(() => people.id),
    praisedAt: timestamp('praised_at', { withTimezone: true }),
  },
  (t) => [index('journal_child').on(t.childId, t.at)],
);

/** A skill the child is learning; mastered once a parent agrees. A badge, never points. */
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    title: text('title').notNull(),
    picture: text('picture').notNull().default('star'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    masteredAt: timestamp('mastered_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => people.id),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [index('skills_child').on(t.childId)],
);

/** The child asks to talk about a rule, from the kiosk. A parent answers, or puts it on the review agenda. */
export const ruleAsks = pgTable(
  'rule_asks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    text: text('text').notNull(),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    /** `open`, `review` (on the family review agenda) or `answered`. */
    status: text('status').$type<'open' | 'review' | 'answered'>().notNull().default('open'),
    answer: text('answer'),
    decidedBy: uuid('decided_by').references(() => people.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('rule_asks_child').on(t.childId, t.status), check('rule_asks_status', sql`${t.status} in ('open', 'review', 'answered')`)],
);

/** A parent's weekly estimate of the child's screen time on devices or networks Family time does not manage. */
export const unmanagedTime = pgTable(
  'unmanaged_time',
  {
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    /** The household week's first day. */
    week: text('week').notNull(),
    minutes: integer('minutes').notNull(),
    by: uuid('by')
      .notNull()
      .references(() => people.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.childId, t.week] })],
);

/** A parent's monthly check of how the child has seemed, 1 (not good) to 5 (very good). Not a validated scale. */
export const moodChecks = pgTable(
  'mood_checks',
  {
    childId: uuid('child_id')
      .notNull()
      .references(() => people.id),
    /** `2026-11`. */
    month: text('month').notNull(),
    rating: smallint('rating').notNull(),
    note: text('note'),
    by: uuid('by')
      .notNull()
      .references(() => people.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.childId, t.month] }), check('mood_checks_rating', sql`${t.rating} between 1 and 5`)],
);

// ---------------------------------------------------------------------------------------------
// AI and MCP (Phase 7, ADR 0016). Off by default; nothing here is needed for the app to work.

/** The owner's AI switches: the master switch and each feature's provider, model, cap and data level. */
export const aiSettings = pgTable('ai_settings', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id),
  on: boolean('on').notNull().default(false),
  /** Per feature: { on, provider, model, monthlyCapPence, levelTwo }. */
  features: jsonb('features').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A provider's key, sealed with AES-256-GCM under the master key. Only the last four are ever shown. */
export const aiKeys = pgTable(
  'ai_keys',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    provider: text('provider').notNull(),
    sealed: text('sealed').notNull(),
    lastFour: text('last_four').notNull(),
    /** Google only: the owner confirms the key is on a paid plan, or Google is refused. */
    paidTier: boolean('paid_tier').notNull().default(false),
    /** Not secret: a Bedrock region, an Ollama address. */
    options: jsonb('options').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.provider] })],
);

/** Every AI call and refusal: what, where, how much. Never the prompt or the reply. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    feature: text('feature').notNull(),
    provider: text('provider'),
    model: text('model'),
    outcome: text('outcome').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Estimated, in hundredths of a penny, so small calls still add up. */
    costCentipence: integer('cost_centipence').notNull().default(0),
    level: smallint('level').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_calls_household_at').on(t.householdId, t.at)],
);

export const PROPOSAL_KINDS = ['override', 'pause', 'approval'] as const;

/**
 * What AI or an MCP client would like done. Nothing happens until a parent taps Approve, and then
 * it is the parent's own action, through the same commands as the app's buttons.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    childId: uuid('child_id').references(() => people.id),
    /** `ai`, or `mcp` with the client. */
    source: text('source').notNull(),
    clientId: uuid('client_id'),
    kind: text('kind').$type<(typeof PROPOSAL_KINDS)[number]>().notNull(),
    /** The checked arguments: ids from this family only. */
    payload: jsonb('payload').notNull(),
    /** For the card: "Allow YouTube until 17:30". */
    summary: text('summary').notNull(),
    /** What was asked, if it came from words: shown on the card, never run. */
    asked: text('asked'),
    status: text('status').$type<'waiting' | 'approved' | 'declined' | 'expired'>().notNull().default('waiting'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedBy: uuid('decided_by').references(() => people.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('proposals_household_status').on(t.householdId, t.status)],
);

/** An MCP client the owner has let in (OAuth 2.1, Client ID Metadata Documents). */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    /** The client's id: the URL of its metadata document. */
    clientUri: text('client_uri').notNull(),
    name: text('name').notNull(),
    redirectUris: jsonb('redirect_uris').notNull().default([]),
    /** The scopes it may ask for: read, propose. */
    scopes: jsonb('scopes').notNull().default(['read']),
    allowed: boolean('allowed').notNull().default(false),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('oauth_clients_uri').on(t.householdId, t.clientUri)],
);

/** An authorisation code: once, for a minute, with its PKCE challenge. Only its hash is kept. */
export const oauthCodes = pgTable('oauth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => oauthClients.id),
  personId: uuid('person_id')
    .notNull()
    .references(() => people.id),
  redirectUri: text('redirect_uri').notNull(),
  challenge: text('challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

/** Access and refresh tokens, hashed. A refresh token is used once and replaced; reuse ends the family. */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    kind: text('kind').$type<'access' | 'refresh'>().notNull(),
    /** Tokens from one sign-in share a family, so a stolen refresh token ends them all. */
    family: uuid('family').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClients.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    scope: text('scope').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('oauth_tokens_hash').on(t.tokenHash), index('oauth_tokens_family').on(t.family)],
);

/** An MCP server the app may call (the weather one in V1). The owner approves it and each tool. */
export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  name: text('name').notNull(),
  url: text('url').notNull(),
  approved: boolean('approved').notNull().default(false),
  /** Tool names the owner has approved. */
  tools: jsonb('tools').notNull().default([]),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// The whole family (Phase 9, the pilot's transitions phase): the parents' own screen time, and one
// cooperative challenge at a time. No points and nothing lost: shared progress only.

/** A parent's own estimate of their leisure screen time for one week. Self-reported, never measured. */
export const parentScreenTime = pgTable(
  'parent_screen_time',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    /** The household week's first day, `2026-11-08`. */
    week: text('week').notNull(),
    minutes: integer('minutes').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.week] })],
);

/** A family challenge: "Screen-free tea, 5 times this week". One at a time per household. */
export const familyChallenges = pgTable('family_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  title: text('title').notNull(),
  /** How many times this week. */
  target: smallint('target').notNull(),
  week: text('week').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => people.id),
  createdAt: createdAt(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

/** One "we did it", by a parent in the app or a child on the kiosk. Never taken away. */
export const challengeTicks = pgTable('challenge_ticks', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: uuid('challenge_id')
    .notNull()
    .references(() => familyChallenges.id),
  byPersonId: uuid('by_person_id')
    .notNull()
    .references(() => people.id),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id')
    .notNull()
    .references(() => people.id),
  title: text('title').notNull(),
  targetPence: integer('target_pence').notNull(),
  active: boolean('active').notNull().default(true),
  /** Optional parental matching (brief Part 6): this percent of each payout is added as the parents' own award. */
  matchPercent: smallint('match_percent').notNull().default(0),
  createdAt: createdAt(),
});
