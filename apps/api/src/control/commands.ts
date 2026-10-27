// Control actions, shared by the api routes and the server's command line, so the two can never
// apply a rule differently. They write our own tables only. AdGuard is written by the reconciler,
// which `notifyChange` wakes straight away (ADR 0010).
import { adguardSync, devices, loadRules, overrides, people, serviceGroups, services, usageMinutes, type Db } from '@family-time/db';
import { civilDate, decideAll, overrideWindow, zonedTime } from '@family-time/domain';
import type { ChildStatus, ControlTarget, DeviceStatus, OverrideRequest, ServiceStatus } from '@family-time/schemas';
import { and, eq, gt, gte, inArray, isNull, or } from 'drizzle-orm';
import { audit } from '../audit.js';

export class ControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** "About 25 min": a minute counts when a device made at least this many queries to the service. */
const BUSY_MINUTE_QUERIES = 3;

export async function findChild(db: Db, householdId: string, childId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(childId)) return undefined;
  const rows = await db
    .select({ id: people.id, name: people.displayName })
    .from(people)
    .where(and(eq(people.id, childId), eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)));
  return rows[0];
}

async function checkTarget(db: Db, householdId: string, target: ControlTarget) {
  if (target.kind === 'everything') return;
  const table = target.kind === 'service' ? services : serviceGroups;
  const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.id, target.id), eq(table.householdId, householdId)));
  if (!rows.length) throw new ControlError('unknown_target', `That ${target.kind} is not in this family's list.`);
}

/** Allow, Block or Pause for a while. Returns when it ends. */
export async function setOverride(
  db: Db,
  input: { householdId: string; childId: string; byPersonId: string; request: OverrideRequest; ip?: string },
  now: Date,
): Promise<{ id: string; endsAt: Date | null }> {
  const { request } = input;
  await checkTarget(db, input.householdId, request.target);
  let endsAt: Date | null = null;
  let overridesBedtime = false;
  if (request.duration !== 'until-resume') {
    const rules = await loadRules(db, input.childId, now);
    const w = overrideWindow(request.duration, now, rules.schedules, input.childId, rules.timeZone);
    endsAt = w.end;
    overridesBedtime = request.type === 'allow' && w.overridesBedtime;
  }
  const rows = await db
    .insert(overrides)
    .values({
      householdId: input.householdId,
      childId: input.childId,
      targetKind: request.target.kind,
      targetId: request.target.kind === 'everything' ? null : request.target.id,
      type: request.type,
      startsAt: now,
      endsAt,
      overridesBedtime,
      countsAgainstAllowance: request.type === 'allow' ? request.countsAgainstAllowance : false,
      createdBy: input.byPersonId,
      createdAt: now,
    })
    .returning({ id: overrides.id });
  const id = rows[0]!.id;
  await audit(db, {
    householdId: input.householdId,
    actor: { personId: input.byPersonId },
    action: `control.${request.type}`,
    targetType: 'override',
    targetId: id,
    after: { childId: input.childId, target: request.target, duration: request.duration, endsAt: endsAt?.toISOString() ?? null },
    ...(input.ip ? { ip: input.ip } : {}),
  });
  return { id, endsAt };
}

/** Ends live overrides early. `kinds` picks Allow and Block (Normal) or Pause (Resume). */
export async function endOverrides(
  db: Db,
  input: { householdId: string; childId: string; byPersonId: string; target?: ControlTarget; kinds: ('allow' | 'block' | 'pause')[]; ip?: string },
  now: Date,
): Promise<number> {
  const conditions = [
    eq(overrides.childId, input.childId),
    inArray(overrides.type, input.kinds),
    or(isNull(overrides.endsAt), gt(overrides.endsAt, now)),
  ];
  if (input.target) {
    conditions.push(eq(overrides.targetKind, input.target.kind));
    if (input.target.kind !== 'everything') conditions.push(eq(overrides.targetId, input.target.id));
  }
  const rows = await db
    .update(overrides)
    .set({ endsAt: now, endedBy: input.byPersonId })
    .where(and(...conditions))
    .returning({ id: overrides.id });
  if (rows.length) {
    await audit(db, {
      householdId: input.householdId,
      actor: { personId: input.byPersonId },
      action: input.kinds.includes('pause') ? 'control.resume' : 'control.normal',
      targetType: 'child',
      targetId: input.childId,
      after: { ended: rows.map((r) => r.id), target: input.target ?? null },
      ...(input.ip ? { ip: input.ip } : {}),
    });
  }
  return rows.length;
}

/** Everything the Control screen shows for one child. */
export async function childStatus(db: Db, childId: string, now: Date): Promise<ChildStatus> {
  const rules = await loadRules(db, childId, now);
  const decisions = decideAll(rules, now);
  const serviceIds = rules.services.map((s) => s.id);
  const serviceRows = serviceIds.length
    ? await db
        .select({ id: services.id, name: services.name, icon: services.icon, adguardId: services.adguardId, source: services.source, domains: services.domains })
        .from(services)
        .where(inArray(services.id, serviceIds))
    : [];
  const deviceRows = await db
    .select({
      id: devices.id,
      label: devices.label,
      type: devices.type,
      lastSeenAt: devices.lastSeenAt,
      quietSince: devices.quietSince,
      sync: adguardSync.state,
      applied: adguardSync.applied,
      confirmedAt: adguardSync.confirmedAt,
    })
    .from(devices)
    .leftJoin(adguardSync, eq(adguardSync.deviceId, devices.id))
    .where(eq(devices.childId, childId));

  const today = civilDate(now, rules.timeZone);
  const midnight = zonedTime(today.year, today.month, today.day, 0, rules.timeZone);
  const usage = deviceRows.length
    ? await db
        .select({ serviceId: usageMinutes.serviceId, minute: usageMinutes.minute, queries: usageMinutes.queries })
        .from(usageMinutes)
        .where(and(inArray(usageMinutes.deviceId, deviceRows.map((d) => d.id)), gte(usageMinutes.minute, midnight), gte(usageMinutes.queries, BUSY_MINUTE_QUERIES)))
    : [];
  const minutesBy = new Map<string, Set<number>>();
  for (const u of usage) {
    const set = minutesBy.get(u.serviceId) ?? new Set<number>();
    set.add(u.minute.getTime()); // a minute busy on two devices is still one minute
    minutesBy.set(u.serviceId, set);
  }

  const servicesOut: ServiceStatus[] = serviceRows
    .map((s) => {
      const d = decisions.get(s.id)!;
      const wantBlocked = d.state !== 'allowed';
      // In force: every device has confirmed AdGuard holds this state for the service. A custom
      // service counts as blocked when its first domain's rule is in the block written.
      const firstRule = s.domains[0] ? `||${s.domains[0].toLowerCase()}^` : undefined;
      const inForce =
        deviceRows.length > 0 &&
        deviceRows.every((dev) => {
          if (dev.sync !== 'confirmed' || !dev.applied) return false;
          const applied = dev.applied as { blocked: string[]; rules: string[] };
          const blocked = s.source === 'adguard' ? applied.blocked.includes(s.adguardId!) : Boolean(firstRule && applied.rules.some((r) => r.startsWith(firstRule)));
          return blocked === wantBlocked;
        });
      return {
        id: s.id,
        name: s.name,
        icon: s.icon,
        state: d.state,
        layer: d.layer,
        reason: d.reason,
        until: d.until?.toISOString() ?? null,
        inForce,
        usageMinutesToday: minutesBy.get(s.id)?.size ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const devicesOut: DeviceStatus[] = deviceRows.map((d) => ({
    id: d.id,
    label: d.label,
    type: d.type,
    sync: d.sync ?? 'never',
    confirmedAt: d.confirmedAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    quietSince: d.quietSince?.toISOString() ?? null,
  }));

  return { child: { id: childId, name: rules.childName }, at: now.toISOString(), services: servicesOut, devices: devicesOut };
}
