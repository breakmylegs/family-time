// The MCP server (ADR 0016): what a parent's own assistant can see and suggest. Read tools need the
// `read` scope; propose tools need `propose`, ask the person to confirm first (a signed, expiring
// request state carries the arguments between the two rounds), and only ever make a card on
// Approvals. Nothing here changes a rule, and nothing here writes to AdGuard.
import { hkdfSync } from 'node:crypto';
import { people, serviceGroups, services, type Db } from '@family-time/db';
import type { LedgerPort } from '@family-time/ledger';
import { acceptedContent, createRequestStateCodec, inputRequired, McpServer, type McpRequestContext, type ServerContext } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createProposal, ProposalError, proposalItems, waitingRequestIds, type NewProposal } from '../ai/proposals.js';
import { audit } from '../audit.js';
import { childStatus } from '../control/commands.js';
import { todayHistory } from '../control/history.js';
import { approvalsFor, weekSummary } from '../economy/commands.js';
import { minutes, pence } from '../economy/words.js';
import type { Bearer } from './oauth.js';

export interface McpDeps {
  db: Db;
  ledger: LedgerPort;
  now: () => Date;
  /** Tells open Approvals screens a card arrived. */
  emit: (householdId: string) => void;
  /** 32 bytes, from the master key. Signs the confirmation round's state. */
  stateKey: Buffer;
  version: string;
}

type State = { tool: string; args: string };

const Confirm = z.object({ confirm: z.boolean().describe('Send it to Approvals') });
const CONFIRM_SCHEMA = { type: 'object' as const, properties: { confirm: { type: 'boolean' as const, title: 'Send it to Approvals' } }, required: ['confirm'] };

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** The key for request state, derived so it can never be used for anything else. */
export function stateKeyFrom(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'family-time mcp request state v1', 32));
}

/** Arguments in a fixed order, so the confirmed call is exactly the one that was shown. */
const stable = (args: Record<string, unknown>) => JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]));

export function mcpFactory(deps: McpDeps) {
  const { db, ledger, now } = deps;
  const codec = createRequestStateCodec<State>({
    key: deps.stateKey,
    ttlSeconds: 300,
    // The state only works for the same method, the same app and the same person.
    bind: (ctx) => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ''}\0${String(ctx.http?.authInfo?.extra?.['personId'] ?? '')}`,
  });

  return (ctx: McpRequestContext) => {
    const bearer = ctx.authInfo?.extra?.['bearer'] as Bearer | undefined;
    const server = new McpServer(
      { name: 'family-time', version: deps.version },
      { instructions: 'Family time: see what each child can use now and suggest changes. Suggestions become cards a parent approves in the app. Nothing changes until then.', requestState: { verify: codec.verify } },
    );
    if (!bearer) return server;
    const { householdId } = bearer;

    const kids = async () =>
      db
        .select({ id: people.id, name: people.displayName })
        .from(people)
        .where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)));

    /** By first name (any case) or id, within this family only. */
    const childNamed = async (nameOrId: string) => {
      const all = await kids();
      const k = all.find((c) => c.id === nameOrId || c.name.toLowerCase() === nameOrId.trim().toLowerCase());
      if (!k) throw new ProposalError('unknown_child', `There is no child called ${nameOrId} here. The children are: ${all.map((c) => c.name).join(', ') || 'none yet'}.`);
      return k;
    };

    const logged = async (tool: string, args: unknown) =>
      audit(db, { householdId, actor: { personId: bearer.personId }, action: 'mcp.tool', targetType: 'oauth_client', targetId: bearer.clientRowId, after: { tool, client: bearer.clientName, args } });

    const guard =
      <A,>(tool: string, fn: (args: A, ctx: ServerContext) => Promise<ReturnType<typeof text> | ReturnType<typeof inputRequired>>) =>
      async (args: A, ctx: ServerContext) => {
        try {
          await logged(tool, args);
          return await fn(args, ctx);
        } catch (err) {
          if (err instanceof ProposalError) return { ...text(err.message), isError: true };
          throw err;
        }
      };

    const ChildArg = z.object({ child: z.string().min(1).max(60).describe('The child, by first name') });
    const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

    if (bearer.scopes.includes('read')) {
      server.registerTool(
        'get_status',
        { title: 'What each child can use now', description: 'Each child: what is allowed, blocked or paused right now, why, and until when.', inputSchema: z.object({ child: z.string().max(60).optional().describe('One child by first name; all children if left out') }), annotations: readOnly },
        guard<{ child?: string | undefined }>('get_status', async (args) => {
          const list = args.child ? [await childNamed(args.child)] : await kids();
          const t = now();
          const parts = [];
          for (const k of list) {
            const s = await childStatus(db, k.id, t);
            const lines = s.services.map((x) => `- ${x.name}: ${x.state}. ${x.reason}${x.untilLabel ? ` Until ${x.untilLabel}.` : ''}`);
            parts.push([`${k.name}: ${s.headline.lead} ${s.headline.rest}`.trim(), ...(s.pause ? [`Paused by ${s.pause.by}${s.pause.untilLabel ? ` until ${s.pause.untilLabel}` : ''}.`] : []), ...lines].join('\n'));
          }
          return text(parts.join('\n\n') || 'There are no children set up yet.');
        }),
      );

      server.registerTool(
        'get_week',
        { title: "A child's week", description: 'Screen time allowance, used and left this week, jobs done and pocket money.', inputSchema: ChildArg, annotations: readOnly },
        guard<{ child: string }>('get_week', async (args) => {
          const k = await childNamed(args.child);
          const w = await weekSummary(db, ledger, k.id, now());
          return text(
            [
              `${k.name}'s week (resets ${w.resets}).`,
              `Allowance ${minutes(w.allowanceMinutes)}, used ${minutes(w.usedMinutes)}, planned ${minutes(w.plannedMinutes)}, left ${minutes(w.leftMinutes)}.`,
              `Earned from jobs: ${minutes(w.earnedMinutes)} of up to ${minutes(w.earnedCapMinutes)}.`,
              `Pocket money ${pence(w.moneyPence)}, flex points ${w.flexPoints}.`,
              ...(w.goal ? [`Saving for ${w.goal.title}: ${pence(w.goal.savedPence)} of ${pence(w.goal.targetPence)}.`] : []),
            ].join('\n'),
          );
        }),
      );

      server.registerTool(
        'get_history',
        { title: "Today's changes", description: "What changed today for a child, and who changed it.", inputSchema: ChildArg, annotations: readOnly },
        guard<{ child: string }>('get_history', async (args) => {
          const k = await childNamed(args.child);
          const h = await todayHistory(db, householdId, k.id, now());
          return text(h.length ? h.map((e) => `${e.time} ${e.text}`).join('\n') : `Nothing has changed for ${k.name} today.`);
        }),
      );

      server.registerTool(
        'get_pending_approvals',
        { title: 'Waiting for a parent', description: 'Jobs done, requests for time and suggestions waiting on Approvals. Request ids can be passed to propose_approval.', inputSchema: z.object({}), annotations: readOnly },
        guard<Record<string, never>>('get_pending_approvals', async () => {
          const t = now();
          const own = await approvalsFor(db, ledger, householdId, t);
          const suggested = await proposalItems(db, householdId, t);
          const lines = [
            // Only names and times the parents made: never a note the child typed with a request,
            // which an assistant could read as an instruction.
            // Questions about rules are never here: they are the child's own words.
            ...own.flatMap((i) => (i.kind === 'request' ? [`Request ${i.id}: ${i.childName} asks for ${i.target}, ${i.window}, ${i.minutes} minutes.`] : i.kind === 'completion' ? [`Job: ${i.childName}, ${i.title}, ${i.when}.`] : [])),
            ...suggested.map((s) => `Suggestion: ${s.title}. ${s.from}.`),
          ];
          return text(lines.join('\n') || 'Nothing is waiting.');
        }),
      );
    }

    if (bearer.scopes.includes('propose')) {
      /** Asks the person to confirm, then makes the card. The confirmed call must match the shown one. */
      const confirmThen = async (tool: string, args: Record<string, unknown>, ctx: ServerContext, message: string, make: () => Promise<{ summary: string }>) => {
        const state = ctx.mcpReq.requestState<State>();
        const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', Confirm);
        if (state && typeof state === 'object' && state.tool === tool && state.args === stable(args) && answer) {
          if (!answer.confirm) return text('Not sent. Nothing has changed.');
          const made = await make();
          deps.emit(householdId);
          return text(`Sent to Approvals: ${made.summary}. Nothing changes until a parent approves it in the app. The card closes after 30 minutes if nobody answers it.`);
        }
        return inputRequired({
          inputRequests: { confirm: inputRequired.elicit({ message, requestedSchema: CONFIRM_SCHEMA }) },
          requestState: await codec.mint({ tool, args: stable(args) }, ctx),
        });
      };
      const proposeHints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
      const Duration = z.enum(['30m', '1h', 'until-bedtime', 'until-tomorrow']);

      server.registerTool(
        'propose_override',
        {
          title: 'Suggest an Allow or Block',
          description: 'Suggests allowing or blocking one app or group for a child for a while. It becomes a card on Approvals; a parent approves it there.',
          inputSchema: z.object({ child: z.string().min(1).max(60), app: z.string().min(1).max(60).describe('An app or group name, as in the app'), action: z.enum(['allow', 'block']), duration: Duration }),
          annotations: proposeHints,
        },
        guard<{ child: string; app: string; action: 'allow' | 'block'; duration: z.infer<typeof Duration> }>('propose_override', async (args, ctx) => {
          const k = await childNamed(args.child);
          const target = await targetNamed(db, householdId, args.app);
          const proposal: NewProposal = { kind: 'override', payload: { request: { target: { kind: target.kind, id: target.id }, type: args.action, duration: args.duration, countsAgainstAllowance: true } } };
          const words = `${args.action === 'allow' ? 'Allow' : 'Block'} ${target.name} for ${k.name} ${DURATION[args.duration]}`;
          return confirmThen('propose_override', args, ctx, `Send a card to Approvals: ${words}?`, () =>
            createProposal(db, { householdId, childId: k.id, source: 'mcp', clientId: bearer.clientRowId, proposal }, now()),
          );
        }),
      );

      server.registerTool(
        'propose_pause',
        { title: 'Suggest a Pause', description: 'Suggests pausing everything for a child. It becomes a card on Approvals.', inputSchema: z.object({ child: z.string().min(1).max(60), duration: Duration }), annotations: proposeHints },
        guard<{ child: string; duration: z.infer<typeof Duration> }>('propose_pause', async (args, ctx) => {
          const k = await childNamed(args.child);
          return confirmThen('propose_pause', args, ctx, `Send a card to Approvals: pause everything for ${k.name} ${DURATION[args.duration]}?`, () =>
            createProposal(db, { householdId, childId: k.id, source: 'mcp', clientId: bearer.clientRowId, proposal: { kind: 'pause', payload: { duration: args.duration } } }, now()),
          );
        }),
      );

      server.registerTool(
        'propose_approval',
        { title: "Suggest saying yes to a child's request", description: 'Suggests approving a waiting request for time, by its id from get_pending_approvals. It becomes a card on Approvals.', inputSchema: z.object({ request_id: z.uuid() }), annotations: proposeHints },
        guard<{ request_id: string }>('propose_approval', async (args, ctx) => {
          const all = await kids();
          const r = (await waitingRequestIds(db, all.map((k) => k.id))).find((x) => x.id === args.request_id);
          if (!r) throw new ProposalError('unknown_request', "That request isn't waiting any more.");
          const k = all.find((c) => c.id === r.childId)!;
          return confirmThen('propose_approval', args, ctx, `Send a card to Approvals: say yes to ${k.name}'s request?`, () =>
            createProposal(db, { householdId, childId: k.id, source: 'mcp', clientId: bearer.clientRowId, proposal: { kind: 'approval', payload: { requestId: r.id } } }, now()),
          );
        }),
      );
    }

    return server;
  };
}

const DURATION: Record<string, string> = { '30m': 'for 30 minutes', '1h': 'for an hour', 'until-bedtime': 'until bedtime', 'until-tomorrow': 'until tomorrow morning' };

async function targetNamed(db: Db, householdId: string, name: string) {
  const want = name.trim().toLowerCase();
  const apps = await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.householdId, householdId));
  const groups = await db.select({ id: serviceGroups.id, name: serviceGroups.name }).from(serviceGroups).where(eq(serviceGroups.householdId, householdId));
  const app = apps.find((a) => a.name.toLowerCase() === want);
  if (app) return { kind: 'service' as const, ...app };
  const group = groups.find((g) => g.name.toLowerCase() === want);
  if (group) return { kind: 'group' as const, ...group };
  throw new ProposalError('unknown_target', `${name} isn't on the family's list. The apps are: ${apps.map((a) => a.name).join(', ')}. The groups are: ${groups.map((g) => g.name).join(', ') || 'none'}.`);
}
