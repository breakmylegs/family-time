// The mock's economy for the demo family: the week's allowance with 5 h 30 left, last week's 20p
// bonus, a reduction plan, a savings goal, jobs, and the three things the mock's Approvals screen
// is waiting on. Never part of the image.
import { allowances, completions, goals, grants, households, ledgerEntries, reductionPlans, requests, tasks, type Db } from '@family-time/db';
import { postgresLedger } from '@family-time/ledger';
import { eq, inArray, notInArray, sql } from 'drizzle-orm';

const at = (iso: string) => new Date(iso);
const today = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00Z`);

interface Family {
  householdId: string;
  mum: { id: string };
  dad: { id: string };
  ollie: { id: string };
  jamie: { id: string };
}

export async function seedEconomy(db: Db, family: Family, ids: { roblox: string; youtubeGrant: string }) {
  const { householdId, mum, ollie, jamie } = family;
  const ledger = postgresLedger(db);
  await db.update(households).set({ pilotPhase: 'taper' }).where(eq(households.id, householdId));
  await db.insert(allowances).values([
    { childId: ollie.id, weeklyMinutes: 420 },
    { childId: jamie.id, weeklyMinutes: 420 },
  ]);
  await db.insert(reductionPlans).values({ childId: ollie.id, stepMinutes: 30, everyWeeks: 4, floorMinutes: 300, nextStepOn: '2026-11-08' });
  await db.insert(goals).values({ childId: ollie.id, title: 'bike lights', targetPence: 300 });

  const job = (title: string, picture: string, rewardType: 'money' | 'flex' | 'time' | 'praise', amount: number, extra: Partial<typeof tasks.$inferInsert> = {}) =>
    db
      .insert(tasks)
      .values({ householdId, title, picture, rewardType, amount, createdBy: mum.id, ...extra })
      .returning()
      .then((r) => r[0]!);
  const dishes = await job('Emptied the dishwasher', 'dishes', 'money', 50, { needsPhoto: true });
  const tidy = await job('Tidied the bedroom', 'bed', 'flex', 20);
  await job('Read for half an hour', 'book', 'time', 15);
  const lego = await job('Built something with LEGO', 'lego', 'praise', 0);
  await job('Put the bins out', 'bin', 'money', 30, { recurrence: { kind: 'weekly', weekdays: [2, 5] } });

  const base = { householdId, childId: ollie.id };
  // Last week: 7 h, 6 h used, closed with 1 h left: 20p.
  await ledger.allocateAllowance({ ...base, ref: `allowance:${ollie.id}:2026-10-18`, reason: "This week's time", at: at('2026-10-18T17:00:00Z'), minutes: 420, data: { week: '2026-10-18' } });
  await ledger.spendTime({ ...base, ref: 'seed:last-week', reason: 'Planned screen time', at: at('2026-10-22T16:00:00Z'), minutes: 360 });
  await ledger.award({ ...base, ref: 'seed:dishes-last-week', reason: 'Emptied the dishwasher', at: at('2026-10-21T17:00:00Z'), by: mum.id, currency: 'MONEY', amount: 50 });
  await ledger.closeWeek({ ...base, ref: `close:${ollie.id}:2026-10-18`, reason: 'Unused time, week of 18 October', at: at('2026-10-25T18:00:00Z'), bonus: { pencePerBlock: 10, weeklyCapPence: 100 }, data: { week: '2026-10-18' } });
  // This week: 7 h, an hour on Sunday, and YouTube planned for 18:30.
  await ledger.allocateAllowance({ ...base, ref: `allowance:${ollie.id}:2026-10-25`, reason: "This week's time", at: at('2026-10-25T18:00:00Z'), minutes: 420, data: { week: '2026-10-25' } });
  await ledger.spendTime({ ...base, ref: 'seed:sunday', reason: 'Planned screen time', at: at('2026-10-25T18:30:00Z'), minutes: 60 });
  await ledger.spendTime({ ...base, ref: `grant:${ids.youtubeGrant}`, reason: 'Planned screen time', at: today('16:10'), minutes: 30, data: { grantId: ids.youtubeGrant } });
  const [approvedTidy] = await db.insert(completions).values({ taskId: tidy.id, childId: ollie.id, loggedAt: at('2026-10-25T10:00:00Z'), status: 'approved', note: 'Thank you', decidedBy: mum.id, decidedAt: at('2026-10-25T10:30:00Z') }).returning();
  await ledger.award({ ...base, ref: `completion:${approvedTidy!.id}:seed`, reason: 'Tidied the bedroom', at: at('2026-10-25T10:30:00Z'), by: mum.id, currency: 'FLEX', amount: 20 });
  await ledger.allocateAllowance({ householdId, childId: jamie.id, ref: `allowance:${jamie.id}:2026-10-25`, reason: "This week's time", at: at('2026-10-25T18:00:00Z'), minutes: 420, data: { week: '2026-10-25' } });

  // Waiting for Mum, as in the mock.
  await db.insert(completions).values([
    { taskId: dishes.id, childId: ollie.id, loggedAt: today('17:05') },
    { taskId: lego.id, childId: ollie.id, loggedAt: today('16:20') },
  ]);
  await db.insert(requests).values({ childId: ollie.id, targetKind: 'service', targetId: ids.roblox, startsAt: today('19:00'), minutes: 30, detail: 'Can I play Roblox with Jamie at 19:00?', askedAt: today('18:20') });

  return snapshot(db);
}

/** What the demo starts with, so the end-to-end tests can put it back between tests. */
async function snapshot(db: Db) {
  const [seq] = await db.select({ max: sql<number>`coalesce(max(${ledgerEntries.seq}), 0)::int` }).from(ledgerEntries);
  return {
    maxSeq: Number(seq?.max ?? 0),
    tasks: await db.select().from(tasks),
    completions: await db.select().from(completions),
    requests: await db.select().from(requests),
    grants: (await db.select({ id: grants.id }).from(grants)).map((g) => g.id),
    allowances: await db.select().from(allowances),
    plans: await db.select().from(reductionPlans),
    goals: await db.select().from(goals),
    households: await db.select().from(households),
  };
}

export type EconomySnapshot = Awaited<ReturnType<typeof snapshot>>;

/**
 * Back to the snapshot. The ledger is append-only by a trigger; this dev-only reset switches the
 * trigger off for one statement on PGlite, which is the test database, never a real one.
 */
export async function resetEconomy(db: Db, client: { exec: (sql: string) => Promise<unknown> }, s: EconomySnapshot) {
  await client.exec(`alter table ledger_entries disable trigger ledger_entries_no_update_or_delete;
    delete from ledger_entries where seq > ${Number(s.maxSeq)};
    alter table ledger_entries enable trigger ledger_entries_no_update_or_delete;`);
  const keep = (rows: { id: string }[]) => rows.map((r) => r.id);
  await db.update(requests).set({ grantId: null });
  await db.delete(requests).where(notInArray(requests.id, keep(s.requests)));
  await db.delete(completions).where(notInArray(completions.id, keep(s.completions)));
  await db.delete(grants).where(notInArray(grants.id, s.grants));
  await db.delete(tasks).where(notInArray(tasks.id, keep(s.tasks)));
  for (const t of s.tasks) await db.update(tasks).set(t).where(eq(tasks.id, t.id));
  for (const c of s.completions) await db.update(completions).set(c).where(eq(completions.id, c.id));
  for (const r of s.requests) await db.update(requests).set(r).where(eq(requests.id, r.id));
  await db.update(grants).set({ status: 'active' }).where(inArray(grants.id, s.grants));
  for (const a of s.allowances) await db.update(allowances).set(a).where(eq(allowances.childId, a.childId));
  await db.delete(reductionPlans).where(notInArray(reductionPlans.childId, s.plans.map((p) => p.childId)));
  for (const p of s.plans) await db.update(reductionPlans).set(p).where(eq(reductionPlans.childId, p.childId));
  await db.delete(goals).where(notInArray(goals.id, keep(s.goals)));
  for (const g of s.goals) await db.update(goals).set(g).where(eq(goals.id, g.id));
  for (const h of s.households) await db.update(households).set(h).where(eq(households.id, h.id));
}
