// Settings editors (Phase 9, brief Part 9): devices, groups and each child's rule for them, and the
// schedules. The command line's `device-add` uses the same functions. Nothing here talks to
// AdGuard: the reconciler (the only writer) picks every change up within a minute, or at once when
// the route wakes it.
import { randomUUID } from 'node:crypto';
import { BlockList, isIP, isIPv4 } from 'node:net';
import { adguardSync, devices, people, policies, schedules, serviceGroupMembers, serviceGroups, services, type Db } from '@family-time/db';
import { parseClock, type ScheduleBlock } from '@family-time/domain';
import type { SetupView } from '@family-time/schemas';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { audit, type AuditEntry } from '../audit.js';

export class SetupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Actor = AuditEntry['actor'];

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const CLIENT_ID = /^[a-z0-9-]{1,63}$/i;
/** The widest range one device may have: a /24 is a whole home network's worth already. */
const WIDEST_RANGE = 24;

/**
 * An IP address, a range no wider than /24, a MAC address, or an AdGuard ClientID. Anything wider
 * would put a child's blocks on every device at home, parents' phones and the kiosk included.
 */
export function isIdentifier(id: string): boolean {
  if (MAC.test(id)) return true;
  const [addr, bits, extra] = id.split('/');
  if (extra === undefined && addr && isIP(addr)) {
    if (bits === undefined) return true;
    if (!/^\d{1,3}$/.test(bits)) return false;
    const n = Number(bits);
    return isIPv4(addr) ? n >= WIDEST_RANGE && n <= 32 : n >= 120 && n <= 128;
  }
  // A ClientID is a name, never something that looks like a number or an address.
  return CLIENT_ID.test(id) && !/^[\d.]+$/.test(id);
}

/** Whether one identifier is or contains the other: a range holding another device's address. */
function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const range = (x: string) => {
    const [addr, bits] = x.split('/');
    if (!addr || !isIP(addr)) return null;
    const list = new BlockList();
    const type = isIPv4(addr) ? 'ipv4' : 'ipv6';
    if (bits) list.addSubnet(addr, Number(bits), type);
    else list.addAddress(addr, type);
    return { list, addr, type } as const;
  };
  const ra = range(a);
  const rb = range(b);
  if (!ra || !rb || ra.type !== rb.type) return false;
  return ra.list.check(rb.addr, rb.type) || rb.list.check(ra.addr, ra.type);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The parts of the day as the Set-up screen names them. */
const BLOCK_WORDS: Record<ScheduleBlock['type'], string> = { school: 'School', pause: 'A pause', 'wind-down': 'Wind-down', bed: 'Bedtime', free: 'Free time' };

async function child(db: Db, householdId: string, childId: string) {
  const c = (
    await db
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(and(eq(people.id, childId), eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)))
  )[0];
  if (!c) throw new SetupError('not_found', "Family time can't find that child. Reload to see who's in your family now.", 404);
  return c;
}

export async function setupView(db: Db, householdId: string): Promise<SetupView> {
  const kids = await db
    .select({ id: people.id, name: people.displayName })
    .from(people)
    .where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)))
    .orderBy(asc(people.displayName));
  const deviceRows = await db
    .select({ id: devices.id, label: devices.label, type: devices.type, childId: devices.childId, identifiers: devices.identifiers, state: adguardSync.state })
    .from(devices)
    .leftJoin(adguardSync, eq(adguardSync.deviceId, devices.id))
    .where(and(eq(devices.householdId, householdId), isNull(devices.removedAt)))
    .orderBy(asc(devices.label));
  const groupRows = await db.select({ id: serviceGroups.id, name: serviceGroups.name }).from(serviceGroups).where(eq(serviceGroups.householdId, householdId)).orderBy(asc(serviceGroups.name));
  const serviceRows = await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.householdId, householdId)).orderBy(asc(services.name));
  const members = await db.select().from(serviceGroupMembers).innerJoin(serviceGroups, eq(serviceGroups.id, serviceGroupMembers.groupId)).where(eq(serviceGroups.householdId, householdId));
  const inGroup = new Set(members.map((m) => m.service_group_members.serviceId));
  const policyRows = await db
    .select({ childId: policies.childId, groupId: policies.groupId, defaultState: policies.defaultState, allowedDuringWindDown: policies.allowedDuringWindDown, alwaysAllowed: policies.alwaysAllowed })
    .from(policies)
    .innerJoin(people, eq(people.id, policies.childId))
    .where(and(eq(people.householdId, householdId), eq(people.active, true)));
  const scheduleRows = await db.select().from(schedules).where(eq(schedules.householdId, householdId)).orderBy(asc(schedules.createdAt));
  return {
    children: kids,
    devices: deviceRows.map((d) => ({ id: d.id, label: d.label, type: d.type, childId: d.childId, identifiers: d.identifiers, sync: d.state ?? 'never' })),
    groups: groupRows.map((g) => ({ ...g, services: serviceRows.filter((s) => members.some((m) => m.service_group_members.groupId === g.id && m.service_group_members.serviceId === s.id)) })),
    ungrouped: serviceRows.filter((s) => !inGroup.has(s.id)),
    policies: policyRows.filter((p): p is typeof p & { groupId: string } => p.groupId !== null),
    schedules: scheduleRows.map((s) => ({ id: s.id, name: s.name, childId: s.childId, weekdays: s.weekdays, blocks: s.blocks as ScheduleBlock[] })),
  };
}

// ---- Devices

function cleanIds(ids: string[]): string[] {
  if (!ids.length) throw new SetupError('invalid', 'Give at least one address, like 192.168.1.50.');
  for (const id of ids) if (!isIdentifier(id)) throw new SetupError('invalid', `"${id}" doesn't look like an address. Copy it from your router's list, like 192.168.1.50 or a4:83:e7:12:34:56.`);
  return [...new Set(ids.map((x) => x.toLowerCase()))];
}

/** Another device in this family already answering to one of these, which AdGuard would refuse. */
async function clash(db: Db, householdId: string, ids: string[], except?: string) {
  const rows = await db
    .select({ label: devices.label, identifiers: devices.identifiers })
    .from(devices)
    .where(and(eq(devices.householdId, householdId), isNull(devices.removedAt), except ? ne(devices.id, except) : undefined));
  for (const r of rows) {
    const shared = r.identifiers.find((x) => ids.some((y) => overlaps(x, y)));
    if (shared) throw new SetupError('in_use', `${r.label} already uses ${shared}. Each address belongs to one device.`, 409);
  }
}

export async function createDevice(db: Db, input: { householdId: string; childId: string; label: string; type: string; ids: string[]; actor: Actor }) {
  const c = await child(db, input.householdId, input.childId);
  const ids = cleanIds(input.ids);
  await clash(db, input.householdId, ids);
  const id = randomUUID();
  const adguardName = `ft-${id.replace(/-/g, '').slice(0, 12)}`;
  await db.insert(devices).values({ id, householdId: input.householdId, childId: c.id, label: input.label.trim(), type: input.type, adguardName, identifiers: ids });
  await audit(db, { householdId: input.householdId, actor: input.actor, action: 'device.added', targetType: 'device', targetId: id, after: { child: c.name, label: input.label.trim(), ids } });
  return { id, adguardName };
}

async function device(db: Db, householdId: string, id: string) {
  const d = (await db.select().from(devices).where(and(eq(devices.id, id), eq(devices.householdId, householdId), isNull(devices.removedAt))))[0];
  if (!d) throw new SetupError('not_found', "That device isn't in this family any more. Reload to see the list now.", 404);
  return d;
}

export async function updateDevice(db: Db, input: { householdId: string; deviceId: string; childId: string; label: string; type: string; ids: string[]; actor: Actor }) {
  const before = await device(db, input.householdId, input.deviceId);
  const c = await child(db, input.householdId, input.childId);
  const ids = cleanIds(input.ids);
  await clash(db, input.householdId, ids, before.id);
  await db.update(devices).set({ childId: c.id, label: input.label.trim(), type: input.type, identifiers: ids }).where(eq(devices.id, before.id));
  await audit(db, {
    householdId: input.householdId,
    actor: input.actor,
    action: 'device.changed',
    targetType: 'device',
    targetId: before.id,
    before: { childId: before.childId, label: before.label, type: before.type, ids: before.identifiers },
    after: { child: c.name, label: input.label.trim(), type: input.type, ids },
  });
}

/** Kept for its usage history; the reconciler takes its AdGuard client away. */
export async function removeDevice(db: Db, input: { householdId: string; deviceId: string; actor: Actor }, now: Date) {
  const d = await device(db, input.householdId, input.deviceId);
  await db.update(devices).set({ removedAt: now }).where(eq(devices.id, d.id));
  await audit(db, { householdId: input.householdId, actor: input.actor, action: 'device.removed', targetType: 'device', targetId: d.id, before: { label: d.label, ids: d.identifiers } });
}

// ---- Groups and each child's rule for them

async function group(db: Db, householdId: string, id: string) {
  const g = (await db.select().from(serviceGroups).where(and(eq(serviceGroups.id, id), eq(serviceGroups.householdId, householdId))))[0];
  if (!g) throw new SetupError('not_found', "That group isn't in this family. Reload to see the groups now.", 404);
  return g;
}

export async function setGroupPolicy(
  db: Db,
  input: { householdId: string; childId: string; groupId: string; defaultState: 'blocked' | 'allowed'; allowedDuringWindDown: boolean; alwaysAllowed: boolean; actor: Actor },
) {
  const c = await child(db, input.householdId, input.childId);
  const g = await group(db, input.householdId, input.groupId);
  const values = { defaultState: input.defaultState, allowedDuringWindDown: input.allowedDuringWindDown, alwaysAllowed: input.alwaysAllowed };
  const existing = (await db.select().from(policies).where(and(eq(policies.childId, c.id), eq(policies.groupId, g.id))))[0];
  if (existing) await db.update(policies).set(values).where(eq(policies.id, existing.id));
  else await db.insert(policies).values({ childId: c.id, groupId: g.id, ...values });
  await audit(db, {
    householdId: input.householdId,
    actor: input.actor,
    action: 'policy.changed',
    targetType: 'group',
    targetId: g.id,
    before: existing ? { defaultState: existing.defaultState, allowedDuringWindDown: existing.allowedDuringWindDown, alwaysAllowed: existing.alwaysAllowed } : null,
    after: { child: c.name, group: g.name, ...values },
  });
}

/** Moves an app into one group (or none). An app is in at most one group from this screen. */
export async function setServiceGroup(db: Db, input: { householdId: string; serviceId: string; groupId: string | null; actor: Actor }) {
  const s = (await db.select().from(services).where(and(eq(services.id, input.serviceId), eq(services.householdId, input.householdId))))[0];
  if (!s) throw new SetupError('not_found', "That app isn't in this family. Reload to see the apps now.", 404);
  const g = input.groupId ? await group(db, input.householdId, input.groupId) : null;
  await db.delete(serviceGroupMembers).where(eq(serviceGroupMembers.serviceId, s.id));
  if (g) await db.insert(serviceGroupMembers).values({ groupId: g.id, serviceId: s.id });
  await audit(db, { householdId: input.householdId, actor: input.actor, action: 'service.group', targetType: 'service', targetId: s.id, after: { service: s.name, group: g?.name ?? null } });
}

// ---- Schedules

export interface ScheduleInput {
  name: string;
  childId: string | null;
  weekdays: number[];
  blocks: (Omit<ScheduleBlock, 'label'> & { label?: string | undefined })[];
}

async function checkSchedule(db: Db, householdId: string, s: ScheduleInput, except?: string) {
  if (s.childId) await child(db, householdId, s.childId);
  const days = [...new Set(s.weekdays)].sort();
  for (const b of s.blocks) {
    parseClock(b.start);
    parseClock(b.end);
    if (b.start === b.end) throw new SetupError('invalid', `${BLOCK_WORDS[b.type]} can't start and end at ${b.start}. Change one of the times.`);
  }
  if (s.blocks.filter((b) => b.type === 'bed').length > 1) throw new SetupError('invalid', 'One bedtime a day is enough. Remove the extra one.');
  // One schedule a day for each child (or for the household): the engine would take only the first.
  const others = await db.select().from(schedules).where(and(eq(schedules.householdId, householdId), s.childId ? eq(schedules.childId, s.childId) : isNull(schedules.childId), except ? ne(schedules.id, except) : undefined));
  for (const o of others) {
    const shared = days.find((d) => o.weekdays.includes(d));
    if (shared !== undefined) throw new SetupError('in_use', `${o.name} already covers ${DAY_NAMES[shared]}. Take ${DAY_NAMES[shared]} off one of them first.`, 409);
  }
  return days;
}

const cleanBlocks = (blocks: ScheduleInput['blocks']): ScheduleBlock[] => blocks.map((b) => ({ type: b.type, start: b.start, end: b.end, ...(b.label?.trim() ? { label: b.label.trim() } : {}) }));

export async function createSchedule(db: Db, input: { householdId: string; schedule: ScheduleInput; actor: Actor }) {
  const days = await checkSchedule(db, input.householdId, input.schedule);
  const [row] = await db
    .insert(schedules)
    .values({ householdId: input.householdId, childId: input.schedule.childId, name: input.schedule.name.trim(), weekdays: days, blocks: cleanBlocks(input.schedule.blocks) })
    .returning({ id: schedules.id });
  await audit(db, { householdId: input.householdId, actor: input.actor, action: 'schedule.added', targetType: 'schedule', targetId: row!.id, after: { ...input.schedule, weekdays: days } });
  return { id: row!.id };
}

async function scheduleRow(db: Db, householdId: string, id: string) {
  const s = (await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.householdId, householdId))))[0];
  if (!s) throw new SetupError('not_found', "That schedule isn't there any more. Reload to see the schedules now.", 404);
  return s;
}

export async function updateSchedule(db: Db, input: { householdId: string; scheduleId: string; schedule: ScheduleInput; actor: Actor }) {
  const before = await scheduleRow(db, input.householdId, input.scheduleId);
  const days = await checkSchedule(db, input.householdId, input.schedule, before.id);
  const blocks = cleanBlocks(input.schedule.blocks);
  await db.update(schedules).set({ name: input.schedule.name.trim(), childId: input.schedule.childId, weekdays: days, blocks }).where(eq(schedules.id, before.id));
  await audit(db, {
    householdId: input.householdId,
    actor: input.actor,
    action: 'schedule.changed',
    targetType: 'schedule',
    targetId: before.id,
    before: { name: before.name, childId: before.childId, weekdays: before.weekdays, blocks: before.blocks },
    after: { name: input.schedule.name.trim(), childId: input.schedule.childId, weekdays: days, blocks },
  });
}

export async function removeSchedule(db: Db, input: { householdId: string; scheduleId: string; actor: Actor }) {
  const before = await scheduleRow(db, input.householdId, input.scheduleId);
  await db.delete(schedules).where(eq(schedules.id, before.id));
  await audit(db, { householdId: input.householdId, actor: input.actor, action: 'schedule.removed', targetType: 'schedule', targetId: before.id, before: { name: before.name, weekdays: before.weekdays, blocks: before.blocks } });
}
