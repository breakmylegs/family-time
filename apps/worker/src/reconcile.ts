// The only writer to AdGuard (ADR 0010). Every run: work out what each child's devices should block
// now, write AdGuard's clients and our rules block to match, read them back, and record whether
// AdGuard really holds it. Runs every 60 seconds and straight after any change.
import {
  AdGuard,
  BYPASS_RULES,
  blockRules,
  desiredClient,
  MarkerError,
  matches,
  newClient,
  splitRules,
  withOurRules,
  type AdGuardClientRecord,
} from '@family-time/adguard-client';
import { adguardSync, devices, households, loadRules, people, services, settings, type Db } from '@family-time/db';
import { decideAll } from '@family-time/domain';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Log } from './worker.js';

/** After this many failed confirmations in a row the device shows "Not confirmed". */
export const NOT_CONFIRMED_AFTER = 3;

export interface ReconcileDeps {
  db: Db;
  adguard: AdGuard;
  now: () => Date;
  log: Log;
}

export interface DevicePlan {
  deviceId: string;
  name: string;
  ids: string[];
  /** AdGuard built-in service ids to block. */
  blocked: string[];
  /** Our `$client` rules for custom services. */
  rules: string[];
}

export interface ReconcileResult {
  devices: number;
  confirmed: number;
  failed: number;
  rulesError?: string;
}

/** What AdGuard should hold for every managed device, from the engine. Pure apart from reads. */
/** Set by ./scripts/ft.sh adguard-setup, after the owner has approved the bypass rules. */
export const SETTING_BYPASS_RULES = 'adguard_bypass_rules';

export async function plan(db: Db, now: Date): Promise<{ timeZone: string; devices: DevicePlan[]; bypass: boolean }> {
  const household = (await db.select({ id: households.id, timeZone: households.timezone }).from(households).limit(1))[0];
  if (!household) return { timeZone: 'Europe/London', devices: [], bypass: false };
  const bypassSetting = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.householdId, household.id), eq(settings.key, SETTING_BYPASS_RULES)));
  const bypass = bypassSetting[0]?.value === true;
  const deviceRows = await db
    .select({ id: devices.id, name: devices.adguardName, ids: devices.identifiers, childId: devices.childId })
    .from(devices)
    .innerJoin(people, eq(people.id, devices.childId))
    .where(and(eq(devices.householdId, household.id), isNotNull(devices.childId), eq(people.active, true)));
  const serviceRows = await db.select().from(services).where(eq(services.householdId, household.id));
  const byId = new Map(serviceRows.map((s) => [s.id, s]));

  const decisionsByChild = new Map<string, ReturnType<typeof decideAll>>();
  const out: DevicePlan[] = [];
  for (const d of deviceRows) {
    const childId = d.childId!;
    if (!decisionsByChild.has(childId)) decisionsByChild.set(childId, decideAll(await loadRules(db, childId, now), now));
    const decisions = decisionsByChild.get(childId)!;
    const blocked: string[] = [];
    const domains: string[] = [];
    for (const [serviceId, decision] of decisions) {
      if (decision.state === 'allowed') continue;
      const s = byId.get(serviceId)!;
      if (s.source === 'adguard') blocked.push(s.adguardId!);
      else domains.push(...s.domains);
    }
    out.push({ deviceId: d.id, name: d.name, ids: d.ids, blocked: blocked.sort(), rules: domains.length ? blockRules(d.name, domains) : [] });
  }
  return { timeZone: household.timeZone, devices: out, bypass };
}

export async function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, adguard, log } = deps;
  const now = deps.now();
  const { timeZone, devices: plans, bypass } = await plan(db, now);
  if (!plans.length && !bypass) return { devices: 0, confirmed: 0, failed: 0 };

  const failures = new Map<string, string>();
  let rulesError: string | undefined;

  // 1. Our rules block, for every device's custom services at once.
  const ourRules = [...(bypass ? BYPASS_RULES : []), ...plans.flatMap((p) => p.rules)];
  try {
    const current = await adguard.userRules();
    if (JSON.stringify(splitRules(current).ours) !== JSON.stringify(ourRules)) {
      await adguard.setRules(withOurRules(current, ourRules));
    }
  } catch (err) {
    rulesError = (err as Error).message;
    log(err instanceof MarkerError ? 'error' : 'warn', 'rules_not_written', { error: rulesError });
  }

  // 2. Each device's client: add it if missing, write it if it differs.
  const wanted = new Map<string, AdGuardClientRecord>();
  let existing: AdGuardClientRecord[] = [];
  try {
    existing = await adguard.listClients();
  } catch (err) {
    for (const p of plans) failures.set(p.deviceId, `AdGuard could not be reached: ${(err as Error).message}`);
  }
  if (!failures.size) {
    for (const p of plans) {
      try {
        const current = existing.find((c) => c.name === p.name);
        if (!current) {
          const created = newClient(p.name, p.ids, p.blocked, timeZone);
          wanted.set(p.deviceId, created);
          await adguard.addClient(created);
        } else {
          const desired = { ...desiredClient(current, p.blocked, timeZone), ids: p.ids };
          wanted.set(p.deviceId, desired);
          if (!matches(current, desired)) await adguard.updateClient(p.name, desired);
        }
      } catch (err) {
        failures.set(p.deviceId, (err as Error).message);
      }
    }
  }

  // 3. Read back. Only what AdGuard holds counts as done.
  let readBack: AdGuardClientRecord[] = [];
  let rulesHeld = rulesError === undefined;
  try {
    readBack = await adguard.listClients();
    if (rulesHeld) rulesHeld = JSON.stringify(splitRules(await adguard.userRules()).ours) === JSON.stringify(ourRules);
  } catch (err) {
    for (const p of plans) if (!failures.has(p.deviceId)) failures.set(p.deviceId, `Read-back failed: ${(err as Error).message}`);
  }

  let confirmed = 0;
  for (const p of plans) {
    let problem = failures.get(p.deviceId);
    if (!problem && !matches(readBack.find((c) => c.name === p.name), wanted.get(p.deviceId)!)) problem = 'AdGuard does not hold what was written';
    if (!problem && p.rules.length && !rulesHeld) problem = rulesError ?? 'AdGuard does not hold our custom rules';
    await record(db, p, problem, now);
    if (problem) log('warn', 'device_not_confirmed', { device: p.name, problem });
    else confirmed++;
  }
  return { devices: plans.length, confirmed, failed: plans.length - confirmed, ...(rulesError ? { rulesError } : {}) };
}

async function record(db: Db, p: DevicePlan, problem: string | undefined, now: Date) {
  const applied = { blocked: p.blocked, rules: p.rules };
  const prior = (await db.select({ failures: adguardSync.failures }).from(adguardSync).where(eq(adguardSync.deviceId, p.deviceId)))[0];
  if (!problem) {
    const values = { state: 'confirmed' as const, applied, appliedAt: now, confirmedAt: now, failures: 0, lastError: null, updatedAt: now };
    await db.insert(adguardSync).values({ deviceId: p.deviceId, ...values }).onConflictDoUpdate({ target: adguardSync.deviceId, set: values });
    return;
  }
  const failuresNow = (prior?.failures ?? 0) + 1;
  const values = {
    state: failuresNow >= NOT_CONFIRMED_AFTER ? ('not-confirmed' as const) : ('pending' as const),
    applied,
    appliedAt: now,
    failures: failuresNow,
    lastError: problem.slice(0, 500),
    updatedAt: now,
  };
  await db.insert(adguardSync).values({ deviceId: p.deviceId, ...values }).onConflictDoUpdate({ target: adguardSync.deviceId, set: values });
}
