// The owner's System page (Phase 8): how the server is, what is switched on, how long data is
// kept, the audit log and the release notes.
import { z } from 'zod';
import { Readiness } from './health.js';

export const Release = z.object({ version: z.string(), title: z.string(), notes: z.array(z.string()) });
export type Release = z.infer<typeof Release>;

export const MaintenanceState = z.object({ on: z.boolean(), message: z.string().nullable(), since: z.string().nullable() });
export type MaintenanceState = z.infer<typeof MaintenanceState>;

export const SystemView = z.object({
  version: z.object({ app: z.string(), commit: z.string(), builtAt: z.string(), schema: z.string() }),
  uptimeSeconds: z.number().int(),
  readiness: Readiness,
  adguard: z.object({
    setUp: z.boolean(),
    devices: z.array(z.object({ label: z.string(), state: z.string(), confirmedAt: z.string().nullable(), lastError: z.string().nullable() })),
  }),
  ledger: z.object({ adapter: z.enum(['postgres', 'besu']), contract: z.string().nullable(), waiting: z.number().int(), failed: z.number().int() }),
  lastBackup: z
    .object({ at: z.string(), ok: z.boolean(), lastOkAt: z.string().nullable(), bytes: z.number().nullable(), snapshot: z.string().nullable(), problem: z.string().nullable() })
    .nullable(),
  maintenance: MaintenanceState,
  pilot: z.object({ phase: z.string(), features: z.record(z.string(), z.boolean()) }),
  ai: z.object({ on: z.boolean(), mcp: z.boolean() }),
  retention: z.array(z.object({ what: z.string() })),
  releases: z.array(Release),
});
export type SystemView = z.infer<typeof SystemView>;

export const AuditEntry = z.object({
  id: z.number().int(),
  at: z.string(),
  /** A person's name, or a label such as cli, retention or backup. */
  by: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  detail: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditPage = z.object({ entries: z.array(AuditEntry), older: z.string().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/** One week of the pilot's measures (brief Part 14). */
export const PilotWeek = z.object({
  /** The Monday the week starts on, `2026-10-26`. */
  week: z.string(),
  label: z.string(),
  minutesByApp: z.array(z.object({ app: z.string(), minutes: z.number().int() })),
  unusedMinutesConverted: z.number().int(),
  /** How many different jobs and ideas were done: offline variety. */
  offlineVariety: z.number().int(),
  endings: z.object({ calm: z.number().int(), grumble: z.number().int(), meltdown: z.number().int() }),
  windDownMinutes: z.number().int(),
  bedtimeMinutes: z.number().int(),
  jobsApproved: z.number().int(),
});
export type PilotWeek = z.infer<typeof PilotWeek>;
export const PilotMeasures = z.object({ childId: z.uuid(), phase: z.string(), weeks: z.array(PilotWeek) });
export type PilotMeasures = z.infer<typeof PilotMeasures>;
