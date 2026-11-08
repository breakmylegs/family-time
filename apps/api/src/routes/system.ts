// The owner's System page, the audit log, export, release notes, maintenance mode and the pilot
// measures (Phase 8, ADR 0017).
import { adguardSync, aiSettings, auditEvents, devices, households, lastBackup, maintenance, people, RETENTION, type Db } from '@family-time/db';
import { features, type PilotPhase } from '@family-time/domain';
import { signerStatus, activeContract } from '@family-time/ledger';
import type { AuditPage, MaintenanceState, SystemView } from '@family-time/schemas';
import { and, desc, eq, isNull, like, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { mcpOn } from '../ai/store.js';
import { audit } from '../audit.js';
import type { BuildInfo } from '../build.js';
import { findChild } from '../control/commands.js';
import { readiness } from '../health.js';
import { theHousehold } from '../settings.js';
import { exportHousehold } from '../system/export.js';
import { measuresCsv, pilotMeasures, toCsv } from '../system/measures.js';
import { releases } from '../system/releases.js';

export interface SystemRouteDeps {
  db: Db;
  build: BuildInfo;
  now: () => Date;
  ledgerAdapter: 'postgres' | 'besu';
  adguardSetUp: boolean;
}

const PAGE = 50;

export async function systemRoutes(app: FastifyInstance, deps: SystemRouteDeps): Promise<void> {
  const { db, now } = deps;

  // Public: the sign-in screen shows it too, so nobody wonders why a change won't save.
  app.get('/api/maintenance', { config: { access: 'public' } }, async (): Promise<MaintenanceState> => {
    const hh = await theHousehold(db);
    return hh ? maintenance(db, hh.id) : { on: false, message: null, since: null };
  });

  app.get('/api/system', { config: { access: 'system.manage' } }, async (request): Promise<SystemView> => {
    const householdId = request.auth!.person.householdId;
    const [hh] = await db.select({ phase: households.pilotPhase }).from(households).where(eq(households.id, householdId));
    const phase = (hh?.phase ?? 'baseline') as PilotPhase;
    const sync = await db
      .select({ label: devices.label, state: adguardSync.state, confirmedAt: adguardSync.confirmedAt, lastError: adguardSync.lastError })
      .from(devices)
      .leftJoin(adguardSync, eq(adguardSync.deviceId, devices.id))
      .where(and(eq(devices.householdId, householdId), isNull(devices.removedAt)));
    const contract = deps.ledgerAdapter === 'besu' ? await activeContract(db) : null;
    const queue = deps.ledgerAdapter === 'besu' ? await signerStatus(db) : null;
    const ai = (await db.select({ on: aiSettings.on }).from(aiSettings).where(eq(aiSettings.householdId, householdId)))[0];
    const releaseList = releases();
    return {
      version: { app: releaseList[0]?.version ?? 'unknown', commit: deps.build.commit, builtAt: deps.build.builtAt, schema: deps.build.schema },
      uptimeSeconds: Math.round(process.uptime()),
      readiness: await readiness({ db, build: deps.build, now }),
      adguard: {
        // Set up when the server can read AdGuard, or any device has been through it.
        setUp: deps.adguardSetUp || sync.some((d) => d.state !== null),
        devices: sync.map((d) => ({ label: d.label, state: d.state ?? 'never', confirmedAt: d.confirmedAt?.toISOString() ?? null, lastError: d.lastError })),
      },
      ledger: { adapter: deps.ledgerAdapter, contract: contract?.address ?? null, waiting: (queue?.pending ?? 0) + (queue?.sent ?? 0), failed: queue?.failed ?? 0 },
      lastBackup: await lastBackup(db, householdId),
      maintenance: await maintenance(db, householdId),
      pilot: { phase, features: { ...features(phase) } },
      ai: { on: Boolean(ai?.on), mcp: await mcpOn(db, householdId) },
      retention: [...RETENTION.map((r) => ({ what: r.what })), { what: 'Kiosk photos, 30 days after the job is answered' }, { what: 'The audit log, after two years' }, { what: 'Never deleted: the points and money history, people and the family rules' }],
      releases: releaseList,
    };
  });

  // The audit log, newest first, 50 at a time. `action` filters by the start of the action name.
  const auditRows = async (householdId: string, q: { action?: string; before?: string }, limit: number) => {
    const conditions = [or(eq(auditEvents.householdId, householdId), isNull(auditEvents.householdId))];
    if (q.action && /^[a-z0-9_.-]{1,40}$/i.test(q.action)) conditions.push(like(auditEvents.action, `${q.action}%`));
    if (q.before && !Number.isNaN(Date.parse(q.before))) conditions.push(lt(auditEvents.at, new Date(q.before)));
    return db
      .select({ e: auditEvents, name: people.displayName })
      .from(auditEvents)
      .leftJoin(people, eq(people.id, auditEvents.actorPersonId))
      .where(and(...conditions))
      .orderBy(desc(auditEvents.at))
      .limit(limit);
  };
  const entryOf = (r: Awaited<ReturnType<typeof auditRows>>[number]) => ({
    id: r.e.id,
    at: r.e.at.toISOString(),
    by: r.name ?? r.e.actorLabel ?? 'Someone not signed in',
    action: r.e.action,
    target: r.e.targetType ? `${r.e.targetType}${r.e.targetId ? ` ${r.e.targetId}` : ''}` : null,
    detail: r.e.after == null ? null : JSON.stringify(r.e.after).slice(0, 500),
  });

  app.get<{ Querystring: { action?: string; before?: string } }>('/api/audit', { config: { access: 'system.manage' } }, async (request): Promise<AuditPage> => {
    const rows = await auditRows(request.auth!.person.householdId, request.query, PAGE + 1);
    const entries = rows.slice(0, PAGE).map(entryOf);
    return { entries, older: rows.length > PAGE ? entries[entries.length - 1]!.at : null };
  });

  app.get<{ Querystring: { action?: string } }>('/api/audit.csv', { config: { access: 'system.manage' } }, async (request, reply) => {
    const rows = (await auditRows(request.auth!.person.householdId, request.query, 10_000)).map(entryOf);
    const csv = toCsv([['When (UTC)', 'Who', 'Action', 'Target', 'Detail'], ...rows.map((e) => [e.at, e.by, e.action, e.target ?? '', e.detail ?? ''])]);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="family-time-audit.csv"').send(csv);
  });

  app.get('/api/export', { config: { access: 'system.manage', rateLimit: { max: 5, windowMs: 10 * 60_000 } } }, async (request, reply) => {
    const me = request.auth!.person;
    const t = now();
    const data = await exportHousehold(db, me.householdId, t);
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'system.export', ip: request.ip });
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="family-time-export-${t.toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  // ---- Pilot measures, for parents (brief Part 14)
  app.get<{ Params: { id: string } }>('/api/children/:id/measures', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const child = await findChild(db, request.auth!.person.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: "Family time can't find that child. Reload to see who's in your family now." });
    return pilotMeasures(db, child.id, now());
  });

  app.get<{ Params: { id: string } }>('/api/children/:id/measures.csv', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const child = await findChild(db, request.auth!.person.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found' });
    const csv = measuresCsv(await pilotMeasures(db, child.id, now()), child.name);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="pilot-measures.csv"`).send(csv);
  });
}
