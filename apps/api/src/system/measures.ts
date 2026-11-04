// The pilot's measures (brief Part 14), week by week for one child: what the parents look at in the
// family review and can download. Counts only, from what Family time already keeps; nothing here
// is shown to the child.
import { completions, devices, ideas, ledgerEntries, loadEconomy, loadRules, people, services, sessionEndings, usageMinutes, type Db } from '@family-time/db';
import { addDays, blocksOn, civilDate, weekStarting } from '@family-time/domain';
import type { PilotMeasures, PilotWeek } from '@family-time/schemas';
import { and, count, countDistinct, eq, gte, lt, sql } from 'drizzle-orm';

/** A minute counts as use when a device asked for the app at least this often (as on Control). */
const BUSY_MINUTE_QUERIES = 3;
/** The pilot runs 16 weeks; a couple more cover the weeks before it started. */
export const MEASURE_WEEKS = 18;

export async function pilotMeasures(db: Db, childId: string, now: Date, weeks = MEASURE_WEEKS): Promise<PilotMeasures> {
  const e = await loadEconomy(db, childId);
  const rules = await loadRules(db, childId, now);
  const [child] = await db.select({ createdAt: people.createdAt }).from(people).where(eq(people.id, childId));
  const out: PilotWeek[] = [];
  let w = weekStarting(now, e.weekReset, e.timeZone);
  for (let i = 0; i < weeks; i++) {
    const from = w.start;
    const to = w.next;
    out.push(await week(db, childId, from, to, rules.schedules, e.timeZone));
    if (child && from.getTime() <= child.createdAt.getTime()) break;
    w = weekStarting(new Date(from.getTime() - 1), e.weekReset, e.timeZone);
  }
  return { childId, phase: e.pilotPhase, weeks: out };
}

async function week(db: Db, childId: string, from: Date, to: Date, schedules: Parameters<typeof blocksOn>[0], timeZone: string): Promise<PilotWeek> {
  const inWeek = (col: Parameters<typeof gte>[0]) => and(gte(col, from), lt(col, to));
  const busy = and(eq(devices.childId, childId), gte(usageMinutes.queries, BUSY_MINUTE_QUERIES), inWeek(usageMinutes.minute));

  const byApp = await db
    .select({ app: services.name, minutes: countDistinct(usageMinutes.minute) })
    .from(usageMinutes)
    .innerJoin(devices, eq(devices.id, usageMinutes.deviceId))
    .innerJoin(services, eq(services.id, usageMinutes.serviceId))
    .where(busy)
    .groupBy(services.name);

  // Minutes in use during wind-down and bedtime, from the child's own schedule for each day.
  const used = (await db.selectDistinct({ minute: usageMinutes.minute }).from(usageMinutes).innerJoin(devices, eq(devices.id, usageMinutes.deviceId)).where(busy)).map((r) => r.minute.getTime());
  let windDown = 0;
  let bedtime = 0;
  if (used.length) {
    // From the day before, because a bedtime that starts on Sunday evening runs into Monday.
    let day = addDays(civilDate(from, timeZone), -1);
    const last = civilDate(new Date(to.getTime() - 1), timeZone);
    const blocks = [];
    for (let n = 0; n < 9; n++) {
      blocks.push(...blocksOn(schedules, childId, day, timeZone).filter((b) => b.type === 'wind-down' || b.type === 'bed'));
      if (day.year === last.year && day.month === last.month && day.day === last.day) break;
      day = addDays(day, 1);
    }
    for (const m of used) {
      const b = blocks.find((x) => x.start.getTime() <= m && m < x.end.getTime());
      if (b?.type === 'wind-down') windDown++;
      else if (b?.type === 'bed') bedtime++;
    }
  }

  const [converted] = await db
    .select({ minutes: sql<number>`coalesce(sum(case when coalesce((${ledgerEntries.data}->>'bonusPence')::int, 0) > 0 then coalesce((${ledgerEntries.data}->>'minutesLeft')::int, 0) else 0 end), 0)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.childId, childId), eq(ledgerEntries.kind, 'close'), inWeek(ledgerEntries.at)));

  const approved = and(eq(completions.childId, childId), eq(completions.status, 'approved'), inWeek(completions.decidedAt));
  const [jobs] = await db.select({ n: count(), different: countDistinct(completions.taskId) }).from(completions).where(approved);
  const [newIdeas] = await db.select({ n: count() }).from(ideas).where(and(eq(ideas.childId, childId), inWeek(ideas.createdAt)));

  const moods = await db.select({ mood: sessionEndings.mood, n: count() }).from(sessionEndings).where(and(eq(sessionEndings.childId, childId), inWeek(sessionEndings.endedAt))).groupBy(sessionEndings.mood);
  const mood = (m: string) => Number(moods.find((x) => x.mood === m)?.n ?? 0);

  return {
    week: from.toISOString().slice(0, 10),
    label: `Week from ${from.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone })}`,
    minutesByApp: byApp.map((r) => ({ app: r.app, minutes: Number(r.minutes) })).sort((a, b) => b.minutes - a.minutes),
    unusedMinutesConverted: Number(converted?.minutes ?? 0),
    offlineVariety: Number(jobs?.different ?? 0) + Number(newIdeas?.n ?? 0),
    endings: { calm: mood('calm'), grumble: mood('grumble'), meltdown: mood('meltdown') },
    windDownMinutes: windDown,
    bedtimeMinutes: bedtime,
    jobsApproved: Number(jobs?.n ?? 0),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // A cell that starts like a formula is quoted as text, so a spreadsheet never runs it.
  const safe = /^\s*[=+\-@]/.test(s) || /^[\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function measuresCsv(m: PilotMeasures, childName: string): string {
  const apps = [...new Set(m.weeks.flatMap((w) => w.minutesByApp.map((a) => a.app)))].sort();
  const head = ['Child', 'Week starting', ...apps.map((a) => `${a} minutes`), 'Unused minutes converted', 'Different jobs and ideas', 'Calm endings', 'Grumble endings', 'Meltdown endings', 'Minutes in wind-down', 'Minutes at bedtime', 'Jobs approved'];
  const rows = m.weeks.map((w) => [childName, w.week, ...apps.map((a) => w.minutesByApp.find((x) => x.app === a)?.minutes ?? 0), w.unusedMinutesConverted, w.offlineVariety, w.endings.calm, w.endings.grumble, w.endings.meltdown, w.windDownMinutes, w.bedtimeMinutes, w.jobsApproved]);
  return toCsv([head, ...rows]);
}
