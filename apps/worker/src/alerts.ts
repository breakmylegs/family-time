// Alerts to parents' phones. About devices: a change AdGuard has not confirmed after three tries,
// and a device that has gone quiet. About the economy: a job to approve, a request to answer, and,
// to owners only, a ledger chain that does not check out. Each is sent once, when it happens.
import { completions, devices, households, people, requests, serviceGroups, services, settings, tasks, type Db } from '@family-time/db';
import { clockLabel } from '@family-time/domain';
import { parentsOf, pushTo, type Alert, type Send, type Vapid } from '@family-time/notify';
import { and, eq, inArray } from 'drizzle-orm';
import type { Log } from './worker.js';

/** The household setting the owner's invite wrote: the address the parent app is on. */
const SETTING_PUBLIC_ORIGIN = 'public_origin';

export type DeviceAlertKind = 'not-confirmed' | 'quiet';

export interface AlertDeps {
  db: Db;
  vapid: Vapid;
  log: Log;
  /** Injected in tests. */
  send?: Send;
}

/** The words of each alert. Deep links open Control for that child, with the help topic for "quiet". */
export function deviceAlert(kind: DeviceAlertKind, device: { label: string; childId: string }): Alert {
  const child = encodeURIComponent(device.childId);
  if (kind === 'not-confirmed') {
    return {
      title: `${device.label} hasn't picked up a change`,
      body: "Family time keeps trying every minute. Check it's on your home Wi-Fi. Tap to see what's on now.",
      path: `/?child=${child}`,
    };
  }
  return {
    title: `${device.label} has gone quiet`,
    body: "It hasn't been in touch for 30 minutes, so Family time can't block apps on it. It's usually on mobile data or another network. Tap to see what to do.",
    path: `/?child=${child}&help=device-gone-quiet`,
  };
}

/** What the alert queue carries. */
export type AlertJob =
  | { kind: DeviceAlertKind; deviceIds: string[] }
  | { kind: 'completion' | 'request'; id: string }
  | { kind: 'ledger'; householdId: string; problem: string };

async function originOf(db: Db, householdId: string): Promise<string | undefined> {
  const v = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, householdId), eq(settings.key, SETTING_PUBLIC_ORIGIN))))[0]?.value;
  return typeof v === 'string' ? v : undefined;
}

/** The words of an economy alert, from the rows it is about. Undefined when the row has gone. */
export async function familyAlert(db: Db, job: Exclude<AlertJob, { deviceIds: string[] }>): Promise<{ householdId: string; to: 'parents' | 'owners'; alert: Alert } | undefined> {
  if (job.kind === 'ledger') {
    return {
      householdId: job.householdId,
      to: 'owners',
      alert: { title: 'The points history needs a look', body: `The nightly check found a problem: ${job.problem} Run ./scripts/ft.sh ledger-verify on the server for details.`, path: '/settings' },
    };
  }
  if (job.kind === 'completion') {
    const row = (
      await db
        .select({ child: people.displayName, householdId: people.householdId, title: tasks.title })
        .from(completions)
        .innerJoin(tasks, eq(tasks.id, completions.taskId))
        .innerJoin(people, eq(people.id, completions.childId))
        .where(eq(completions.id, job.id))
    )[0];
    if (!row) return undefined;
    return { householdId: row.householdId, to: 'parents', alert: { title: `${row.child} did a job`, body: `${row.title}. Tap to approve it and send a note.`, path: '/approvals' } };
  }
  const r = (
    await db
      .select({ child: people.displayName, householdId: people.householdId, timeZone: households.timezone, req: requests })
      .from(requests)
      .innerJoin(people, eq(people.id, requests.childId))
      .innerJoin(households, eq(households.id, people.householdId))
      .where(eq(requests.id, job.id))
  )[0];
  if (!r) return undefined;
  const table = r.req.targetKind === 'service' ? services : serviceGroups;
  const name = (await db.select({ name: table.name }).from(table).where(eq(table.id, r.req.targetId)))[0]?.name ?? 'Screen time';
  const at = clockLabel(r.req.startsAt, new Date(), r.timeZone);
  return { householdId: r.householdId, to: 'parents', alert: { title: `${r.child} is asking for time`, body: `${name} at ${at} for ${r.req.minutes} minutes. Tap to answer.`, path: '/approvals' } };
}

/** Owners only, for the ledger. */
async function ownersOf(db: Db, householdId: string): Promise<string[]> {
  const rows = await db.select({ id: people.id }).from(people).where(and(eq(people.householdId, householdId), eq(people.active, true), eq(people.role, 'owner')));
  return rows.map((r) => r.id);
}

export async function sendFamilyAlert(deps: AlertDeps, job: Exclude<AlertJob, { deviceIds: string[] }>): Promise<number> {
  const made = await familyAlert(deps.db, job);
  if (!made) return 0;
  const origin = await originOf(deps.db, made.householdId);
  if (!origin) {
    deps.log('warn', 'alert_skipped', { kind: job.kind, reason: 'No public origin set. Run the owner invite first.' });
    return 0;
  }
  const to = made.to === 'owners' ? await ownersOf(deps.db, made.householdId) : await parentsOf(deps.db, made.householdId);
  const result = await pushTo({ db: deps.db, vapid: deps.vapid, origin, ...(deps.send ? { send: deps.send } : {}) }, to, made.alert);
  deps.log('info', 'alert_sent', { kind: job.kind, ...result });
  return result.sent;
}

export async function sendDeviceAlerts(deps: AlertDeps, kind: DeviceAlertKind, deviceIds: string[]): Promise<number> {
  if (!deviceIds.length) return 0;
  const { db, log } = deps;
  const rows = await db
    .select({ id: devices.id, label: devices.label, childId: devices.childId, householdId: devices.householdId })
    .from(devices)
    .innerJoin(people, eq(people.id, devices.childId))
    .where(inArray(devices.id, deviceIds));
  let sent = 0;
  for (const d of rows) {
    if (!d.childId) continue;
    const origin = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, d.householdId), eq(settings.key, SETTING_PUBLIC_ORIGIN))))[0]?.value;
    if (typeof origin !== 'string') {
      log('warn', 'alert_skipped', { kind, reason: 'No public origin set. Run the owner invite first.' });
      continue;
    }
    const result = await pushTo({ db, vapid: deps.vapid, origin, ...(deps.send ? { send: deps.send } : {}) }, await parentsOf(db, d.householdId), deviceAlert(kind, { label: d.label, childId: d.childId }));
    log('info', 'alert_sent', { kind, device: d.id, ...result });
    sent += result.sent;
  }
  return sent;
}
