// Phase 11 (docs/plans/phase-11.md): the platform setup checklist by age band, what the child did
// away from screens and the praise sent back, the things they are learning or can do, the rules
// they ask about, and the parents' own estimates for the pilot. Praise, never points: nothing here
// touches the ledger. A child's page is their own; a kiosk PIN keeps it from a sibling on a shared tablet.
import { households, journal, moodChecks, people, ruleAsks, skills, unmanagedTime, type Db } from '@family-time/db';
import { parseWeekReset, weekStarting } from '@family-time/domain';
import { AGE_BANDS, PICTURES, type AgeBand, type ChildExtras, type KioskMine, type SetupChecklist } from '@family-time/schemas';
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, or } from 'drizzle-orm';
import { audit } from '../audit.js';
import { when } from '../economy/words.js';

export class ExtrasError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Things the child adds from the kiosk, at most: enough for real use, too few to flood a parent. */
export const MAX_JOURNAL_PER_DAY = 10;
export const MAX_SKILLS = 12;
export const MAX_OPEN_RULE_ASKS = 3;
/** How long an answered question stays on the kiosk and on Family. */
const ANSWERED_DAYS = 14;
/** How far back Family shows the journal. */
const JOURNAL_DAYS = 14;

// ---------------------------------------------------------------------------------------------
// The platform setup checklist (research 03-motivation: "YouTube autoplay off and Roblox daily
// limit setup checklist", the age bands table, UK CMO 2019 on bedrooms and mealtimes). These are
// things parents do outside Family time, in each app's own settings, so Family time only keeps
// the ticks.

interface ChecklistDef {
  id: string;
  /** Which age bands it is for; `null` (no band chosen yet) sees the items marked for everyone. */
  bands: readonly AgeBand[];
  title: (band: AgeBand | null) => string;
  detail: (band: AgeBand | null) => string;
}

const ALL = AGE_BANDS;
const UNDER_14 = ['5-7', '8-10', '11-13'] as const;

export const CHECKLIST: readonly ChecklistDef[] = [
  {
    id: 'youtube-autoplay',
    bands: ALL,
    title: (b) => (b === '5-7' ? 'YouTube Kids, with autoplay off' : b === '14+' ? 'Talk about YouTube autoplay' : 'Supervised YouTube, with autoplay off'),
    detail: (b) =>
      b === '14+'
        ? 'Autoplay starts the next video without anyone choosing it. Agree together whether to turn it off.'
        : "In a supervised account, parents can turn autoplay off so it can't be turned back on. The next video then waits to be chosen, which can make stopping easier.",
  },
  {
    id: 'roblox-limit',
    bands: ['8-10', '11-13', '14+'],
    title: (b) => (b === '14+' ? 'Agree a Roblox limit together' : 'A daily limit in Roblox'),
    detail: (b) =>
      b === '14+'
        ? "Roblox's own Parental Controls can set a daily limit. At this age, agree it together rather than set it alone."
        : "Link your own Roblox account in Roblox's Parental Controls, then set a daily limit. In the first week, check that the limit really stops play.",
  },
  {
    id: 'device-limits',
    bands: UNDER_14,
    title: () => "The device's own controls as a backstop",
    detail: () => "Turn on the tablet's own screen time controls, and make new apps and account changes need your say-so. That makes it harder to add apps that get round home Wi-Fi limits. Family time works on your home Wi-Fi only; these work everywhere.",
  },
  {
    id: 'bedroom',
    bands: ALL,
    title: (b) => (b === '14+' ? 'Agree where devices sleep' : 'Devices sleep outside the bedroom'),
    detail: () => 'Screens in the bedroom at night are linked to less sleep and poorer sleep. Agree a place for devices to charge overnight, away from bedrooms.',
  },
  {
    id: 'mealtimes',
    bands: ALL,
    title: () => 'Screen-free mealtimes',
    detail: () => "The UK's Chief Medical Officers suggest screen-free mealtimes. That means grown-ups' phones too.",
  },
  {
    id: 'watch-together',
    bands: ['5-7'],
    title: () => 'Watch together when you can',
    detail: () => 'At this age, watching or playing alongside them gives you a chance to talk about what you see.',
  },
  {
    id: 'explain-monitoring',
    bands: ['11-13', '14+'],
    title: () => 'Explain what Family time can see',
    detail: () => 'Show them what parents can see and why. The kiosk lists it under What Mum and Dad can see.',
  },
];

const FOR_EVERYONE = new Set(CHECKLIST.filter((c) => c.bands.length === ALL.length).map((c) => c.id));

function itemsFor(band: AgeBand | null, done: readonly string[]) {
  return CHECKLIST.filter((c) => (band ? c.bands.includes(band) : FOR_EVERYONE.has(c.id))).map((c) => ({ id: c.id, title: c.title(band), detail: c.detail(band), done: done.includes(c.id) }));
}

async function child(db: Db, householdId: string, childId: string) {
  const [c] = await db
    .select({ id: people.id, name: people.displayName, ageBand: people.ageBand, setupDone: people.setupDone })
    .from(people)
    .where(and(eq(people.id, childId), eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)));
  if (!c) throw new ExtrasError('not_found', "Family time can't find that child. Reload to see who's in your family now.", 404);
  return c;
}

export async function setupChecklists(db: Db, householdId: string): Promise<SetupChecklist[]> {
  const rows = await db
    .select({ id: people.id, name: people.displayName, ageBand: people.ageBand, setupDone: people.setupDone })
    .from(people)
    .where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)))
    .orderBy(asc(people.displayName));
  return rows.map((r) => ({ childId: r.id, name: r.name, ageBand: r.ageBand ?? null, items: itemsFor(r.ageBand ?? null, r.setupDone) }));
}

export async function setAgeBand(db: Db, input: { householdId: string; childId: string; by: string; ageBand: AgeBand | null }) {
  const c = await child(db, input.householdId, input.childId);
  await db.update(people).set({ ageBand: input.ageBand }).where(eq(people.id, c.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'child.age_band', targetType: 'person', targetId: c.id, before: { ageBand: c.ageBand }, after: { ageBand: input.ageBand } });
}

export async function tickChecklist(db: Db, input: { householdId: string; childId: string; by: string; itemId: string; done: boolean }) {
  if (!CHECKLIST.some((c) => c.id === input.itemId)) throw new ExtrasError('not_found', "That item isn't on the checklist any more. Open Set-up again to see the latest list.", 404);
  const c = await child(db, input.householdId, input.childId);
  const next = input.done ? [...new Set([...c.setupDone, input.itemId])] : c.setupDone.filter((x) => x !== input.itemId);
  await db.update(people).set({ setupDone: next }).where(eq(people.id, c.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'child.checklist', targetType: 'person', targetId: c.id, after: { item: input.itemId, done: input.done } });
}

// ---------------------------------------------------------------------------------------------
// Weeks and months, in the household's own time

async function household(db: Db, householdId: string) {
  const [hh] = await db.select().from(households).where(eq(households.id, householdId));
  if (!hh) throw new ExtrasError('not_found', "Family time can't find your family. Sign out, then sign in again.", 404);
  return hh;
}

/** The household week `now` falls in, by its first day: `2026-11-09`. */
export async function thisWeek(db: Db, householdId: string, now: Date): Promise<string> {
  const hh = await household(db, householdId);
  return weekStarting(now, parseWeekReset(hh.weekResets), hh.timezone).date;
}

/** `2026-11` and "November", in the household's time zone. */
export function monthOf(now: Date, timeZone: string): { month: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', timeZone }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return { month: `${y}-${m}`, label: now.toLocaleDateString('en-GB', { month: 'long', timeZone }) };
}

// ---------------------------------------------------------------------------------------------
// Family's view

/** `full`: parents. Carers see what the child did and can do, not the parents' notes or questions about rules. */
export async function childExtras(db: Db, householdId: string, childId: string, now: Date, full: boolean): Promise<ChildExtras> {
  const c = await child(db, householdId, childId);
  const hh = await household(db, householdId);
  const tz = hh.timezone;
  const since = new Date(now.getTime() - JOURNAL_DAYS * 86_400_000);
  const answeredSince = new Date(now.getTime() - ANSWERED_DAYS * 86_400_000);
  const entries = await db.select().from(journal).where(and(eq(journal.childId, c.id), gte(journal.at, since))).orderBy(desc(journal.at));
  const sk = await db.select().from(skills).where(and(eq(skills.childId, c.id), isNull(skills.removedAt))).orderBy(asc(skills.startedAt));
  const asks = full
    ? await db
        .select()
        .from(ruleAsks)
        .where(and(eq(ruleAsks.childId, c.id), or(inArray(ruleAsks.status, ['open', 'review']), gte(ruleAsks.decidedAt, answeredSince))))
        .orderBy(desc(ruleAsks.askedAt))
    : [];
  const week = weekStarting(now, parseWeekReset(hh.weekResets), tz).date;
  const m = monthOf(now, tz);
  const [unmanaged] = full ? await db.select().from(unmanagedTime).where(and(eq(unmanagedTime.childId, c.id), eq(unmanagedTime.week, week))) : [];
  const [mood] = full ? await db.select().from(moodChecks).where(and(eq(moodChecks.childId, c.id), eq(moodChecks.month, m.month))) : [];
  return {
    journal: entries.map((e) => ({ id: e.id, text: e.text, picture: e.picture, when: when(e.at, now, tz), praise: e.praise })),
    skills: sk.map((s) => ({ id: s.id, title: s.title, picture: s.picture, mastered: s.masteredAt !== null, since: when(s.masteredAt ?? s.startedAt, now, tz) })),
    ruleAsks: asks.map((a) => ({ id: a.id, text: a.text, when: when(a.askedAt, now, tz), status: a.status, answer: a.answer })),
    unmanagedMinutes: unmanaged?.minutes ?? null,
    mood: mood ? { month: mood.month, rating: mood.rating, note: mood.note } : null,
    monthLabel: m.label,
  };
}

export async function setUnmanaged(db: Db, input: { householdId: string; childId: string; by: string; minutes: number }, now: Date) {
  const c = await child(db, input.householdId, input.childId);
  const week = await thisWeek(db, input.householdId, now);
  await db
    .insert(unmanagedTime)
    .values({ childId: c.id, week, minutes: input.minutes, by: input.by, updatedAt: now })
    .onConflictDoUpdate({ target: [unmanagedTime.childId, unmanagedTime.week], set: { minutes: input.minutes, by: input.by, updatedAt: now } });
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'child.unmanaged_estimate', targetType: 'person', targetId: c.id, after: { week, minutes: input.minutes } });
}

export async function setMood(db: Db, input: { householdId: string; childId: string; by: string; rating: number; note: string | null }, now: Date) {
  const c = await child(db, input.householdId, input.childId);
  const { month } = monthOf(now, (await household(db, input.householdId)).timezone);
  await db
    .insert(moodChecks)
    .values({ childId: c.id, month, rating: input.rating, note: input.note, by: input.by, at: now })
    .onConflictDoUpdate({ target: [moodChecks.childId, moodChecks.month], set: { rating: input.rating, note: input.note, by: input.by, at: now } });
  // The rating and note stay out of the audit log, which the owner sees.
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'child.mood_check', targetType: 'person', targetId: c.id, after: { month } });
}

/** A few words back for something the child did. Sent once; a second send changes the words. */
export async function praiseJournal(db: Db, input: { householdId: string; entryId: string; by: string; text: string }, now: Date) {
  const [row] = await db
    .select({ id: journal.id, childId: journal.childId })
    .from(journal)
    .innerJoin(people, eq(people.id, journal.childId))
    .where(and(eq(journal.id, input.entryId), eq(people.householdId, input.householdId)));
  if (!row) throw new ExtrasError('not_found', 'That entry has gone. Reload Family to see the latest.', 404);
  await db.update(journal).set({ praise: input.text, praisedBy: input.by, praisedAt: now }).where(eq(journal.id, row.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'journal.praised', targetType: 'person', targetId: row.childId });
}

async function skillIn(db: Db, householdId: string, skillId: string) {
  const [row] = await db
    .select({ id: skills.id, childId: skills.childId, title: skills.title, masteredAt: skills.masteredAt })
    .from(skills)
    .innerJoin(people, eq(people.id, skills.childId))
    .where(and(eq(skills.id, skillId), eq(people.householdId, householdId), isNull(skills.removedAt)));
  if (!row) throw new ExtrasError('not_found', 'That skill has gone. Reload to see the latest.', 404);
  return row;
}

export async function addSkill(db: Db, input: { householdId: string; childId: string; title: string; picture: string }, now: Date) {
  const c = await child(db, input.householdId, input.childId);
  if (!(PICTURES as readonly string[]).includes(input.picture)) throw new ExtrasError('invalid', 'Pick one of the pictures.');
  const live = await db.select({ id: skills.id }).from(skills).where(and(eq(skills.childId, c.id), isNull(skills.removedAt)));
  if (live.length >= MAX_SKILLS) throw new ExtrasError('too_many', `There's room for ${MAX_SKILLS} things. Ask a grown-up to remove one you don't need any more.`, 409);
  const [row] = await db.insert(skills).values({ childId: c.id, title: input.title, picture: input.picture, startedAt: now }).returning({ id: skills.id });
  return row!.id;
}

/** "Can do it now": a parent or carer agrees it is mastered. `mastered: false` puts it back to learning. */
export async function confirmSkill(db: Db, input: { householdId: string; skillId: string; by: string; mastered: boolean }, now: Date) {
  const s = await skillIn(db, input.householdId, input.skillId);
  await db
    .update(skills)
    .set(input.mastered ? { masteredAt: s.masteredAt ?? now, confirmedBy: input.by } : { masteredAt: null, confirmedBy: null })
    .where(eq(skills.id, s.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: input.mastered ? 'skill.mastered' : 'skill.learning', targetType: 'person', targetId: s.childId, after: { title: s.title } });
}

export async function removeSkill(db: Db, input: { householdId: string; skillId: string; by: string }, now: Date) {
  const s = await skillIn(db, input.householdId, input.skillId);
  await db.update(skills).set({ removedAt: now }).where(eq(skills.id, s.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'skill.removed', targetType: 'person', targetId: s.childId, after: { title: s.title } });
}

/** Answer a question about a rule, or put it on the family review's agenda to talk about together. */
export async function answerRuleAsk(db: Db, input: { householdId: string; askId: string; by: string; action: 'review' | 'answer'; answer?: string | undefined }, now: Date) {
  const [row] = await db
    .select({ id: ruleAsks.id, status: ruleAsks.status, childId: ruleAsks.childId })
    .from(ruleAsks)
    .innerJoin(people, eq(people.id, ruleAsks.childId))
    .where(and(eq(ruleAsks.id, input.askId), eq(people.householdId, input.householdId)));
  if (!row) throw new ExtrasError('not_found', 'That question has gone. Reload to see the latest.', 404);
  if (row.status === 'answered') throw new ExtrasError('answered', 'Someone has already answered that one. Reload to see their answer.', 409);
  if (input.action === 'answer' && !input.answer) throw new ExtrasError('invalid', 'Write your answer first.');
  await db
    .update(ruleAsks)
    .set(input.action === 'review' ? { status: 'review', decidedBy: input.by, decidedAt: now } : { status: 'answered', answer: input.answer!, decidedBy: input.by, decidedAt: now })
    .where(eq(ruleAsks.id, row.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: input.action === 'review' ? 'rule_ask.review' : 'rule_ask.answered', targetType: 'person', targetId: row.childId });
}

/** Questions about rules still waiting for a first answer, for Approvals. Parents only. */
export async function openRuleAsks(db: Db, householdId: string, now: Date) {
  const tz = (await household(db, householdId)).timezone;
  const rows = await db
    .select({ id: ruleAsks.id, childId: ruleAsks.childId, childName: people.displayName, text: ruleAsks.text, askedAt: ruleAsks.askedAt })
    .from(ruleAsks)
    .innerJoin(people, eq(people.id, ruleAsks.childId))
    .where(and(eq(people.householdId, householdId), eq(ruleAsks.status, 'open')))
    .orderBy(desc(ruleAsks.askedAt));
  return rows.map((r) => ({ kind: 'question' as const, id: r.id, childId: r.childId, childName: r.childName, text: r.text, when: when(r.askedAt, now, tz) }));
}

// ---------------------------------------------------------------------------------------------
// The kiosk: each child sees only their own

export async function kioskMine(db: Db, householdId: string, childId: string, now: Date): Promise<KioskMine> {
  const c = await child(db, householdId, childId);
  const tz = (await household(db, householdId)).timezone;
  const answeredSince = new Date(now.getTime() - ANSWERED_DAYS * 86_400_000);
  const entries = await db
    .select({ id: journal.id, text: journal.text, picture: journal.picture, at: journal.at, praise: journal.praise, praisedBy: people.displayName })
    .from(journal)
    .leftJoin(people, eq(people.id, journal.praisedBy))
    .where(eq(journal.childId, c.id))
    .orderBy(desc(journal.at))
    .limit(8);
  const sk = await db.select().from(skills).where(and(eq(skills.childId, c.id), isNull(skills.removedAt))).orderBy(asc(skills.startedAt));
  const asks = await db
    .select()
    .from(ruleAsks)
    .where(and(eq(ruleAsks.childId, c.id), or(inArray(ruleAsks.status, ['open', 'review']), and(isNotNull(ruleAsks.decidedAt), gte(ruleAsks.decidedAt, answeredSince)))))
    .orderBy(desc(ruleAsks.askedAt));
  return {
    journal: entries.map((e) => ({ id: e.id, text: e.text, picture: e.picture, when: when(e.at, now, tz), praise: e.praise, praisedBy: e.praise ? e.praisedBy : null })),
    learning: sk.filter((s) => !s.masteredAt).map((s) => ({ id: s.id, title: s.title, picture: s.picture })),
    canDo: sk.filter((s) => s.masteredAt).map((s) => ({ id: s.id, title: s.title, picture: s.picture })),
    ruleAsks: asks.map((a) => ({ id: a.id, text: a.text, status: a.status, answer: a.answer })),
  };
}

export async function addJournal(db: Db, input: { householdId: string; childId: string; text: string; picture: string }, now: Date) {
  const c = await child(db, input.householdId, input.childId);
  if (!(PICTURES as readonly string[]).includes(input.picture)) throw new ExtrasError('invalid', 'Pick one of the pictures.');
  const today = await db.select({ id: journal.id }).from(journal).where(and(eq(journal.childId, c.id), gte(journal.at, new Date(now.getTime() - 86_400_000))));
  if (today.length >= MAX_JOURNAL_PER_DAY) throw new ExtrasError('too_many', "You've added lots today. You can add more tomorrow.", 409);
  const [row] = await db.insert(journal).values({ childId: c.id, text: input.text, picture: input.picture, at: now }).returning({ id: journal.id });
  return row!.id;
}

export async function askAboutRule(db: Db, input: { householdId: string; childId: string; text: string }, now: Date) {
  const c = await child(db, input.householdId, input.childId);
  const open = await db.select({ id: ruleAsks.id }).from(ruleAsks).where(and(eq(ruleAsks.childId, c.id), inArray(ruleAsks.status, ['open', 'review'])));
  if (open.length >= MAX_OPEN_RULE_ASKS) throw new ExtrasError('too_many', "You have three questions waiting. You can ask another once a grown-up has answered one.", 409);
  const [row] = await db.insert(ruleAsks).values({ childId: c.id, text: input.text, askedAt: now }).returning({ id: ruleAsks.id });
  return row!.id;
}
