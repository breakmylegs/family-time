// Retention (Phase 8, ADR 0017): data kept only as long as it is needed. Once a day, each table
// below loses rows older than its period. Every period is fixed here and shown on the System page;
// a sweep that deletes anything audits its counts. Never pruned: ledger entries and the chain's
// records (money and points history), people, and the family's rules.
import { auditEvents } from './schema.js';
import type { Db } from './types.js';
import { sql, type SQL } from 'drizzle-orm';

const DAY = 86_400_000;

export interface RetentionRule {
  table: string;
  /** For the System page: what goes, and when. */
  what: string;
  days: number;
  /** Rows older than `before` that may go. */
  statement: (before: string) => SQL;
}

export const RETENTION: RetentionRule[] = [
  { table: 'sessions', what: 'Sign-ins, 30 days after they end', days: 30, statement: (b) => sql`delete from sessions where expires_at < ${b}` },
  { table: 'webauthn_challenges', what: 'Passkey challenges, a day after they expire', days: 1, statement: (b) => sql`delete from webauthn_challenges where expires_at < ${b}` },
  { table: 'kiosk_pairings', what: 'Kiosk codes, a day after they expire', days: 1, statement: (b) => sql`delete from kiosk_pairings where expires_at < ${b}` },
  {
    table: 'invites',
    what: 'Invite links, 90 days after they are used or expire',
    days: 90,
    // Only once no challenge still points at it.
    statement: (b) => sql`delete from invites i where coalesce(i.used_at, i.revoked_at, i.expires_at) < ${b} and not exists (select 1 from webauthn_challenges c where c.invite_id = i.id)`,
  },
  { table: 'oauth_codes', what: 'Connected-app sign-in codes, a day after they expire', days: 1, statement: (b) => sql`delete from oauth_codes where expires_at < ${b}` },
  { table: 'oauth_tokens', what: 'Connected-app tokens, 30 days after they end', days: 30, statement: (b) => sql`delete from oauth_tokens where coalesce(revoked_at, expires_at) < ${b}` },
  { table: 'proposals', what: 'Suggestions, 90 days after they are answered or close', days: 90, statement: (b) => sql`delete from proposals where status <> 'waiting' and coalesce(decided_at, expires_at) < ${b}` },
  { table: 'ai_calls', what: 'AI call records, after 13 months', days: 396, statement: (b) => sql`delete from ai_calls where at < ${b}` },
  { table: 'help_feedback', what: 'Help feedback, after 12 months', days: 365, statement: (b) => sql`delete from help_feedback where created_at < ${b}` },
  { table: 'usage_minutes', what: 'Minutes of use per app (the pilot measures), after 13 months', days: 396, statement: (b) => sql`delete from usage_minutes where minute < ${b}` },
  { table: 'session_endings', what: 'How sessions ended, after 13 months', days: 396, statement: (b) => sql`delete from session_endings where ended_at < ${b}` },
  { table: 'discovery_requests', what: 'Discovery helper answers, an hour after they were asked for', days: 1 / 24, statement: (b) => sql`delete from discovery_requests where requested_at < ${b}` },
  { table: 'journal', what: 'Things done away from screens, and the praise, after 13 months', days: 396, statement: (b) => sql`delete from journal where at < ${b}` },
  { table: 'rule_asks', what: 'Questions about rules, 13 months after they are answered', days: 396, statement: (b) => sql`delete from rule_asks where status = 'answered' and decided_at < ${b}` },
  { table: 'skills', what: 'Skills that were removed, after 90 days', days: 90, statement: (b) => sql`delete from skills where removed_at < ${b}` },
  { table: 'unmanaged_time', what: "Parents' estimates of screen time away from home Wi-Fi, after 13 months", days: 396, statement: (b) => sql`delete from unmanaged_time where updated_at < ${b}` },
  { table: 'mood_checks', what: "Parents' monthly mood checks, after 13 months", days: 396, statement: (b) => sql`delete from mood_checks where at < ${b}` },
];

/** Audit events go after two years. The database itself refuses anything younger (migration 0011). */
export const AUDIT_DAYS = 730;

const rowsOf = (result: unknown): number => {
  const r = result as { rows?: unknown[]; rowCount?: number; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? r.rows?.length ?? 0;
};

export async function sweep(db: Db, now: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const rule of RETENTION) {
    const n = rowsOf(await db.execute(rule.statement(new Date(now.getTime() - rule.days * DAY).toISOString())));
    if (n) counts[rule.table] = n;
  }
  const audit = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('family_time.retention', 'on', true)`);
    return rowsOf(await tx.execute(sql`delete from audit_events where at < ${new Date(now.getTime() - AUDIT_DAYS * DAY).toISOString()} and at < now() - interval '730 days'`));
  });
  if (audit) counts['audit_events'] = audit;
  if (Object.keys(counts).length) {
    await db.insert(auditEvents).values({ actorLabel: 'retention', action: 'retention.swept', after: counts, at: now });
  }
  return counts;
}
