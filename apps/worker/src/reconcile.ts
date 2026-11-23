// The only writer to AdGuard (ADR 0010). Every run: work out what each child's devices should block
// now, write AdGuard's clients and our rules block to match, read them back, and record whether
// AdGuard really holds it. Runs every 60 seconds and straight after any change.
import {
  AdGuard,
  BYPASS_RULES,
  SETTING_ADGUARD_SCOPE,
  SETTING_BYPASS_RULES,
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
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
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
  /** One domain of each blocked service, to ask AdGuard whether any allow rule lets it through. */
  probes: string[];
  /** The device's IP address or ClientID, which AdGuard's check_host accepts (a MAC it does not). */
  probeClient?: string;
}

/** At most this many probes a device each run, so a long block list never floods AdGuard. */
const MAX_PROBES = 12;
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export interface ReconcileResult {
  devices: number;
  confirmed: number;
  failed: number;
  rulesError?: string;
  /** Devices that have just reached "Not confirmed", so parents get one alert, not one a minute. */
  notConfirmed?: string[];
}

/** What AdGuard should hold for every managed device, from the engine. Pure apart from reads. */
/** Set by ./scripts/ft.sh adguard-setup, after the owner has approved the bypass rules. */
export { SETTING_BYPASS_RULES };

export async function plan(db: Db, now: Date): Promise<{ timeZone: string; devices: DevicePlan[]; bypass: boolean; removed: string[]; requireMarkers: boolean }> {
  const household = (await db.select({ id: households.id, timeZone: households.timezone }).from(households).limit(1))[0];
  if (!household) return { timeZone: 'Europe/London', devices: [], bypass: false, removed: [], requireMarkers: false };
  const bypassSetting = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.householdId, household.id), eq(settings.key, SETTING_BYPASS_RULES)));
  const bypass = bypassSetting[0]?.value === true;
  // An AdGuard another setup manages (adguard-setup --family-time-only): our block only between
  // markers the owner added by hand, never added by us (ADR 0022).
  const scopeSetting = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.householdId, household.id), eq(settings.key, SETTING_ADGUARD_SCOPE)));
  const requireMarkers = scopeSetting[0]?.value === 'family-time-only';
  const deviceRows = await db
    .select({ id: devices.id, name: devices.adguardName, ids: devices.identifiers, childId: devices.childId })
    .from(devices)
    .innerJoin(people, eq(people.id, devices.childId))
    .where(and(eq(devices.householdId, household.id), isNotNull(devices.childId), isNull(devices.removedAt), eq(people.active, true)));
  // Devices removed in Settings: their AdGuard clients are taken away.
  const removed = (await db.select({ name: devices.adguardName }).from(devices).where(and(eq(devices.householdId, household.id), isNotNull(devices.removedAt)))).map((d) => d.name);
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
    const probes: string[] = [];
    for (const [serviceId, decision] of decisions) {
      if (decision.state === 'allowed') continue;
      const s = byId.get(serviceId)!;
      if (s.source === 'adguard') blocked.push(s.adguardId!);
      else domains.push(...s.domains);
      if (s.domains[0]) probes.push(s.domains[0]);
    }
    const probeClient = d.ids.find((id) => !MAC.test(id));
    out.push({
      deviceId: d.id,
      name: d.name,
      ids: d.ids,
      blocked: blocked.sort(),
      rules: domains.length ? blockRules(d.name, domains) : [],
      probes: [...new Set(probes)].sort().slice(0, MAX_PROBES),
      ...(probeClient ? { probeClient } : {}),
    });
  }
  return { timeZone: household.timeZone, devices: out, bypass, removed, requireMarkers };
}

export async function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, adguard, log } = deps;
  const now = deps.now();
  const { timeZone, devices: plans, bypass, removed, requireMarkers } = await plan(db, now);
  if (!plans.length && !bypass && !removed.length) return { devices: 0, confirmed: 0, failed: 0 };

  const failures = new Map<string, string>();
  let rulesError: string | undefined;

  // 1. Our rules block, for every device's custom services at once.
  // The bypass rules apply to every device on the network, so never on an AdGuard where the owner
  // asked Family time to manage only its own clients and rules (ADR 0022).
  const ourRules = [...(bypass && !requireMarkers ? BYPASS_RULES : []), ...plans.flatMap((p) => p.rules)];
  try {
    const current = await adguard.userRules();
    if (JSON.stringify(splitRules(current).ours) !== JSON.stringify(ourRules)) {
      await adguard.setRules(withOurRules(current, ourRules, { requireMarkers }));
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
    // Only our own clients, by name: anything else in AdGuard is never touched.
    for (const name of removed) {
      if (!/^ft-[a-z0-9]{1,60}$/.test(name) || !existing.some((c) => c.name === name)) continue;
      await adguard.deleteClient(name).catch((err: Error) => log('warn', 'client_not_removed', { device: name, error: err.message }));
    }
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
  const notConfirmed: string[] = [];
  for (const p of plans) {
    let problem = failures.get(p.deviceId);
    if (!problem && !matches(readBack.find((c) => c.name === p.name), wanted.get(p.deviceId)!)) problem = 'AdGuard does not hold what was written';
    if (!problem && p.rules.length && !rulesHeld) problem = rulesError ?? 'AdGuard does not hold our custom rules';
    if (!problem) problem = await allowedThrough(adguard, p, log);
    const failuresNow = await record(db, p, problem, now);
    if (problem) log('warn', 'device_not_confirmed', { device: p.name, problem });
    else confirmed++;
    if (failuresNow === NOT_CONFIRMED_AFTER) notConfirmed.push(p.deviceId);
  }
  return {
    devices: plans.length,
    confirmed,
    failed: plans.length - confirmed,
    ...(rulesError ? { rulesError } : {}),
    ...(notConfirmed.length ? { notConfirmed } : {}),
  };
}

/**
 * Whether an allow rule in AdGuard, outside anything Family time wrote, lets one of this device's
 * blocked services through (ADR 0022): on an AdGuard others also manage, "confirmed" must not hide
 * that. Only an explicit allow counts (NotFilteredWhiteList); any other answer, or no answer, is no
 * finding, so a quirk of AdGuard's check never marks a device wrongly.
 */
async function allowedThrough(adguard: AdGuard, p: DevicePlan, log: Log): Promise<string | undefined> {
  if (!p.probeClient) return undefined;
  for (const domain of p.probes) {
    try {
      const r = await adguard.checkHost(domain, p.probeClient);
      if (r.reason === 'NotFilteredWhiteList') {
        // Only the characters a rule has: this came from AdGuard and goes to Control.
        const rule = (r.rules?.[0]?.text ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 120);
        return `An allow rule in AdGuard lets ${domain} through for this device${rule ? ` ("${rule}")` : ''}. Family time cannot block it while that rule is there.`;
      }
    } catch (err) {
      log('debug', 'check_host_failed', { device: p.name, domain, error: (err as Error).message });
      return undefined;
    }
  }
  return undefined;
}

/** Records the outcome. Returns the failures in a row, so the caller can alert on the third. */
async function record(db: Db, p: DevicePlan, problem: string | undefined, now: Date): Promise<number> {
  const applied = { blocked: p.blocked, rules: p.rules };
  const prior = (await db.select({ failures: adguardSync.failures }).from(adguardSync).where(eq(adguardSync.deviceId, p.deviceId)))[0];
  if (!problem) {
    const values = { state: 'confirmed' as const, applied, appliedAt: now, confirmedAt: now, failures: 0, lastError: null, updatedAt: now };
    await db.insert(adguardSync).values({ deviceId: p.deviceId, ...values }).onConflictDoUpdate({ target: adguardSync.deviceId, set: values });
    return 0;
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
  return failuresNow;
}
