// Proposals (ADR 0016): what AI or an MCP client would like done. A row is only words and checked
// ids. Nothing happens until a parent taps Approve, and then it is that parent's own action, run
// through the same commands as Control's buttons and the Approvals screen.
import { loadEconomy, oauthClients, people, proposals, requests, type Db } from '@family-time/db';
import { clockLabel } from '@family-time/domain';
import type { LedgerPort } from '@family-time/ledger';
import { DurationChoice, OverrideRequest, type ApprovalItem } from '@family-time/schemas';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit.js';
import { can } from '../auth/capabilities.js';
import { findChild, setOverride } from '../control/commands.js';
import { approveRequest, EconomyError, targetName } from '../economy/commands.js';
import { when } from '../economy/words.js';

/** A card waits this long. An Allow suggested at teatime means nothing by bedtime. */
export const PROPOSAL_LIFETIME_MS = 30 * 60_000;

export const OverridePayload = z.object({ request: OverrideRequest });
export const PausePayload = z.object({ duration: z.union([DurationChoice, z.literal('until-resume')]) });
export const ApprovalPayload = z.object({ requestId: z.uuid() });

export type NewProposal =
  | { kind: 'override'; payload: z.infer<typeof OverridePayload> }
  | { kind: 'pause'; payload: z.infer<typeof PausePayload> }
  | { kind: 'approval'; payload: z.infer<typeof ApprovalPayload> };

export class ProposalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const DURATION_WORDS: Record<string, string> = {
  '30m': 'for 30 minutes',
  '1h': 'for an hour',
  'until-bedtime': 'until bedtime',
  'until-tomorrow': 'until tomorrow morning',
  'until-resume': 'until someone resumes it',
};

/** The words on the card, from the family's own names: "Allow YouTube for Ollie for an hour". */
export async function describe(db: Db, householdId: string, childName: string, p: NewProposal): Promise<string> {
  if (p.kind === 'pause') return `Pause everything for ${childName} ${DURATION_WORDS[p.payload.duration]}`;
  if (p.kind === 'approval') {
    const r = (await db.select().from(requests).where(eq(requests.id, p.payload.requestId)))[0];
    const name = r ? await targetName(db, householdId, { kind: r.targetKind, id: r.targetId }).catch(() => 'an app') : 'an app';
    return `Say yes to ${childName}'s request for ${name}`;
  }
  const { request } = p.payload;
  const what = request.target.kind === 'everything' ? 'everything' : await targetName(db, householdId, request.target).catch(() => 'an app');
  const verb = { allow: 'Allow', block: 'Block', pause: 'Pause' }[request.type];
  return `${verb} ${what} for ${childName} ${DURATION_WORDS[request.duration]}`;
}

/**
 * Checks the proposal against this family's own children, apps and requests, then stores it.
 * Anything that does not check out is refused here, before a card exists.
 */
export async function createProposal(
  db: Db,
  input: { householdId: string; childId: string; source: 'ai' | 'mcp'; clientId?: string | null; proposal: NewProposal; asked?: string | null; summary?: string },
  now: Date,
): Promise<{ id: string; summary: string }> {
  const child = await findChild(db, input.householdId, input.childId);
  if (!child) throw new ProposalError('unknown_child', 'That child is not in this family.');
  const p = input.proposal;
  if (p.kind === 'override') {
    OverridePayload.parse(p.payload);
    if (p.payload.request.duration === 'until-resume' && p.payload.request.type !== 'pause') throw new ProposalError('bad_duration', 'Only Pause can last until someone resumes it.');
    if (p.payload.request.target.kind !== 'everything') await targetName(db, input.householdId, p.payload.request.target).catch(() => {
      throw new ProposalError('unknown_target', "That app isn't on your family's list.");
    });
  } else if (p.kind === 'pause') {
    PausePayload.parse(p.payload);
  } else {
    ApprovalPayload.parse(p.payload);
    const r = (await db.select().from(requests).where(and(eq(requests.id, p.payload.requestId), eq(requests.childId, child.id), eq(requests.status, 'waiting'))))[0];
    if (!r) throw new ProposalError('unknown_request', "That request isn't waiting any more.");
  }
  const summary = input.summary ?? (await describe(db, input.householdId, child.name, p));
  const [row] = await db
    .insert(proposals)
    .values({
      householdId: input.householdId,
      childId: child.id,
      source: input.source,
      clientId: input.clientId ?? null,
      kind: p.kind,
      payload: p.payload,
      summary,
      asked: input.asked?.slice(0, 280) ?? null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
    })
    .returning({ id: proposals.id });
  await audit(db, {
    householdId: input.householdId,
    actor: { label: input.source === 'mcp' ? 'mcp' : 'ai' },
    action: 'proposal.made',
    targetType: 'proposal',
    targetId: row!.id,
    after: { kind: p.kind, childId: child.id, clientId: input.clientId ?? null, summary },
  });
  return { id: row!.id, summary };
}

/** Cards past their time are marked expired, so they leave the list and the badge. */
export async function expireProposals(db: Db, householdId: string, now: Date) {
  await db
    .update(proposals)
    .set({ status: 'expired' })
    .where(and(eq(proposals.householdId, householdId), eq(proposals.status, 'waiting'), lte(proposals.expiresAt, now)));
}

export async function waitingProposals(db: Db, householdId: string, now: Date): Promise<number> {
  await expireProposals(db, householdId, now);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(proposals).where(and(eq(proposals.householdId, householdId), eq(proposals.status, 'waiting')));
  return Number(r?.n ?? 0);
}

/** For Approvals: each waiting card, with where it came from. */
export async function proposalItems(db: Db, householdId: string, now: Date): Promise<(Extract<ApprovalItem, { kind: 'proposal' }> & { sortAt: number })[]> {
  await expireProposals(db, householdId, now);
  const rows = await db
    .select({ p: proposals, child: people.displayName, client: oauthClients.name })
    .from(proposals)
    .innerJoin(people, eq(people.id, proposals.childId))
    .leftJoin(oauthClients, eq(oauthClients.id, proposals.clientId))
    .where(and(eq(proposals.householdId, householdId), eq(proposals.status, 'waiting')));
  const out = [];
  for (const { p, child, client } of rows) {
    const tz = (await loadEconomy(db, p.childId!)).timeZone;
    out.push({
      kind: 'proposal' as const,
      id: p.id,
      childId: p.childId!,
      childName: child,
      title: p.summary,
      from: p.source === 'mcp' ? `Suggested by ${client ?? 'a connected app'}` : 'Suggested by AI',
      asked: p.asked,
      when: when(p.createdAt, now, tz),
      expires: `This card closes at ${clockLabel(p.expiresAt, now, tz)} if nobody answers it`,
      needs: p.kind === 'override' && OverridePayload.parse(p.payload).request.type !== 'pause' ? ('parent' as const) : ('anyone' as const),
      sortAt: p.createdAt.getTime(),
    });
  }
  return out;
}

async function waiting(db: Db, householdId: string, id: string, now: Date) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ProposalError('not_found', "That suggestion isn't waiting any more.", 404);
  await expireProposals(db, householdId, now);
  const p = (await db.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.householdId, householdId))))[0];
  if (!p || p.status !== 'waiting') throw new ProposalError('not_found', p?.status === 'expired' ? "That suggestion closed after 30 minutes. Ask again if it's still needed." : "That suggestion isn't waiting any more. Someone may have answered it already.", 404);
  return p;
}

/**
 * The parent's tap. Runs the proposal as this parent, with this parent's rights, through the same
 * commands as the app's own buttons. Claimed first, so two taps can never run it twice.
 */
export async function approveProposal(
  db: Db,
  ledger: LedgerPort,
  input: { householdId: string; proposalId: string; by: { id: string; role: Parameters<typeof can>[0] }; ip?: string },
  now: Date,
): Promise<{ summary: string }> {
  const p = await waiting(db, input.householdId, input.proposalId, now);
  const need = p.kind === 'override' && OverridePayload.parse(p.payload).request.type !== 'pause' ? 'control.change' : p.kind === 'approval' ? 'approvals.decide' : 'control.pause';
  if (!can(input.by.role, need)) throw new ProposalError('forbidden', 'Only a parent can approve this one. Ask a parent if it needs doing.', 403);
  const claimed = await db
    .update(proposals)
    .set({ status: 'approved', decidedBy: input.by.id, decidedAt: now })
    .where(and(eq(proposals.id, p.id), eq(proposals.status, 'waiting')))
    .returning({ id: proposals.id });
  if (!claimed.length) throw new ProposalError('not_found', "That suggestion isn't waiting any more. Someone may have answered it already.", 404);
  const base = { householdId: input.householdId, childId: p.childId!, byPersonId: input.by.id, ...(input.ip ? { ip: input.ip } : {}) };
  try {
    if (p.kind === 'override') await setOverride(db, { ...base, request: OverridePayload.parse(p.payload).request }, now);
    else if (p.kind === 'pause') await setOverride(db, { ...base, request: { target: { kind: 'everything' }, type: 'pause', duration: PausePayload.parse(p.payload).duration, countsAgainstAllowance: false } }, now);
    else await approveRequest(db, ledger, { householdId: input.householdId, requestId: ApprovalPayload.parse(p.payload).requestId, by: input.by.id, asExtra: false }, now);
  } catch (err) {
    // It could not be done (the app was removed, the request answered): put the card back as
    // declined, so it leaves the list with the reason, and nothing half-done stays.
    await db.update(proposals).set({ status: 'declined' }).where(eq(proposals.id, p.id));
    if (err instanceof EconomyError) throw new ProposalError(err.code, err.message, err.status);
    if (err instanceof Error && 'code' in err) throw new ProposalError(String((err as { code: string }).code), err.message);
    throw err;
  }
  await audit(db, { householdId: input.householdId, actor: { personId: input.by.id }, action: 'proposal.approved', targetType: 'proposal', targetId: p.id, ...(input.ip ? { ip: input.ip } : {}) });
  return { summary: p.summary };
}

export async function declineProposal(db: Db, input: { householdId: string; proposalId: string; by: string; ip?: string }, now: Date) {
  const p = await waiting(db, input.householdId, input.proposalId, now);
  await db.update(proposals).set({ status: 'declined', decidedBy: input.by, decidedAt: now }).where(and(eq(proposals.id, p.id), eq(proposals.status, 'waiting')));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'proposal.declined', targetType: 'proposal', targetId: p.id, ...(input.ip ? { ip: input.ip } : {}) });
}

/** For the MCP read tool: what is waiting, by id, so a client can propose approving a request. */
export async function waitingRequestIds(db: Db, childIds: string[]) {
  if (!childIds.length) return [];
  return db.select({ id: requests.id, childId: requests.childId }).from(requests).where(and(inArray(requests.childId, childIds), eq(requests.status, 'waiting')));
}
