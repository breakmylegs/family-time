// Reads AdGuard's query log every minute. Keeps only per-minute counts per device and service, and
// when each device was last heard from. Raw log lines never leave AdGuard (Level 3 data).
import type { AdGuard, QueryLogItem } from '@family-time/adguard-client';
import { devices, households, querylogCursor, schedules, services, usageMinutes, type Db } from '@family-time/db';
import { activeBlocks, type Schedule, type ScheduleBlock } from '@family-time/domain';
import { eq, sql } from 'drizzle-orm';
import type { Log } from './worker.js';

/** A device silent this long outside bedtime is marked quiet: mobile data, a VPN, or other DNS. */
export const QUIET_AFTER_MS = 30 * 60_000;
const PAGE = 500;
const MAX_PAGES = 10;

export interface UsageDeps {
  db: Db;
  adguard: AdGuard;
  now: () => Date;
  log: Log;
}

/** Kept for the tests' sake: the parser lives in the AdGuard client package. */
export { ruleDomainOf as ruleDomain } from '@family-time/adguard-client';

/** The service whose domain is the queried name or one of its parents. Most specific wins. */
export function serviceFor(name: string, domains: Map<string, string>): string | undefined {
  const labels = name.toLowerCase().replace(/\.$/, '').split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const hit = domains.get(labels.slice(i).join('.'));
    if (hit) return hit;
  }
  return undefined;
}

export async function readUsage(deps: UsageDeps): Promise<{ read: number; minutes: number; quiet: string[] }> {
  const { db, adguard, log } = deps;
  const now = deps.now();
  const deviceRows = await db.select({ id: devices.id, name: devices.adguardName, ids: devices.identifiers }).from(devices);
  if (!deviceRows.length) return { read: 0, minutes: 0, quiet: [] };
  const serviceRows = await db.select({ id: services.id, domains: services.domains }).from(services);
  const domainToService = new Map<string, string>();
  for (const s of serviceRows) for (const d of s.domains) domainToService.set(d.toLowerCase(), s.id);

  const cursor = (await db.select({ readUntil: querylogCursor.readUntil }).from(querylogCursor))[0]?.readUntil;
  // First run: take what the log already holds (up to MAX_PAGES), so the baseline weeks start
  // with everything AdGuard saw, not from the moment the job first ran.
  const since = cursor ?? new Date(0);

  // Newest first; page back until we pass the cursor.
  const fresh: QueryLogItem[] = [];
  let olderThan: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const log_ = await adguard.querylog({ limit: PAGE, ...(olderThan ? { olderThan } : {}) });
    const items = log_.data.filter((q) => new Date(q.time) > since);
    fresh.push(...items);
    if (items.length < log_.data.length || log_.data.length < PAGE || !log_.oldest) break;
    olderThan = log_.oldest;
  }

  const deviceFor = (q: QueryLogItem) =>
    deviceRows.find((d) => d.name === q.client_info?.name) ?? deviceRows.find((d) => d.ids.includes(q.client) || (q.client_id && d.ids.includes(q.client_id)));

  const counts = new Map<string, { deviceId: string; serviceId: string; minute: Date; queries: number }>();
  const lastSeen = new Map<string, Date>();
  let newest = since;
  for (const q of fresh) {
    const t = new Date(q.time);
    if (t > newest) newest = t;
    const device = deviceFor(q);
    if (!device) continue;
    if (!lastSeen.has(device.id) || t > lastSeen.get(device.id)!) lastSeen.set(device.id, t);
    const serviceId = serviceFor(q.question.name, domainToService);
    if (!serviceId) continue;
    const minute = new Date(Math.floor(t.getTime() / 60_000) * 60_000);
    const key = `${device.id}|${serviceId}|${minute.getTime()}`;
    const c = counts.get(key) ?? { deviceId: device.id, serviceId, minute, queries: 0 };
    c.queries = Math.min(c.queries + 1, 32_000);
    counts.set(key, c);
  }

  for (const c of counts.values()) {
    await db
      .insert(usageMinutes)
      .values(c)
      .onConflictDoUpdate({
        target: [usageMinutes.deviceId, usageMinutes.serviceId, usageMinutes.minute],
        set: { queries: sql`least(${usageMinutes.queries} + ${c.queries}, 32000)` },
      });
  }
  for (const [deviceId, t] of lastSeen) {
    await db.update(devices).set({ lastSeenAt: sql`greatest(coalesce(${devices.lastSeenAt}, ${t}), ${t})`, quietSince: null }).where(eq(devices.id, deviceId));
  }
  await db
    .insert(querylogCursor)
    .values({ id: 1, readUntil: newest })
    .onConflictDoUpdate({ target: querylogCursor.id, set: { readUntil: newest } });

  const quiet = await markQuiet(db, now, log);
  return { read: fresh.length, minutes: counts.size, quiet };
}

/** Marks a child's device quiet after 30 silent minutes, unless it is the child's bedtime. */
export async function markQuiet(db: Db, now: Date, log?: Log): Promise<string[]> {
  const household = (await db.select({ id: households.id, timeZone: households.timezone }).from(households).limit(1))[0];
  if (!household) return [];
  const scheduleRows = await db.select().from(schedules).where(eq(schedules.householdId, household.id));
  const all: Schedule[] = scheduleRows.map((s) => ({ id: s.id, name: s.name, childId: s.childId, weekdays: s.weekdays, blocks: s.blocks as ScheduleBlock[] }));
  const rows = await db.select().from(devices).where(eq(devices.householdId, household.id));
  const quiet: string[] = [];
  for (const d of rows) {
    if (!d.childId || d.quietSince) continue;
    const silentSince = d.lastSeenAt ?? d.createdAt;
    if (now.getTime() - silentSince.getTime() < QUIET_AFTER_MS) continue;
    if (activeBlocks(all, d.childId, now, household.timeZone).some((b) => b.type === 'bed')) continue;
    await db.update(devices).set({ quietSince: now }).where(eq(devices.id, d.id));
    quiet.push(d.id);
    log?.('warn', 'device_quiet', { device: d.adguardName, silentSince: silentSince.toISOString() });
  }
  return quiet;
}

/** Minutes in a window in which a device made at least `threshold` queries to a service. "About 25 min". */
export function estimateMinutes(rows: { queries: number }[], threshold = 3): number {
  return rows.filter((r) => r.queries >= threshold).length;
}
