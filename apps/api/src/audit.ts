import { auditEvents, type Db } from '@family-time/db';
import type { FastifyBaseLogger } from 'fastify';

export interface AuditEntry {
  householdId?: string | null;
  /** A person, or a system label such as `cli`. Exactly one. */
  actor: { personId: string } | { label: string };
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/**
 * Writes an audit event. Never throws into the request: a failed audit write is logged as an
 * error instead, because refusing a parent's Pause because the audit table is unhappy would be worse.
 */
export async function audit(db: Db, entry: AuditEntry, log?: FastifyBaseLogger): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      householdId: entry.householdId ?? null,
      actorPersonId: 'personId' in entry.actor ? entry.actor.personId : null,
      actorLabel: 'label' in entry.actor ? entry.actor.label : null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    log?.error({ event: 'audit_write_failed', action: entry.action, err });
  }
}
