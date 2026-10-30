// Alerts to parents' phones about devices. Two in this phase: a change AdGuard has not confirmed
// after three tries, and a device that has gone quiet (mobile data, a VPN or other DNS). Each is
// sent once when it happens, never every minute while it lasts.
import { devices, people, settings, type Db } from '@family-time/db';
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
      title: `Not confirmed on ${device.label}`,
      body: 'The last change has not been confirmed yet. Family time keeps trying every minute. Open Control to see what is on now.',
      path: `/?child=${child}`,
    };
  }
  return {
    title: `${device.label} has gone quiet`,
    body: 'It has not used home Wi-Fi for 30 minutes. That usually means mobile data, a VPN or other DNS.',
    path: `/?child=${child}&help=device-gone-quiet`,
  };
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
