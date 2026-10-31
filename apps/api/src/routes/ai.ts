// AI routes (Phase 7, ADR 0016). The owner's settings and keys, the three features with their
// fallbacks, proposals, and the apps connected over MCP. With AI off, each feature answers with its
// fallback and says so; nothing here ever acts without a parent's tap.
import { FALLBACK_IDEAS, FEATURES, PROVIDER_IDS, proposeControl, readForecast, suggestJobs, templateSummary, weeklySummary, type FeatureId, type LanguageModel, type ProviderId, type WeatherServer, type WeekTotals } from '@family-time/ai';
import { completions, mcpServers, oauthClients, oauthTokens, people, serviceGroups, services, tasks, loadEconomy, type Db } from '@family-time/db';
import type { LedgerPort } from '@family-time/ledger';
import { AiControlRequest, AiKeyInput, AiSettingsInput, type AiControlResult, type AiFeatures, type JobIdeas, type McpClientEntry, type McpServerEntry, McpServerInput, type WeekNote } from '@family-time/schemas';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { approveProposal, createProposal, declineProposal, ProposalError } from '../ai/proposals.js';
import { aiView, removeKey, runFeature, saveKey, saveSettings } from '../ai/store.js';
import { audit } from '../audit.js';
import { findChild } from '../control/commands.js';
import { weekSummary } from '../economy/commands.js';
import { minutes, pence } from '../economy/words.js';
import type { Changes } from '../events.js';
import { parseBody } from './validate.js';

export interface AiRouteDeps {
  db: Db;
  ledger: LedgerPort;
  now: () => Date;
  changes: Changes;
  notifyChange: () => Promise<void>;
  /** Tests give a mock model here. Production opens the household's sealed key. */
  model?: (provider: ProviderId, name: string) => Promise<LanguageModel>;
  /** Tests give a fake forecast here. Production calls the owner's approved MCP server. */
  readWeather?: (server: WeatherServer) => Promise<string | null>;
}

type Id = { Params: { id: string } };
const UUID = /^[0-9a-f-]{36}$/i;

export async function aiRoutes(app: FastifyInstance, deps: AiRouteDeps): Promise<void> {
  const { db, ledger, now } = deps;

  const failed = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ProposalError) return reply.code(err.status).send({ error: err.code, detail: err.message });
    throw err;
  };

  // ---- The owner's settings
  app.get('/api/ai', { config: { access: 'system.manage' } }, async (request) => aiView(db, request.auth!.person.householdId, now()));

  app.put('/api/ai', { config: { access: 'system.manage' } }, async (request, reply) => {
    const body = parseBody(AiSettingsInput, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const view = await aiView(db, me.householdId, now());
    if (!view.available && (body.on || body.mcp.on)) {
      return reply.code(409).send({ error: 'no_master_key', detail: "AI isn't set up on this server yet. Run ./scripts/init.sh, then ./scripts/update.sh." });
    }
    for (const [id, f] of Object.entries(body.features)) {
      if (!f?.provider || !f.model) continue;
      const models = view.providers.find((p) => p.id === f.provider)?.models ?? [];
      if (!models.includes(f.model)) return reply.code(400).send({ error: 'bad_model', detail: `${f.model} is not on the list for ${view.providers.find((p) => p.id === f.provider)?.label ?? f.provider}. Pick one from the list.`, feature: id });
    }
    await saveSettings(db, me.householdId, body, now());
    if (view.mcp.on && !body.mcp.on) {
      // Switching connected apps off ends their sign-ins too, so switching back on is a fresh start.
      const ids = (await db.select({ id: oauthClients.id }).from(oauthClients).where(eq(oauthClients.householdId, me.householdId))).map((c) => c.id);
      if (ids.length) await db.update(oauthTokens).set({ revokedAt: now() }).where(and(inArray(oauthTokens.clientId, ids), isNull(oauthTokens.revokedAt)));
    }
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'ai.settings', targetType: 'household', targetId: me.householdId, after: body, ip: request.ip });
    return aiView(db, me.householdId, now());
  });

  app.put<{ Params: { provider: string } }>('/api/ai/keys/:provider', { config: { access: 'system.manage' } }, async (request, reply) => {
    const provider = request.params.provider as ProviderId;
    if (!PROVIDER_IDS.includes(provider)) return reply.code(404).send({ error: 'not_found', detail: "Family time doesn't know that provider. Reload Settings and pick one from the list." });
    const body = parseBody(AiKeyInput, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    try {
      await saveKey(db, me.householdId, provider, body, now());
    } catch (err) {
      return reply.code(409).send({ error: 'key_not_saved', detail: (err as Error).message });
    }
    // The key itself is never written anywhere but its sealed column: not the audit, not the logs.
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'ai.key.saved', targetType: 'ai_provider', targetId: provider, after: { paidTier: body.paidTier, options: body.options, replaced: Boolean(body.key) }, ip: request.ip });
    return aiView(db, me.householdId, now());
  });

  app.delete<{ Params: { provider: string } }>('/api/ai/keys/:provider', { config: { access: 'system.manage' } }, async (request, reply) => {
    const provider = request.params.provider as ProviderId;
    if (!PROVIDER_IDS.includes(provider)) return reply.code(404).send({ error: 'not_found', detail: "Family time doesn't know that provider. Reload Settings and pick one from the list." });
    const me = request.auth!.person;
    await removeKey(db, me.householdId, provider);
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'ai.key.removed', targetType: 'ai_provider', targetId: provider, ip: request.ip });
    return aiView(db, me.householdId, now());
  });

  // Which features are ready, for the screens that offer them. No settings, no spend, no keys.
  app.get('/api/ai/features', { config: { access: 'status.view' } }, async (request): Promise<AiFeatures> => {
    const v = await aiView(db, request.auth!.person.householdId, now());
    const ready = (id: FeatureId) => {
      const f = v.features.find((x) => x.id === id)!.setting;
      return v.available && v.on && f.on && Boolean(f.provider && f.model);
    };
    return { control: ready('control'), suggestions: ready('suggestions'), summary: ready('summary') };
  });

  // ---- Plain-English control: words in, cards out. Nothing changes until a parent approves.
  app.post('/api/ai/control', { config: { access: 'control.change', rateLimit: { max: 20, windowMs: 10 * 60_000 } } }, async (request, reply): Promise<AiControlResult | FastifyReply> => {
    const body = parseBody(AiControlRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const t = now();
    const children = await db
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(and(eq(people.householdId, me.householdId), eq(people.role, 'child'), eq(people.active, true)));
    const apps = await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.householdId, me.householdId));
    const groups = await db.select({ id: serviceGroups.id, name: serviceGroups.name }).from(serviceGroups).where(eq(serviceGroups.householdId, me.householdId));
    const targets = [...apps.map((a) => ({ kind: 'service' as const, ...a })), ...groups.map((g) => ({ kind: 'group' as const, ...g }))];
    const tz = children[0] ? (await loadEconomy(db, children[0].id)).timeZone : 'Europe/London';
    const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(t);
    const r = await runFeature(db, me.householdId, 'control', now, (model) => proposeControl(model, { text: body.text, children, targets, today }), deps.model);
    if (!r.ok) return { ok: false, message: r.message, fallback: FEATURES.control.fallback };
    const made = [];
    for (const d of r.value.drafts) {
      const kind = d.request.type === 'pause' ? ('pause' as const) : ('override' as const);
      const proposal =
        kind === 'pause' ? { kind, payload: { duration: d.request.duration } } : { kind, payload: { request: d.request } };
      try {
        made.push(await createProposal(db, { householdId: me.householdId, childId: d.childId, source: 'ai', proposal, asked: body.text, summary: d.summary }, t));
      } catch (err) {
        if (!(err instanceof ProposalError)) throw err;
      }
    }
    if (made.length) deps.changes.emit(me.householdId);
    const note = made.length ? `${made.length === 1 ? 'A card is' : `${made.length} cards are`} waiting on Approvals. Nothing changes until someone approves.` : r.value.note || "That didn't turn into a change to approve. Try naming the child and the app.";
    return { ok: true, made, note };
  });

  // ---- Job ideas: suggestions to add by hand, never added by themselves
  app.get('/api/ai/job-ideas', { config: { access: 'rules.edit', rateLimit: { max: 20, windowMs: 10 * 60_000 } } }, async (request): Promise<JobIdeas> => {
    const me = request.auth!.person;
    const t = now();
    const have = await db.select({ title: tasks.title, ageBand: tasks.ageBand }).from(tasks).where(and(eq(tasks.householdId, me.householdId), eq(tasks.active, true)));
    const existing = have.map((x) => x.title);
    const ageBands = [...new Set(have.map((x) => x.ageBand).filter((a): a is string => Boolean(a)))];
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'Europe/London' }).format(t);
    const servers = await db.select().from(mcpServers).where(and(eq(mcpServers.householdId, me.householdId), eq(mcpServers.approved, true)));
    const server = servers.find((s) => (s.tools as unknown[]).length);
    const r = await runFeature(
      db,
      me.householdId,
      'suggestions',
      now,
      async (model) => {
        const weather = server ? await (deps.readWeather ?? readForecast)({ url: server.url, tools: server.tools as WeatherServer['tools'] }) : null;
        return suggestJobs(model, { ageBands, existing, month, weather });
      },
      deps.model,
    );
    const fresh = (ideas: typeof FALLBACK_IDEAS) => ideas.filter((i) => !existing.some((e) => e.toLowerCase() === i.title.toLowerCase()));
    if (!r.ok) return { ideas: fresh(FALLBACK_IDEAS), fromAi: false, message: r.message };
    return { ideas: fresh(r.value), fromAi: true, message: null };
  });

  // ---- The week's note for the family review: from totals only, or from the template
  app.get<Id>('/api/children/:id/week-note', { config: { access: 'rules.edit' } }, async (request, reply): Promise<WeekNote | FastifyReply> => {
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: "Family time can't find that child. Reload to see who's in your family now." });
    const t = now();
    const week = await weekSummary(db, ledger, child.id, t);
    const since = new Date(t.getTime() - 7 * 86_400_000);
    const [jobs] = await db
      .select({ n: sql<number>`count(*)::int`, money: sql<number>`coalesce(sum(case when ${completions.paid}->>'currency' = 'MONEY' then (${completions.paid}->>'amount')::int else 0 end), 0)::int` })
      .from(completions)
      .where(and(eq(completions.childId, child.id), eq(completions.status, 'approved'), gte(completions.decidedAt, since)));
    const totals: WeekTotals = {
      childId: child.id,
      name: child.name,
      allowance: minutes(week.allowanceMinutes),
      left: minutes(week.leftMinutes),
      used: minutes(week.usedMinutes),
      jobsDone: Number(jobs?.n ?? 0),
      earned: pence(Number(jobs?.money ?? 0)),
      bonus: week.lastWeek?.bonusPence ? pence(week.lastWeek.bonusPence) : null,
    };
    const r = await runFeature(db, me.householdId, 'summary', now, (model) => weeklySummary(model, totals), deps.model);
    return r.ok ? { text: r.value, fromAi: true } : { text: templateSummary(totals), fromAi: false };
  });

  // ---- Proposals: the parent's tap runs them, as that parent
  app.post<Id>('/api/proposals/:id/approve', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const me = request.auth!.person;
    try {
      const r = await approveProposal(db, ledger, { householdId: me.householdId, proposalId: request.params.id, by: { id: me.id, role: me.role }, ip: request.ip }, now());
      deps.changes.emit(me.householdId);
      await deps.notifyChange().catch(() => undefined);
      return r;
    } catch (err) {
      return failed(reply, err);
    }
  });

  app.post<Id>('/api/proposals/:id/decline', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const me = request.auth!.person;
    try {
      await declineProposal(db, { householdId: me.householdId, proposalId: request.params.id, by: me.id, ip: request.ip }, now());
      deps.changes.emit(me.householdId);
      return { ok: true };
    } catch (err) {
      return failed(reply, err);
    }
  });

  // ---- Apps connected over MCP (they sign in with OAuth; the owner allows each one)
  app.get('/api/mcp/clients', { config: { access: 'system.manage' } }, async (request): Promise<McpClientEntry[]> => {
    const rows = await db
      .select()
      .from(oauthClients)
      .where(and(eq(oauthClients.householdId, request.auth!.person.householdId), isNull(oauthClients.revokedAt)));
    return rows.map((c) => ({ id: c.id, name: c.name, clientUri: c.clientUri, scopes: c.scopes as string[], allowed: c.allowed, lastUsed: c.lastUsedAt?.toISOString() ?? null }));
  });

  // Removing an app ends its sign-ins at once: every token it holds stops working.
  app.delete<Id>('/api/mcp/clients/:id', { config: { access: 'system.manage' } }, async (request, reply) => {
    const me = request.auth!.person;
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const t = now();
    const [c] = await db
      .update(oauthClients)
      .set({ allowed: false, revokedAt: t })
      .where(and(eq(oauthClients.id, request.params.id), eq(oauthClients.householdId, me.householdId)))
      .returning({ id: oauthClients.id, name: oauthClients.name });
    if (!c) return reply.code(404).send({ error: 'not_found', detail: 'That app is not connected.' });
    await db.update(oauthTokens).set({ revokedAt: t }).where(and(eq(oauthTokens.clientId, c.id), isNull(oauthTokens.revokedAt)));
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.client.removed', targetType: 'oauth_client', targetId: c.id, after: { name: c.name }, ip: request.ip });
    return { ok: true };
  });

  // ---- MCP servers the app may call (the weather for job ideas)
  const serverView = (s: typeof mcpServers.$inferSelect): McpServerEntry => ({ id: s.id, name: s.name, url: s.url, approved: s.approved, tools: s.tools as McpServerEntry['tools'] });

  app.get('/api/mcp/servers', { config: { access: 'system.manage' } }, async (request) =>
    (await db.select().from(mcpServers).where(eq(mcpServers.householdId, request.auth!.person.householdId))).map(serverView),
  );

  app.post('/api/mcp/servers', { config: { access: 'system.manage' } }, async (request, reply) => {
    const body = parseBody(McpServerInput, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const [s] = await db.insert(mcpServers).values({ householdId: me.householdId, name: body.name, url: body.url, approved: body.approved, tools: body.tools, createdAt: now() }).returning();
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.server.added', targetType: 'mcp_server', targetId: s!.id, after: body, ip: request.ip });
    return reply.code(201).send(serverView(s!));
  });

  app.put<Id>('/api/mcp/servers/:id', { config: { access: 'system.manage' } }, async (request, reply) => {
    const body = parseBody(McpServerInput, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const [s] = await db
      .update(mcpServers)
      .set({ name: body.name, url: body.url, approved: body.approved, tools: body.tools })
      .where(and(eq(mcpServers.id, request.params.id), eq(mcpServers.householdId, me.householdId)))
      .returning();
    if (!s) return reply.code(404).send({ error: 'not_found', detail: 'That server is not on the list.' });
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.server.changed', targetType: 'mcp_server', targetId: s.id, after: body, ip: request.ip });
    return serverView(s);
  });

  app.delete<Id>('/api/mcp/servers/:id', { config: { access: 'system.manage' } }, async (request, reply) => {
    const me = request.auth!.person;
    if (!UUID.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const [s] = await db.delete(mcpServers).where(and(eq(mcpServers.id, request.params.id), eq(mcpServers.householdId, me.householdId))).returning({ id: mcpServers.id });
    if (!s) return reply.code(404).send({ error: 'not_found', detail: 'That server is not on the list.' });
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.server.removed', targetType: 'mcp_server', targetId: s.id, ip: request.ip });
    return { ok: true };
  });

}
