// Export of the household's data as one documented JSON file (brief Part 15, docs/export.md).
// Each table is found through the household, its children, its devices, its groups or its people.
// What is left out is listed in the file itself, with why.
import { schema, type Db } from '@family-time/db';
import { eq, getTableColumns, inArray, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

export const EXPORT_FORMAT = 'family-time-export';
export const EXPORT_VERSION = 1;

/** Tables in the export, with any columns left out of them. */
const TABLES: [name: string, table: PgTable, omit: string[]][] = [
  ['people', schema.people, ['oidcSubject']],
  ['settings', schema.settings, []],
  ['devices', schema.devices, []],
  ['services', schema.services, []],
  ['serviceGroups', schema.serviceGroups, []],
  ['serviceGroupMembers', schema.serviceGroupMembers, []],
  ['policies', schema.policies, []],
  ['schedules', schema.schedules, []],
  ['overrides', schema.overrides, []],
  ['grants', schema.grants, []],
  ['usageMinutes', schema.usageMinutes, []],
  ['sessionEndings', schema.sessionEndings, []],
  ['allowances', schema.allowances, []],
  ['reductionPlans', schema.reductionPlans, []],
  ['tasks', schema.tasks, []],
  ['completions', schema.completions, ['photoPath']],
  ['requests', schema.requests, []],
  ['goals', schema.goals, []],
  ['ideas', schema.ideas, []],
  ['reflections', schema.reflections, []],
  ['ledgerEntries', schema.ledgerEntries, []],
  ['kioskDevices', schema.kioskDevices, ['tokenHash']],
  ['helpFeedback', schema.helpFeedback, []],
  ['aiSettings', schema.aiSettings, []],
  ['aiCalls', schema.aiCalls, []],
  ['proposals', schema.proposals, []],
  ['oauthClients', schema.oauthClients, []],
  ['mcpServers', schema.mcpServers, []],
  ['auditEvents', schema.auditEvents, []],
];

export const LEFT_OUT = [
  { what: 'Passkeys, sign-ins, invite links and connected-app tokens', why: 'They let someone sign in. A new server makes new ones.' },
  { what: 'AI keys', why: "They are sealed with this server's master key and are no use anywhere else. Paste them again on a new server." },
  { what: 'Photos from the kiosk', why: 'They are deleted 30 days after a job is answered, and are kept out of a file that may be shared.' },
  { what: 'The blockchain copy of the ledger', why: 'The ledger entries are all here; the chain can be rebuilt from them.' },
  { what: "AdGuard's own settings and query log", why: 'AdGuard holds them, not Family time; the nightly backup copies its settings.' },
];

export async function exportHousehold(db: Db, householdId: string, now: Date) {
  const [household] = await db.select().from(schema.households).where(eq(schema.households.id, householdId));
  const ids = async (table: PgTable, where: SQL) => (await db.select({ id: (getTableColumns(table) as Record<string, never>)['id']! }).from(table).where(where)).map((r) => (r as { id: string }).id);
  const people = await ids(schema.people, eq(schema.people.householdId, householdId));
  // Children are people too, so the same list finds their rows.
  const children = people;
  const devices = await ids(schema.devices, eq(schema.devices.householdId, householdId));
  const groups = await ids(schema.serviceGroups, eq(schema.serviceGroups.householdId, householdId));
  const tables: Record<string, unknown[]> = {};
  for (const [name, table, omit] of TABLES) {
    const cols = getTableColumns(table) as Record<string, Parameters<typeof eq>[0]>;
    const where =
      'householdId' in cols ? eq(cols['householdId']!, householdId)
      : 'childId' in cols ? inArray(cols['childId']!, children)
      : 'deviceId' in cols ? inArray(cols['deviceId']!, devices)
      : 'groupId' in cols ? inArray(cols['groupId']!, groups)
      : 'personId' in cols ? inArray(cols['personId']!, people)
      : undefined;
    if (!where) throw new Error(`The export cannot find ${name} through the household.`);
    const rows = (await db.select().from(table).where(where)) as Record<string, unknown>[];
    tables[name] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.includes(k))));
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), household, tables, leftOut: LEFT_OUT };
}
