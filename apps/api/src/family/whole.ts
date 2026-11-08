// The whole family (Phase 9, brief Part 14's transitions phase; research principle 7: "the whole
// family plays"). The parents' own screen time, self-reported each week, sits beside the child's;
// one cooperative challenge at a time, ticked by anyone, with no points and nothing lost if missed.
import { challengeTicks, DEFAULT_STOPPING_POINT_MINUTES, familyChallenges, households, parentScreenTime, people, SETTING_STOPPING_POINT, type Db } from '@family-time/db';
import { features, parseWeekReset, weekStarting } from '@family-time/domain';
import type { FamilyChallenge, WholeFamily } from '@family-time/schemas';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { audit } from '../audit.js';
import { when } from '../economy/words.js';
import { getSetting, setSetting } from '../settings.js';

export class FamilyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function household(db: Db, householdId: string) {
  const [hh] = await db.select().from(households).where(eq(households.id, householdId));
  if (!hh) throw new FamilyError('not_found', 'No such family.', 404);
  return hh;
}

/** The household week `now` falls in, and the three before: `2026-11-08` and so on, newest first. */
async function weeks(db: Db, householdId: string, now: Date, count: number) {
  const hh = await household(db, householdId);
  const reset = parseWeekReset(hh.weekResets);
  const out: { week: string; start: Date }[] = [];
  let w = weekStarting(now, reset, hh.timezone);
  for (let i = 0; i < count; i++) {
    out.push({ week: w.date, start: w.start });
    w = weekStarting(new Date(w.start.getTime() - 1), reset, hh.timezone);
  }
  return { hh, weeks: out };
}

export async function stoppingPoint(db: Db, householdId: string): Promise<number> {
  const v = await getSetting<number>(db, householdId, SETTING_STOPPING_POINT);
  return typeof v === 'number' ? v : DEFAULT_STOPPING_POINT_MINUTES;
}

async function currentChallenge(db: Db, householdId: string, week: string, now: Date, timeZone: string): Promise<FamilyChallenge | null> {
  const [c] = await db
    .select()
    .from(familyChallenges)
    .where(and(eq(familyChallenges.householdId, householdId), eq(familyChallenges.week, week), isNull(familyChallenges.endedAt)))
    .orderBy(desc(familyChallenges.createdAt))
    .limit(1);
  if (!c) return null;
  const ticks = await db
    .select({ at: challengeTicks.at, by: people.displayName })
    .from(challengeTicks)
    .innerJoin(people, eq(people.id, challengeTicks.byPersonId))
    .where(eq(challengeTicks.challengeId, c.id))
    .orderBy(desc(challengeTicks.at));
  return { id: c.id, title: c.title, target: c.target, done: Math.min(ticks.length, c.target), ticks: ticks.map((t) => ({ by: t.by, when: when(t.at, now, timeZone) })) };
}

/** `parentsShown`: false for carers, who see the challenge but not the parents' own numbers. */
export async function wholeFamily(db: Db, householdId: string, meId: string, now: Date, parentsShown = true): Promise<WholeFamily> {
  const { hh, weeks: ws } = await weeks(db, householdId, now, 4);
  const parents = !parentsShown ? [] : await db
    .select({ id: people.id, name: people.displayName })
    .from(people)
    .where(and(eq(people.householdId, householdId), inArray(people.role, ['owner', 'parent']), eq(people.active, true)));
  const rows = parents.length
    ? await db.select().from(parentScreenTime).where(and(inArray(parentScreenTime.personId, parents.map((p) => p.id)), inArray(parentScreenTime.week, ws.map((w) => w.week))))
    : [];
  const label = (start: Date, i: number) => (i === 0 ? 'This week' : `Week from ${start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: hh.timezone })}`);
  return {
    on: features(hh.pilotPhase).transitions,
    stoppingPointMinutes: await stoppingPoint(db, householdId),
    parents: parents
      .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)))
      .map((p) => ({
        id: p.id,
        name: p.name,
        me: p.id === meId,
        weeks: ws.map((w, i) => ({ week: w.week, label: label(w.start, i), minutes: rows.find((r) => r.personId === p.id && r.week === w.week)?.minutes ?? null })),
      })),
    challenge: await currentChallenge(db, householdId, ws[0]!.week, now, hh.timezone),
  };
}

/** For the kiosk: the challenge, and the parents' total this week if any parent has said. */
export async function familyForKiosk(db: Db, householdId: string, now: Date) {
  const { hh, weeks: ws } = await weeks(db, householdId, now, 1);
  if (!features(hh.pilotPhase).transitions) return null;
  const parents = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.householdId, householdId), inArray(people.role, ['owner', 'parent']), eq(people.active, true)));
  const rows = parents.length ? await db.select({ minutes: parentScreenTime.minutes }).from(parentScreenTime).where(and(inArray(parentScreenTime.personId, parents.map((p) => p.id)), eq(parentScreenTime.week, ws[0]!.week))) : [];
  const c = await currentChallenge(db, householdId, ws[0]!.week, now, hh.timezone);
  return { challenge: c ? { title: c.title, target: c.target, done: c.done } : null, parentsMinutes: rows.length ? rows.reduce((n, r) => n + r.minutes, 0) : null };
}

export async function setMyScreenTime(db: Db, input: { householdId: string; personId: string; minutes: number }, now: Date) {
  const { weeks: ws } = await weeks(db, input.householdId, now, 1);
  const week = ws[0]!.week;
  await db
    .insert(parentScreenTime)
    .values({ personId: input.personId, week, minutes: input.minutes, updatedAt: now })
    .onConflictDoUpdate({ target: [parentScreenTime.personId, parentScreenTime.week], set: { minutes: input.minutes, updatedAt: now } });
}

export async function setChallenge(db: Db, input: { householdId: string; by: string; title: string; target: number }, now: Date) {
  const { weeks: ws } = await weeks(db, input.householdId, now, 1);
  // One at a time: a new challenge ends the one before, which keeps its ticks.
  await db.update(familyChallenges).set({ endedAt: now }).where(and(eq(familyChallenges.householdId, input.householdId), isNull(familyChallenges.endedAt)));
  const [c] = await db.insert(familyChallenges).values({ householdId: input.householdId, title: input.title, target: input.target, week: ws[0]!.week, createdBy: input.by, createdAt: now }).returning({ id: familyChallenges.id });
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'family.challenge.set', targetType: 'challenge', targetId: c!.id, after: { title: input.title, target: input.target } });
}

export async function endChallenge(db: Db, input: { householdId: string; by: string }, now: Date) {
  await db.update(familyChallenges).set({ endedAt: now }).where(and(eq(familyChallenges.householdId, input.householdId), isNull(familyChallenges.endedAt)));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'family.challenge.ended', targetType: 'household', targetId: input.householdId });
}

/** "We did it": once more towards this week's challenge. Past the target it is already done. */
export async function tickChallenge(db: Db, input: { householdId: string; by: string }, now: Date) {
  const { hh, weeks: ws } = await weeks(db, input.householdId, now, 1);
  if (!features(hh.pilotPhase).transitions) throw new FamilyError('no_challenge', "There isn't a family challenge this week.", 404);
  const c = await currentChallenge(db, input.householdId, ws[0]!.week, now, hh.timezone);
  if (!c) throw new FamilyError('no_challenge', "There isn't a family challenge this week.", 404);
  if (c.done >= c.target) return c;
  await db.insert(challengeTicks).values({ challengeId: c.id, byPersonId: input.by, at: now });
  return (await currentChallenge(db, input.householdId, ws[0]!.week, now, hh.timezone))!;
}

export async function setStoppingPoint(db: Db, input: { householdId: string; by: string; minutes: number }) {
  await setSetting(db, input.householdId, SETTING_STOPPING_POINT, input.minutes);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'family.stopping_point', targetType: 'household', targetId: input.householdId, after: { minutes: input.minutes } });
}
