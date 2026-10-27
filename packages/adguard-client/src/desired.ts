import type { AdGuardClientRecord } from './client.js';

/**
 * The client record we want: the current one with our fields set. AdGuard replaces the whole
 * client on update, so everything we do not own is copied across unchanged.
 *
 * - `use_global_blocked_services: false`, so this device follows its own list, not the global one.
 * - `blocked_services`: exactly the built-in services blocked or paused now, sorted.
 * - `blocked_services_schedule` with no days: AdGuard's schedule says when blocking is *paused*,
 *   and we decide timing ourselves, so it must never pause anything.
 */
export function desiredClient(current: AdGuardClientRecord, blocked: string[], timeZone: string): AdGuardClientRecord {
  return {
    ...current,
    use_global_blocked_services: false,
    blocked_services: [...new Set(blocked)].sort(),
    blocked_services_schedule: { time_zone: timeZone },
  };
}

/** A new persistent client for a device. Everything else follows AdGuard's global settings. */
export function newClient(name: string, ids: string[], blocked: string[], timeZone: string): AdGuardClientRecord {
  return desiredClient({ name, ids, use_global_settings: true, filtering_enabled: true, tags: [] }, blocked, timeZone);
}

/** True when AdGuard holds what we wrote, for the fields we own. */
export function matches(actual: AdGuardClientRecord | undefined, wanted: AdGuardClientRecord): boolean {
  if (!actual) return false;
  const same = (a: string[] | undefined, b: string[] | undefined) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
  const days = (s: AdGuardClientRecord['blocked_services_schedule']) =>
    Object.keys(s ?? {})
      .filter((k) => k !== 'time_zone')
      .sort();
  return (
    actual.use_global_blocked_services === false &&
    same(actual.blocked_services, wanted.blocked_services) &&
    same(actual.ids, wanted.ids) &&
    days(actual.blocked_services_schedule).length === 0
  );
}
