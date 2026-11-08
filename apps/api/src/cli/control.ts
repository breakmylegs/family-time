// Setup and control from the server's command line, for Phase 2 (the app's own screens follow in
// Phase 3 and use the same commands). Free of Fastify, like the rest of the CLI.
import { BYPASS_RULES, HAGEZI_BYPASS_LIST, ruleDomainOf, SETTING_BYPASS_RULES, type AdGuard } from '@family-time/adguard-client';
import { postgresLedger, type Verification } from '@family-time/ledger';
import { setPilotPhase } from '../economy/commands.js';
import {
  allowances,
  households,
  people,
  policies,
  schedules,
  serviceGroupMembers,
  serviceGroups,
  services,
  settings,
  type Db,
} from '@family-time/db';
import { features, parseClock, PILOT_PHASES, type Features, type ScheduleBlock } from '@family-time/domain';
import type { ChildStatus, ControlTarget } from '@family-time/schemas';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { audit } from '../audit.js';
import { childStatus, endOverrides, setOverride } from '../control/commands.js';
import { createDevice, SetupError } from '../setup/commands.js';
import { CliError } from './commands.js';

/** The groups every household starts with (brief Part 3). */
export const DEFAULT_GROUPS = ['Video', 'Games', 'Social', 'Chat'] as const;

/** AdGuard built-ins added by `services sync`, with the group each goes in. Only ids AdGuard knows are added. */
export const DEFAULT_CATALOGUE: Record<string, (typeof DEFAULT_GROUPS)[number]> = {
  youtube: 'Video',
  netflix: 'Video',
  disneyplus: 'Video',
  twitch: 'Video',
  roblox: 'Games',
  minecraft: 'Games',
  fortnite: 'Games',
  steam: 'Games',
  tiktok: 'Social',
  instagram: 'Social',
  snapchat: 'Social',
  discord: 'Chat',
  whatsapp: 'Chat',
};

/**
 * Starting schedules, from the VALUES block (school nights) and the recommended weekend. Every
 * family changes these; they exist so the engine has a day to work with from the first minute.
 */
export const DEFAULT_SCHEDULES: { name: string; weekdays: number[]; blocks: ScheduleBlock[] }[] = [
  {
    name: 'School night',
    weekdays: [1, 2, 3, 4],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'free', start: '15:30', end: '17:30' },
      { type: 'pause', start: '17:30', end: '18:15', label: 'Tea' },
      { type: 'free', start: '18:15', end: '19:30' },
      { type: 'wind-down', start: '19:30', end: '20:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  },
  {
    name: 'Friday',
    weekdays: [5],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'free', start: '15:30', end: '17:30' },
      { type: 'pause', start: '17:30', end: '18:15', label: 'Tea' },
      { type: 'free', start: '18:15', end: '20:00' },
      { type: 'wind-down', start: '20:00', end: '21:00' },
      { type: 'bed', start: '21:00', end: '08:00' },
    ],
  },
  {
    name: 'Weekend',
    weekdays: [6],
    blocks: [
      { type: 'free', start: '08:00', end: '20:00' },
      { type: 'wind-down', start: '20:00', end: '21:00' },
      { type: 'bed', start: '21:00', end: '08:00' },
    ],
  },
  {
    name: 'Sunday',
    weekdays: [0],
    blocks: [
      { type: 'free', start: '08:00', end: '19:30' },
      { type: 'wind-down', start: '19:30', end: '20:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  },
];

async function household(db: Db) {
  const row = (await db.select({ id: households.id, name: households.name, timeZone: households.timezone }).from(households).orderBy(asc(households.createdAt)).limit(1))[0];
  if (!row) throw new CliError('Nothing is set up yet. Run owner-invite first.');
  return row;
}

/** The owner acts for the command line: overrides need a person, and the owner is the one at the server. */
async function owner(db: Db, householdId: string) {
  const row = (await db.select({ id: people.id }).from(people).where(and(eq(people.householdId, householdId), eq(people.role, 'owner'), eq(people.active, true))).orderBy(asc(people.createdAt)).limit(1))[0];
  if (!row) throw new CliError('There is no owner yet. Open the owner-invite link first.');
  return row.id;
}

async function childNamed(db: Db, householdId: string, name: string) {
  const rows = await db
    .select({ id: people.id, name: people.displayName })
    .from(people)
    .where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true), ilike(people.displayName, name.trim())));
  if (rows.length !== 1) throw new CliError(rows.length ? `More than one child is called ${name}.` : `No child called ${name}. Add one with child-add --name "${name}".`);
  return rows[0]!;
}

const PRONOUNS = ['he', 'she', 'they'] as const;
type Pronouns = (typeof PRONOUNS)[number];

/** For help text about the child. Unset reads as they. */
function pronounsOf(value: string | undefined): Pronouns | undefined {
  if (value === undefined) return undefined;
  if (!(PRONOUNS as readonly string[]).includes(value)) throw new CliError('--pronouns is he, she or they.');
  return value as Pronouns;
}

export async function setChildPronouns(db: Db, input: { child: string; pronouns: string }): Promise<void> {
  const hh = await household(db);
  const child = await childNamed(db, hh.id, input.child);
  const pronouns = pronounsOf(input.pronouns)!;
  await db.update(people).set({ pronouns }).where(eq(people.id, child.id));
  await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'child.updated', targetType: 'person', targetId: child.id, after: { pronouns } });
}

export async function addChild(db: Db, name: string, pronounsRaw?: string): Promise<string> {
  const hh = await household(db);
  const clean = name.trim();
  if (!clean) throw new CliError('Give the child a name with --name.');
  const pronouns = pronounsOf(pronounsRaw);
  const existing = await db.select({ id: people.id }).from(people).where(and(eq(people.householdId, hh.id), eq(people.role, 'child'), ilike(people.displayName, clean)));
  if (existing.length) throw new CliError(`There is already a child called ${clean}.`);
  const [row] = await db.insert(people).values({ householdId: hh.id, displayName: clean, role: 'child', ...(pronouns ? { pronouns } : {}) }).returning({ id: people.id });
  await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'child.added', targetType: 'person', targetId: row!.id, after: { name: clean, pronouns: pronouns ?? null } });
  return row!.id;
}

/** The same command as Settings, Devices, Add a device. */
export async function addDevice(db: Db, input: { child: string; label: string; type: string; ids: string[] }): Promise<{ id: string; adguardName: string }> {
  const hh = await household(db);
  const child = await childNamed(db, hh.id, input.child);
  if (!input.ids.length) throw new CliError('Give at least one --id: the device IP address, MAC address or AdGuard ClientID.');
  try {
    return await createDevice(db, { householdId: hh.id, childId: child.id, label: input.label, type: input.type, ids: input.ids, actor: { label: 'cli' } });
  } catch (err) {
    if (err instanceof SetupError) throw new CliError(err.message);
    throw err;
  }
}

/** Groups, schedules and a blocked-by-default policy per group for a child. Adds only what is missing. */
export async function setupDefaults(db: Db, childName: string): Promise<string[]> {
  const hh = await household(db);
  const child = await childNamed(db, hh.id, childName);
  const done: string[] = [];
  const groups = await ensureGroups(db, hh.id, done);
  if (!(await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.householdId, hh.id))).length) {
    for (const s of DEFAULT_SCHEDULES) {
      for (const b of s.blocks) {
        parseClock(b.start);
        parseClock(b.end);
      }
      await db.insert(schedules).values({ householdId: hh.id, name: s.name, weekdays: s.weekdays, blocks: s.blocks });
    }
    done.push(`schedules: ${DEFAULT_SCHEDULES.map((s) => s.name).join(', ')}`);
  }
  for (const [name, groupId] of groups) {
    const existing = await db.select({ id: policies.id }).from(policies).where(and(eq(policies.childId, child.id), eq(policies.groupId, groupId)));
    if (existing.length) continue;
    await db.insert(policies).values({ childId: child.id, groupId, defaultState: 'blocked' });
    done.push(`${child.name}: ${name} blocked unless planned or allowed`);
  }
  if (done.length) await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'setup.defaults', targetType: 'person', targetId: child.id, after: { done } });
  return done;
}

async function ensureGroups(db: Db, householdId: string, done: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const existing = await db.select().from(serviceGroups).where(eq(serviceGroups.householdId, householdId));
  for (const name of DEFAULT_GROUPS) {
    const found = existing.find((g) => g.name === name);
    if (found) out.set(name, found.id);
    else {
      const [row] = await db.insert(serviceGroups).values({ householdId, name }).returning({ id: serviceGroups.id });
      out.set(name, row!.id);
      done.push(`group: ${name}`);
    }
  }
  return out;
}

/** Adds the default catalogue's built-in services that AdGuard knows, with their domains, into their groups. */
export async function syncServices(db: Db, adguard: AdGuard): Promise<{ added: string[]; missing: string[] }> {
  const hh = await household(db);
  const groups = await ensureGroups(db, hh.id, []);
  const builtIns = await adguard.blockedServices();
  const added: string[] = [];
  const missing: string[] = [];
  for (const [adguardId, group] of Object.entries(DEFAULT_CATALOGUE)) {
    const b = builtIns.find((x) => x.id === adguardId);
    if (!b) {
      missing.push(adguardId);
      continue;
    }
    const domains = [...new Set(b.rules.map(ruleDomainOf).filter((d): d is string => Boolean(d)))];
    const existing = await db.select({ id: services.id }).from(services).where(and(eq(services.householdId, hh.id), eq(services.adguardId, adguardId)));
    if (existing.length) {
      await db.update(services).set({ domains }).where(eq(services.id, existing[0]!.id));
      continue;
    }
    const [row] = await db.insert(services).values({ householdId: hh.id, name: b.name, source: 'adguard', adguardId, domains, category: group }).returning({ id: services.id });
    await db.insert(serviceGroupMembers).values({ groupId: groups.get(group)!, serviceId: row!.id });
    added.push(b.name);
  }
  if (added.length) await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'services.synced', after: { added } });
  return { added, missing };
}

export async function resolveTarget(db: Db, flags: { service?: string; group?: string; everything?: boolean }): Promise<ControlTarget> {
  const hh = await household(db);
  const chosen = [flags.service, flags.group, flags.everything ? 'everything' : undefined].filter(Boolean);
  if (chosen.length !== 1) throw new CliError('Say what: --service "YouTube", --group "Games" or --everything (one of them).');
  if (flags.everything) return { kind: 'everything' };
  if (flags.service) {
    const rows = await db.select({ id: services.id }).from(services).where(and(eq(services.householdId, hh.id), ilike(services.name, flags.service.trim())));
    if (rows.length !== 1) throw new CliError(`No service called ${flags.service}. Run services-sync, or check the name.`);
    return { kind: 'service', id: rows[0]!.id };
  }
  const rows = await db.select({ id: serviceGroups.id }).from(serviceGroups).where(and(eq(serviceGroups.householdId, hh.id), ilike(serviceGroups.name, flags.group!.trim())));
  if (rows.length !== 1) throw new CliError(`No group called ${flags.group}.`);
  return { kind: 'group', id: rows[0]!.id };
}

export async function control(
  db: Db,
  input: { child: string; type: 'allow' | 'block' | 'pause' | 'normal' | 'resume'; target?: ControlTarget; duration?: string },
  now: Date,
): Promise<ChildStatus> {
  const hh = await household(db);
  const child = await childNamed(db, hh.id, input.child);
  const by = await owner(db, hh.id);
  if (input.type === 'normal') {
    await endOverrides(db, { householdId: hh.id, childId: child.id, byPersonId: by, target: input.target!, kinds: ['allow', 'block'] }, now);
  } else if (input.type === 'resume') {
    await endOverrides(db, { householdId: hh.id, childId: child.id, byPersonId: by, kinds: ['pause'] }, now);
  } else {
    const duration = input.duration ?? (input.type === 'pause' ? 'until-resume' : '');
    if (!['30m', '1h', 'until-bedtime', 'until-tomorrow', 'until-resume'].includes(duration)) {
      throw new CliError('Say how long with --for: 30m, 1h, until-bedtime or until-tomorrow.');
    }
    if (duration === 'until-resume' && input.type !== 'pause') throw new CliError('Only pause can last until you resume it.');
    await setOverride(
      db,
      {
        householdId: hh.id,
        childId: child.id,
        byPersonId: by,
        request: { target: input.target ?? { kind: 'everything' }, type: input.type, duration: duration as '30m', countsAgainstAllowance: true },
      },
      now,
    );
  }
  return childStatus(db, child.id, now);
}

export async function status(db: Db, childName: string, now: Date): Promise<ChildStatus> {
  const hh = await household(db);
  return childStatus(db, (await childNamed(db, hh.id, childName)).id, now);
}

export interface AdGuardSetupStep {
  what: string;
  from: string;
  to: string;
}

/**
 * First-time AdGuard setup and the global settings the brief asks for, applied only when the
 * owner runs this with --yes. Without it, prints the plan and changes nothing. Changes nothing on
 * the router or any device: nothing uses AdGuard until a device or the router is pointed at it.
 */
export async function adguardSetup(db: Db, adguard: AdGuard, credentials: { username: string; password: string }, apply: boolean): Promise<AdGuardSetupStep[]> {
  const hh = await household(db);
  const steps: AdGuardSetupStep[] = [];
  // Before first-time setup, AdGuard answers this without credentials; afterwards it refuses.
  const fresh = await adguard.installAddresses().then(
    () => true,
    () => false,
  );
  if (fresh) {
    steps.push({ what: 'AdGuard first-time setup', from: 'not set up', to: `admin user ${credentials.username}, DNS on port 53, admin API on the internal network only` });
    if (apply) await adguard.configure({ web: { ip: '0.0.0.0', port: 3000 }, dns: { ip: '0.0.0.0', port: 53 }, ...credentials });
  }
  const read = fresh && !apply;
  const dns = read ? {} : await adguard.dnsInfo();
  const ql = read ? undefined : await adguard.querylogConfig();
  const st = read ? undefined : await adguard.statsConfig();
  const filters = read ? [] : await adguard.filterUrls();

  const DAY = 86_400_000;
  const want = { blocked_response_ttl: 10, cache_ttl_max: 60 };
  if (dns.blocked_response_ttl !== 10 || dns.cache_ttl_max !== 60) {
    steps.push({ what: 'How long devices keep a block or an answer', from: `${dns.blocked_response_ttl ?? '?'}s blocked, ${dns.cache_ttl_max ?? '?'}s max`, to: '10s blocked, 60s max, so changes reach devices within a minute' });
    if (apply) await adguard.setDnsConfig(want);
  }
  if (!ql || ql.interval !== 7 * DAY || !ql.enabled) {
    steps.push({ what: 'Query log kept for', from: ql ? `${Math.round(ql.interval / DAY)} days` : 'default', to: '7 days (raw logs never kept longer)' });
    if (apply) {
      const current = ql ?? (await adguard.querylogConfig());
      await adguard.setQuerylogConfig({ ...current, enabled: true, interval: 7 * DAY });
    }
  }
  if (!st || st.interval !== 30 * DAY) {
    steps.push({ what: 'Statistics kept for', from: st ? `${Math.round(st.interval / DAY)} days` : 'default', to: '30 days' });
    if (apply) {
      const current = st ?? (await adguard.statsConfig());
      await adguard.setStatsConfig({ ...current, enabled: true, interval: 30 * DAY });
    }
  }
  if (!filters.includes(HAGEZI_BYPASS_LIST.url)) {
    steps.push({ what: 'Blocklist of DoH, VPN and proxy services', from: 'not subscribed', to: HAGEZI_BYPASS_LIST.name });
    if (apply) await adguard.addFilterUrl(HAGEZI_BYPASS_LIST.name, HAGEZI_BYPASS_LIST.url);
  }
  const bypass = await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, hh.id), eq(settings.key, SETTING_BYPASS_RULES)));
  if (bypass[0]?.value !== true) {
    steps.push({ what: 'Bypass rules', from: 'off', to: `${BYPASS_RULES.length - 1} rules: no iCloud Private Relay, no Firefox automatic DoH, no Apple DoH` });
    if (apply) {
      await db
        .insert(settings)
        .values({ householdId: hh.id, key: SETTING_BYPASS_RULES, value: true })
        .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value: true, updatedAt: new Date() } });
    }
  }
  if (apply && steps.length) await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'adguard.setup', after: { steps } });
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Phase 4: the economy, from the server's command line.

/** Shows the pilot phase, or sets it. Each phase switches features on without code changes. */
export async function pilotPhase(db: Db, phase?: string): Promise<{ phase: string; features: Features }> {
  const hh = await household(db);
  if (phase) {
    if (!(PILOT_PHASES as readonly string[]).includes(phase)) throw new CliError(`The pilot phase is one of: ${PILOT_PHASES.join(', ')}.`);
    await setPilotPhase(db, { householdId: hh.id, phase });
  }
  const now = (await db.select({ phase: households.pilotPhase }).from(households).where(eq(households.id, hh.id)))[0]!.phase;
  return { phase: now, features: features(now) };
}

export async function allowanceFor(db: Db, input: { child: string; minutes: number }): Promise<void> {
  const hh = await household(db);
  const child = await childNamed(db, hh.id, input.child);
  if (!Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes % 30) throw new CliError('--minutes is a whole number of 30-minute blocks, for example 420.');
  await db
    .insert(allowances)
    .values({ childId: child.id, weeklyMinutes: input.minutes })
    .onConflictDoUpdate({ target: allowances.childId, set: { weeklyMinutes: input.minutes, updatedAt: new Date() } });
  await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'allowance.set', targetType: 'person', targetId: child.id, after: { minutes: input.minutes } });
}

export async function ledgerVerify(db: Db): Promise<Verification> {
  const hh = await household(db);
  return postgresLedger(db).verify(hh.id);
}
