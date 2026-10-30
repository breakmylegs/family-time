// Today, in plain sentences, newest first: what parents did, what ended, and the household's
// routine pauses. Where a session ended, parents can tap how it went (calm, grumble, meltdown).
import { grants, loadRules, overrides, people, serviceGroups, services, sessionEndings, type Db } from '@family-time/db';
import { blocksOn, civilDate, clockLabel, durationWords, zonedTime } from '@family-time/domain';
import type { EndingRequest, HistoryEntry } from '@family-time/schemas';
import { and, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { audit } from '../audit.js';

export async function todayHistory(db: Db, householdId: string, childId: string, now: Date): Promise<HistoryEntry[]> {
  const { timeZone, schedules, childName } = await loadRules(db, childId, now);
  const today = civilDate(now, timeZone);
  const midnight = zonedTime(today.year, today.month, today.day, 0, timeZone);
  const t = now.getTime();

  const names = new Map<string, string>();
  for (const s of await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.householdId, householdId))) names.set(s.id, s.name);
  for (const g of await db.select({ id: serviceGroups.id, name: serviceGroups.name }).from(serviceGroups).where(eq(serviceGroups.householdId, householdId))) names.set(g.id, g.name);
  const what = (kind: string, id: string | null) => (kind === 'everything' ? 'everything' : (names.get(id ?? '') ?? 'an app'));

  const rows = await db
    .select({
      id: overrides.id,
      type: overrides.type,
      targetKind: overrides.targetKind,
      targetId: overrides.targetId,
      startsAt: overrides.startsAt,
      endsAt: overrides.endsAt,
      plannedEndsAt: overrides.plannedEndsAt,
      endedBy: overrides.endedBy,
      by: people.displayName,
    })
    .from(overrides)
    .innerJoin(people, eq(people.id, overrides.createdBy))
    .where(and(eq(overrides.childId, childId), lte(overrides.startsAt, now), or(gte(overrides.startsAt, midnight), gte(overrides.endsAt, midnight), isNull(overrides.endsAt))));
  const enderIds = [...new Set(rows.map((r) => r.endedBy).filter((x): x is string => Boolean(x)))];
  const enderName = new Map(
    enderIds.length ? (await db.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, enderIds))).map((p) => [p.id, p.name]) : [],
  );
  const moods = new Map(
    (await db.select({ ref: sessionEndings.ref, mood: sessionEndings.mood }).from(sessionEndings).where(eq(sessionEndings.childId, childId))).map((m) => [m.ref, m.mood]),
  );

  const out: HistoryEntry[] = [];
  const add = (at: Date, text: string, endingRef?: string) => {
    if (at.getTime() < midnight.getTime() || at.getTime() > t) return;
    out.push({ at: at.toISOString(), time: clockLabel(at, now, timeZone), text, ...(endingRef ? { ending: { ref: endingRef, mood: moods.get(endingRef) ?? null } } : {}) });
  };

  for (const r of rows) {
    const target = what(r.targetKind, r.targetId);
    // The end the parent chose, even when it was later ended early.
    const chosenEnd = r.plannedEndsAt ?? r.endsAt;
    const until = chosenEnd ? ` until ${clockLabel(chosenEnd, r.startsAt, timeZone)}` : r.type === 'pause' ? ' until someone resumes it' : '';
    // A Block or Pause starting is when a grumble tends to happen; for an Allow, it is the end.
    if (r.type === 'pause') add(r.startsAt, `${r.by} paused ${target}${until}.`, `start:${r.id}`);
    else if (r.type === 'block') add(r.startsAt, `${r.by} blocked ${target}${until}.`, `start:${r.id}`);
    else add(r.startsAt, `${r.by} allowed ${target}${until}.`);

    if (r.endsAt && r.endsAt.getTime() <= t) {
      const endingRef = r.type === 'allow' ? `end:${r.id}` : undefined;
      if (r.endedBy) {
        const who = enderName.get(r.endedBy) ?? 'Someone';
        add(r.endsAt, r.type === 'pause' ? `${who} resumed ${target}.` : `${who} set ${target} back to normal.`, endingRef);
      } else {
        const ended =
          r.type === 'pause'
            ? r.targetKind === 'everything'
              ? "The pause ended. Everything's back to normal."
              : `The pause on ${target} ended.`
            : r.type === 'block'
              ? `The block on ${target} ended.`
              : `${childName}'s ${target} time ended.`;
        add(r.endsAt, ended, endingRef);
      }
    }
  }

  // Planned sessions (and, from Phase 4, approved requests). A refunded one never happened.
  const sessions = await db
    .select({ id: grants.id, targetKind: grants.targetKind, targetId: grants.targetId, startsAt: grants.startsAt, endsAt: grants.endsAt, source: grants.source })
    .from(grants)
    .where(and(eq(grants.childId, childId), ne(grants.status, 'refunded'), gte(grants.endsAt, midnight), lte(grants.startsAt, now)));
  for (const g of sessions) {
    const target = what(g.targetKind, g.targetId);
    const minutes = Math.round((g.endsAt.getTime() - g.startsAt.getTime()) / 60_000);
    add(g.startsAt, g.source === 'planned' ? `${target} unlocked. ${childName} planned ${durationWords(minutes)}.` : `${target} unlocked. A parent said yes to ${childName}'s request.`);
    add(g.endsAt, `${childName}'s ${target} time ended.`, `end:${g.id}`);
  }

  for (const b of blocksOn(schedules, childId, today, timeZone)) {
    if (b.type !== 'pause') continue;
    // "Tea pause started", but never "Pause pause started".
    const label = b.label ?? 'Routine';
    const named = /pause$/i.test(label) ? label : `${label} pause`;
    add(b.start, `${named} started.`);
    add(b.end, `${named} ended.`);
  }

  // Newest first; for two lines in the same minute, the later one in the list wins.
  return out.map((e, i) => ({ e, i })).sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i).map((x) => x.e);
}

/** When the thing a ref names ended: an override's start or end, or a session's end. Only this child's. */
async function endingTime(db: Db, childId: string, ref: string): Promise<{ at: Date | null; targetType: string; id: string } | undefined> {
  const [edge, id] = ref.split(':') as ['start' | 'end', string];
  const o = (await db.select({ type: overrides.type, startsAt: overrides.startsAt, endsAt: overrides.endsAt }).from(overrides).where(and(eq(overrides.id, id), eq(overrides.childId, childId))))[0];
  if (o) {
    // The ones Today offers: a Block or Pause where it starts, an Allow where it ends.
    if ((edge === 'start') !== (o.type !== 'allow')) return undefined;
    return { at: edge === 'start' ? o.startsAt : o.endsAt, targetType: 'override', id };
  }
  if (edge !== 'end') return undefined;
  const g = (await db.select({ endsAt: grants.endsAt }).from(grants).where(and(eq(grants.id, id), eq(grants.childId, childId))))[0];
  return g ? { at: g.endsAt, targetType: 'grant', id } : undefined;
}

/** The conflict tap. One per ending: tapping again changes the answer. */
export async function recordEnding(db: Db, input: { householdId: string; childId: string; byPersonId: string; request: EndingRequest }, now: Date): Promise<boolean> {
  const ending = await endingTime(db, input.childId, input.request.ref);
  const endedAt = ending?.at;
  if (!ending || !endedAt || endedAt.getTime() > now.getTime()) return false;
  await db
    .insert(sessionEndings)
    .values({ childId: input.childId, ref: input.request.ref, endedAt, mood: input.request.mood, byPersonId: input.byPersonId, createdAt: now })
    .onConflictDoUpdate({ target: [sessionEndings.childId, sessionEndings.ref], set: { mood: input.request.mood, byPersonId: input.byPersonId } });
  await audit(db, {
    householdId: input.householdId,
    actor: { personId: input.byPersonId },
    action: 'control.ending',
    targetType: ending.targetType,
    targetId: ending.id,
    after: { ref: input.request.ref, mood: input.request.mood },
  });
  return true;
}
