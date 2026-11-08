// Loads a child's rules from the database in the engine's shape. The api's status route and the
// worker's reconciler both use this one loader, so the two can never read the rules differently.
import { features, type Grant, type Override, type Policy, type Rules, type Schedule, type ScheduleBlock, type Service } from '@family-time/domain';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { grants, households, overrides, people, policies, schedules, serviceGroupMembers, services, settings } from './schema.js';
import type { Db } from './types.js';

/** Minutes to reach a natural stopping point, unless the household set its own (0 turns it off). */
export const DEFAULT_STOPPING_POINT_MINUTES = 5;
export const SETTING_STOPPING_POINT = 'stopping_point_minutes';

/** Overrides and grants that ended more than this long ago cannot affect now or the next two days. */
const LOOKBACK_MS = 2 * 24 * 3_600_000;

export async function loadRules(db: Db, childId: string, now: Date): Promise<Rules> {
  const child = (
    await db
      .select({ id: people.id, name: people.displayName, householdId: people.householdId, timeZone: households.timezone, pilotPhase: households.pilotPhase })
      .from(people)
      .innerJoin(households, eq(households.id, people.householdId))
      .where(and(eq(people.id, childId), eq(people.role, 'child'), eq(people.active, true)))
  )[0];
  if (!child) throw new Error(`No active child ${childId}`);

  const since = new Date(now.getTime() - LOOKBACK_MS);
  const [serviceRows, memberRows, policyRows, scheduleRows, overrideRows, grantRows] = await Promise.all([
    db.select({ id: services.id, name: services.name }).from(services).where(eq(services.householdId, child.householdId)),
    db
      .select({ serviceId: serviceGroupMembers.serviceId, groupId: serviceGroupMembers.groupId })
      .from(serviceGroupMembers)
      .innerJoin(services, eq(services.id, serviceGroupMembers.serviceId))
      .where(eq(services.householdId, child.householdId)),
    db.select().from(policies).where(eq(policies.childId, childId)),
    db
      .select()
      .from(schedules)
      .where(and(eq(schedules.householdId, child.householdId), or(isNull(schedules.childId), eq(schedules.childId, childId)))),
    db
      .select({
        id: overrides.id,
        targetKind: overrides.targetKind,
        targetId: overrides.targetId,
        type: overrides.type,
        startsAt: overrides.startsAt,
        endsAt: overrides.endsAt,
        overridesBedtime: overrides.overridesBedtime,
        endedBy: overrides.endedBy,
        createdByName: people.displayName,
      })
      .from(overrides)
      .innerJoin(people, eq(people.id, overrides.createdBy))
      .where(and(eq(overrides.childId, childId), or(isNull(overrides.endsAt), gt(overrides.endsAt, since)))),
    db
      .select()
      .from(grants)
      .where(and(eq(grants.childId, childId), gt(grants.endsAt, since), inArray(grants.status, ['scheduled', 'active', 'paused', 'ended']))),
  ]);

  const groupsOf = new Map<string, string[]>();
  for (const m of memberRows) groupsOf.set(m.serviceId, [...(groupsOf.get(m.serviceId) ?? []), m.groupId]);

  const svc: Service[] = serviceRows.map((s) => ({ id: s.id, name: s.name, groupIds: groupsOf.get(s.id) ?? [] }));
  const pol: Policy[] = policyRows.map((p) => ({
    childId: p.childId,
    target: p.serviceId ? { kind: 'service', id: p.serviceId } : { kind: 'group', id: p.groupId! },
    default: p.defaultState,
    alwaysAllowed: p.alwaysAllowed,
    allowedDuringWindDown: p.allowedDuringWindDown,
  }));
  const sch: Schedule[] = scheduleRows.map((s) => ({
    id: s.id,
    name: s.name,
    childId: s.childId,
    weekdays: s.weekdays,
    blocks: s.blocks as ScheduleBlock[],
  }));
  const ovr: Override[] = overrideRows.map((o) => ({
    id: o.id,
    childId,
    target: o.targetKind === 'everything' ? { kind: 'everything' } : { kind: o.targetKind, id: o.targetId! },
    type: o.type,
    start: o.startsAt,
    end: o.endsAt,
    createdByName: o.createdByName,
    overridesBedtime: o.overridesBedtime,
    endedEarly: o.endedBy !== null,
  }));
  const grn: Grant[] = grantRows.map((g) => ({
    id: g.id,
    childId,
    target: { kind: g.targetKind, id: g.targetId },
    start: g.startsAt,
    end: g.endsAt,
    source: g.source,
    status: g.status,
  }));

  // Stopping points are part of the pilot's transitions phase (brief Part 14).
  let stoppingPointMinutes = 0;
  if (features(child.pilotPhase).transitions) {
    const set = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, child.householdId), eq(settings.key, SETTING_STOPPING_POINT))))[0]?.value;
    stoppingPointMinutes = typeof set === 'number' && set >= 0 && set <= 15 ? set : DEFAULT_STOPPING_POINT_MINUTES;
  }

  return { timeZone: child.timeZone, childName: child.name, childId, services: svc, policies: pol, schedules: sch, overrides: ovr, grants: grn, stoppingPointMinutes };
}
