// The kiosk (brief Part 11, ADR 0015): what the child's tablet shows and does. Every label is made
// here, in the child's words, so the tablet never works out times or rules. Pairing and the
// device tokens are here too.
import { randomInt } from 'node:crypto';
import {
  completionPhotos,
  completions,
  grants,
  households,
  ideas,
  kioskDevices,
  kioskPairings,
  loadEconomy,
  loadRules,
  people,
  reflections,
  requests,
  serviceGroups,
  services,
  type Db,
} from '@family-time/db';
import { addDays, blocksOn, civilDate, decideAll, features, FINISHING_UP, weekStarting, type BlockInterval } from '@family-time/domain';
import type { LedgerPort } from '@family-time/ledger';
import type { KioskDevice, KioskHome, KioskMe, KioskSlots, KioskTargets, Recurrence } from '@family-time/schemas';
import { and, asc, desc, eq, gte, gt, inArray, isNull, lte } from 'drizzle-orm';
import { audit } from '../audit.js';
import { randomToken, sha256 } from '../auth/tokens.js';
import { listTasks, logCompletion, planChecks, targetName, weekSummary } from '../economy/commands.js';
import { minutes, pence } from '../economy/words.js';
import { familyForKiosk } from '../family/whole.js';
import { oneAtATime } from '../family/extras.js';
import { kioskWords } from './words.js';

/** How long a pairing code works. */
const PAIRING_MS = 10 * 60_000;
/** How far back parents' notes stay on the kiosk. */
const NOTES_DAYS = 3;
/**
 * Wrong codes from every address together, per 10 minutes. Past it, every live code is voided:
 * someone is guessing, and a parent can make a new code in a moment.
 */
const MAX_BAD_CODES = 20;
let badCodes: { start: number; count: number } = { start: 0, count: 0 };
/** For tests: forget the wrong guesses so far. */
export function resetBadCodes() {
  badCodes = { start: 0, count: 0 };
}

export class KioskError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Pairing and devices

/** A 6-digit code for a new kiosk, for ten minutes. Only its hash is kept. */
export async function createPairing(db: Db, input: { householdId: string; by: string; label: string }, now: Date) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(now.getTime() + PAIRING_MS);
  // Only the newest code works: an older one left unused is voided.
  await db.update(kioskPairings).set({ usedAt: now }).where(and(eq(kioskPairings.householdId, input.householdId), isNull(kioskPairings.usedAt)));
  await db.insert(kioskPairings).values({ householdId: input.householdId, codeHash: sha256(code), label: input.label, createdBy: input.by, expiresAt, createdAt: now });
  return { code, expiresAt };
}

/** Swaps a code for the kiosk's long-lived token, once. */
export async function pairKiosk(db: Db, code: string, now: Date, ip?: string): Promise<{ token: string; householdName: string }> {
  const pairing = (
    await db
      .select()
      .from(kioskPairings)
      .where(and(eq(kioskPairings.codeHash, sha256(code)), isNull(kioskPairings.usedAt), gt(kioskPairings.expiresAt, now)))
  )[0];
  if (!pairing) {
    if (now.getTime() - badCodes.start > PAIRING_MS) badCodes = { start: now.getTime(), count: 0 };
    if (++badCodes.count > MAX_BAD_CODES) {
      await db.update(kioskPairings).set({ usedAt: now }).where(and(isNull(kioskPairings.usedAt), gt(kioskPairings.expiresAt, now)));
      await audit(db, { actor: { label: 'kiosk pairing' }, action: 'kiosk.codes_voided', ...(ip ? { ip } : {}) });
    }
    throw new KioskError('bad_code', "That code didn't work. Check the six numbers, or make a new code on your phone in Settings, then Kiosk.", 400);
  }
  const token = randomToken();
  const used = await db
    .update(kioskPairings)
    .set({ usedAt: now })
    .where(and(eq(kioskPairings.id, pairing.id), isNull(kioskPairings.usedAt)))
    .returning({ id: kioskPairings.id });
  if (!used.length) throw new KioskError('bad_code', "That code didn't work. Check the six numbers, or make a new code on your phone in Settings, then Kiosk.", 400);
  const [device] = await db
    .insert(kioskDevices)
    .values({ householdId: pairing.householdId, label: pairing.label, tokenHash: sha256(token), createdBy: pairing.createdBy, createdAt: now, lastSeenAt: now })
    .returning({ id: kioskDevices.id });
  await audit(db, { householdId: pairing.householdId, actor: { label: 'kiosk' }, action: 'kiosk.paired', targetType: 'kiosk', targetId: device!.id, after: { pairing: pairing.id, label: pairing.label }, ...(ip ? { ip } : {}) });
  const [hh] = await db.select({ name: households.name }).from(households).where(eq(households.id, pairing.householdId));
  return { token, householdName: hh?.name ?? '' };
}

/** The kiosk a token belongs to, unless it has been removed. Notes when it was last seen. */
export async function kioskFromToken(db: Db, token: string, now: Date): Promise<{ deviceId: string; householdId: string } | null> {
  const d = (await db.select().from(kioskDevices).where(and(eq(kioskDevices.tokenHash, sha256(token)), isNull(kioskDevices.revokedAt))))[0];
  if (!d) return null;
  // At most once a minute, so polling does not write on every request.
  if (!d.lastSeenAt || now.getTime() - d.lastSeenAt.getTime() > 60_000) await db.update(kioskDevices).set({ lastSeenAt: now }).where(eq(kioskDevices.id, d.id));
  return { deviceId: d.id, householdId: d.householdId };
}

export async function listKiosks(db: Db, householdId: string): Promise<KioskDevice[]> {
  const rows = await db
    .select()
    .from(kioskDevices)
    .where(and(eq(kioskDevices.householdId, householdId), isNull(kioskDevices.revokedAt)))
    .orderBy(asc(kioskDevices.createdAt));
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.createdAt.toISOString(), lastSeen: r.lastSeenAt?.toISOString() ?? null }));
}

export async function removeKiosk(db: Db, householdId: string, id: string, now: Date): Promise<boolean> {
  const done = await db
    .update(kioskDevices)
    .set({ revokedAt: now })
    .where(and(eq(kioskDevices.id, id), eq(kioskDevices.householdId, householdId), isNull(kioskDevices.revokedAt)))
    .returning({ id: kioskDevices.id });
  return done.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Reads

export async function kioskMe(db: Db, householdId: string): Promise<KioskMe> {
  const [hh] = await db.select({ name: households.name }).from(households).where(eq(households.id, householdId));
  const kids = await db
    .select({ id: people.id, name: people.displayName, pinHash: people.kioskPinHash })
    .from(people)
    .where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)))
    .orderBy(asc(people.displayName));
  return { householdName: hh?.name ?? '', children: kids.map((k) => ({ id: k.id, name: k.name, pin: k.pinHash !== null })) };
}

/** The child, if they are in the kiosk's own household. A kiosk can never act for anyone else's. */
export async function kioskChild(db: Db, householdId: string, childId: string) {
  const c = (
    await db
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(and(eq(people.id, childId), eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)))
  )[0];
  if (!c) throw new KioskError('not_found', "That isn't someone in this family.", 404);
  return c;
}

const hhmm = (d: Date, timeZone: string) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
const weekday = (d: Date, timeZone: string) => d.toLocaleDateString('en-GB', { weekday: 'long', timeZone });

/** The blocks of yesterday, today and tomorrow, so a bedtime that started last night is found. */
function blocksAround(schedules: Parameters<typeof blocksOn>[0], childId: string, now: Date, timeZone: string): BlockInterval[] {
  const today = civilDate(now, timeZone);
  return [-1, 0, 1].flatMap((n) => blocksOn(schedules, childId, addDays(today, n), timeZone));
}

export async function kioskHome(db: Db, ledger: LedgerPort, householdId: string, childId: string, now: Date): Promise<KioskHome> {
  const child = await kioskChild(db, householdId, childId);
  const words = await kioskWords(db, householdId);
  const e = await loadEconomy(db, childId);
  const tz = e.timeZone;
  const f = features(e.pilotPhase);
  const rules = await loadRules(db, childId, now);
  const blocks = blocksAround(rules.schedules, childId, now, tz);
  const inBlock = (b: BlockInterval) => b.start.getTime() <= now.getTime() && now.getTime() < b.end.getTime();
  const bed = blocks.find((b) => b.type === 'bed' && inBlock(b));
  const windDownNow = blocks.find((b) => b.type === 'wind-down' && inBlock(b));
  const next = blocks.filter((b) => ['wind-down', 'bed', 'pause'].includes(b.type) && b.start.getTime() > now.getTime() && civilDate(b.start, tz).day === civilDate(now, tz).day).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const pill: KioskHome['pill'] = windDownNow
    ? { kind: 'wind-down', label: 'Wind-down time' }
    : next
      ? next.type === 'wind-down'
        ? { kind: 'wind-down', label: `Wind-down at ${hhmm(next.start, tz)}` }
        : next.type === 'bed'
          ? { kind: 'bed', label: `Bedtime at ${hhmm(next.start, tz)}` }
          : { kind: 'pause', label: `${next.label ?? 'Pause'} at ${hhmm(next.start, tz)}` }
      : null;
  const wake = bed ? hhmm(bed.end, tz) : null;

  // Right now: a planned or approved session running at this moment.
  const running = (
    await db
      .select()
      .from(grants)
      .where(and(eq(grants.childId, childId), inArray(grants.status, ['scheduled', 'active']), lte(grants.startsAt, now), gt(grants.endsAt, now)))
      .orderBy(asc(grants.endsAt))
  )[0];
  let rightNow: KioskHome['rightNow'] = null;
  if (running) {
    const name = await targetName(db, householdId, { kind: running.targetKind, id: running.targetId }).catch(() => 'Screen time');
    const icon = running.targetKind === 'service' ? ((await db.select({ icon: services.icon }).from(services).where(eq(services.id, running.targetId)))[0]?.icon ?? null) : null;
    const end = hhmm(running.endsAt, tz);
    // DNS cannot see the end of a video (brief Part 11): new ones stop, the one playing can finish.
    const detail =
      icon === 'video'
        ? `New videos won't start after ${end}. The one you're watching can finish.`
        : running.targetKind === 'group'
          ? `It ends at ${end}. Save your game a few minutes before. A video you're watching can finish.`
          : icon === 'pad' || icon === 'cube'
            ? `It ends at ${end}. Save your game a few minutes before.`
            : `It ends at ${end}.`;
    const used = (now.getTime() - running.startsAt.getTime()) / (running.endsAt.getTime() - running.startsAt.getTime());
    rightNow = { title: `${name} until ${end}`, detail, icon, used: Math.max(0, Math.min(1, used)) };
  }
  // Finishing up (the transitions phase): straight from the engine, so a Pause, a Block, school or
  // bedtime always says otherwise, and the time is when the engine really blocks. No countdown bar.
  if (!rightNow && (rules.stoppingPointMinutes ?? 0) > 0) {
    const finishing = [...decideAll(rules, now).values()].filter((d) => d.reason === FINISHING_UP && d.stateUntil).sort((a, b) => b.stateUntil!.getTime() - a.stateUntil!.getTime())[0];
    if (finishing) rightNow = { title: 'Finishing up', detail: `Find a good place to stop, like the end of a level, by about ${hhmm(finishing.stateUntil!, tz)}.`, icon: null, used: null };
  }

  // The week, as 30-minute blocks.
  let week: KioskHome['week'] = null;
  let goal: KioskHome['goal'] = null;
  if (f.economy) {
    const w = await weekSummary(db, ledger, childId, now);
    const planned = Math.round(w.plannedMinutes / 30);
    const left = Math.floor(Math.max(0, w.leftMinutes) / 30);
    const total = Math.max(Math.round(w.allowanceMinutes / 30), planned + left, 1);
    const used = total - planned - left;
    const cells = Array.from({ length: total }, (_, i): 'used' | 'now' | 'planned' | 'left' => (i < used ? (rightNow && i === used - 1 ? 'now' : 'used') : i < used + planned ? 'planned' : 'left'));
    const resetDay = w.resets.replace(/ at .*/, '');
    week = {
      leftMinutes: w.leftMinutes,
      headline: `${minutes(Math.max(0, w.leftMinutes))} left to plan this week`,
      blocks: cells,
      caption: w.features.bonus ? `Each block is 30 minutes. Blocks you save turn into ${pence(w.rates.pencePerBlock)} on ${resetDay}.` : 'Each block is 30 minutes.',
    };
    if (f.goal && w.goal) {
      goal = {
        title: w.goal.title,
        savedPence: w.goal.savedPence,
        targetPence: w.goal.targetPence,
        saved: pence(w.goal.savedPence),
        target: pence(w.goal.targetPence),
        line:
          w.goal.savedPence >= w.goal.targetPence
            ? `You did it! Talk to ${words.either} about getting it.`
            : `${w.features.bonus ? `Saved screen time adds to this on ${resetDay}.` : 'Jobs paid in pocket money add to this.'}${!w.goal.matchPercent ? '' : w.goal.matchPercent === 100 ? ` Matched by ${words.both}: an extra £1 for every £1 you save.` : ` Matched by ${words.both}: an extra ${w.goal.matchPercent}p for every £1 you save.`}`,
      };
    }
  }

  // What's planned: sessions still to come.
  const ahead = await db
    .select()
    .from(grants)
    .where(and(eq(grants.childId, childId), eq(grants.status, 'scheduled'), gt(grants.startsAt, now)))
    .orderBy(asc(grants.startsAt))
    .limit(8);
  const planned = await Promise.all(
    ahead.map(async (g) => {
      const name = await targetName(db, householdId, { kind: g.targetKind, id: g.targetId }).catch(() => 'Screen time');
      const sameDay = civilDate(g.startsAt, tz).day === civilDate(now, tz).day;
      const icon = g.targetKind === 'service' ? ((await db.select({ icon: services.icon }).from(services).where(eq(services.id, g.targetId)))[0]?.icon ?? null) : null;
      return { id: g.id, title: name, when: `${sameDay ? 'Today' : weekday(g.startsAt, tz)}, ${hhmm(g.startsAt, tz)} to ${hhmm(g.endsAt, tz)}`, icon };
    }),
  );

  // My jobs: today's, with where each one is.
  const jobs: KioskHome['jobs'] = [];
  if (f.economy) {
    const today = civilDate(now, tz);
    const dow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    const midnight = startOfDay(now, tz);
    const all = (await listTasks(db, householdId)).filter((t) => !t.childId || t.childId === childId);
    const done = await db
      .select({ taskId: completions.taskId, status: completions.status, loggedAt: completions.loggedAt })
      .from(completions)
      .where(and(eq(completions.childId, childId), inArray(completions.status, ['waiting', 'approved'])));
    for (const t of all) {
      const rec = t.recurrence as Recurrence;
      if (rec.kind === 'weekly' && !rec.weekdays.includes(dow)) continue;
      const mine = done.filter((c) => c.taskId === t.id && (rec.kind === 'once' || c.loggedAt.getTime() >= midnight.getTime()));
      if (rec.kind === 'once' && mine.some((c) => c.status === 'approved')) continue;
      const status = mine.some((c) => c.status === 'waiting') ? 'waiting' : mine.some((c) => c.status === 'approved') ? 'done' : 'todo';
      jobs.push({ id: t.id, title: t.title, picture: t.picture, reward: t.rewardType === 'flex' ? `${t.amount} Flex` : t.rewardLabel, status });
    }
  }

  // Bored? The child's own ideas.
  const myIdeas = f.goal
    ? await db
        .select({ id: ideas.id, text: ideas.text, picture: ideas.picture })
        .from(ideas)
        .where(and(eq(ideas.childId, childId), isNull(ideas.removedAt)))
        .orderBy(asc(ideas.createdAt))
        .limit(8)
    : [];

  // Notes from the grown-ups: praise for a job, answers to asking.
  const since = new Date(now.getTime() - NOTES_DAYS * 86_400_000);
  const praised = await db
    .select({ id: completions.id, note: completions.note, at: completions.decidedAt, by: people.displayName })
    .from(completions)
    .innerJoin(people, eq(people.id, completions.decidedBy))
    .where(and(eq(completions.childId, childId), eq(completions.status, 'approved'), gte(completions.decidedAt, since)))
    .orderBy(desc(completions.decidedAt))
    .limit(5);
  const answered = await db
    .select({ id: requests.id, status: requests.status, at: requests.decidedAt, by: people.displayName, kind: requests.targetKind, target: requests.targetId, start: requests.startsAt })
    .from(requests)
    .innerJoin(people, eq(people.id, requests.decidedBy))
    .where(and(eq(requests.childId, childId), inArray(requests.status, ['approved', 'not-yet']), gte(requests.decidedAt, new Date(now.getTime() - 86_400_000))))
    .orderBy(desc(requests.decidedAt))
    .limit(3);
  const notes: KioskHome['notes'] = [];
  for (const p of praised) if (p.note) notes.push({ id: `c:${p.id}`, text: p.note, from: p.by, when: hhmm(p.at!, tz) });
  for (const r of answered) {
    const name = await targetName(db, householdId, { kind: r.kind, id: r.target }).catch(() => 'that');
    notes.push({ id: `r:${r.id}`, text: r.status === 'approved' ? `Yes to ${name} at ${hhmm(r.start, tz)}.` : `Not this time for ${name}.`, from: r.by, when: hhmm(r.at!, tz) });
  }

  // The Sunday reflection: open on the week's last day, until the reset.
  let reflection: KioskHome['reflection'] = null;
  if (f.goal) {
    const w = weekStarting(now, e.weekReset, tz);
    if (w.next.getTime() - now.getTime() <= 86_400_000) {
      const done = await db.select({ id: reflections.id }).from(reflections).where(and(eq(reflections.childId, childId), eq(reflections.week, w.date)));
      reflection = { week: w.date, answered: done.length > 0 };
    }
  }

  return {
    child,
    clock: `${weekday(now, tz)} ${hhmm(now, tz)}`,
    pill,
    night: Boolean(bed),
    nightLine: wake ? `Sleep well, ${child.name}. See you at ${wake}.` : `Sleep well, ${child.name}.`,
    rightNow,
    week,
    planned,
    jobs,
    goal,
    ideas: myIdeas,
    notes: notes.slice(0, 4),
    reflection,
    family: await kioskFamily(db, householdId, now, words),
    features: { economy: f.economy, goal: f.goal, ideas: f.goal, reflection: f.goal },
    words,
  };
}

async function kioskFamily(db: Db, householdId: string, now: Date, words: { both: string }): Promise<KioskHome['family']> {
  const f = await familyForKiosk(db, householdId, now);
  if (!f) return null;
  return { challenge: f.challenge, grownUps: f.parentsMinutes === null ? null : `${words.both}'s screen time this week: ${minutes(f.parentsMinutes)}` };
}

function startOfDay(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return new Date(now.getTime() - (h * 60 + m) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

/** What can be planned: the family's apps and groups. */
export async function kioskTargets(db: Db, householdId: string): Promise<KioskTargets> {
  const groups = await db.select({ id: serviceGroups.id, name: serviceGroups.name }).from(serviceGroups).where(eq(serviceGroups.householdId, householdId)).orderBy(asc(serviceGroups.name));
  const apps = await db.select({ id: services.id, name: services.name, icon: services.icon }).from(services).where(eq(services.householdId, householdId)).orderBy(asc(services.name));
  return [...apps.map((a) => ({ kind: 'service' as const, ...a })), ...groups.map((g) => ({ kind: 'group' as const, id: g.id, name: g.name, icon: null }))];
}

/** Now, then every half hour to the end of today, each checked against the rules. */
export async function kioskSlots(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; target: { kind: 'service' | 'group'; id: string }; minutes: 30 | 60 }, now: Date): Promise<KioskSlots> {
  await kioskChild(db, input.householdId, input.childId);
  await targetName(db, input.householdId, input.target);
  const e = await loadEconomy(db, input.childId);
  const midnight = startOfDay(new Date(now.getTime() + 86_400_000), e.timeZone);
  const starts = [new Date(Math.floor(now.getTime() / 60_000) * 60_000)];
  for (let t = Math.ceil(now.getTime() / 1_800_000) * 1_800_000; t < midnight.getTime(); t += 1_800_000) if (t > starts[0]!.getTime()) starts.push(new Date(t));
  const { results, balance } = await planChecks(db, ledger, { childId: input.childId, target: input.target, minutes: input.minutes, starts }, now);
  const blocks = input.minutes / 30;
  const after = balance.time - input.minutes;
  return {
    minutes: input.minutes,
    cost: after >= 0 ? `${input.minutes} minutes is ${blocks} block${blocks > 1 ? 's' : ''}. You'll have ${minutes(after)} left after.` : `That's more than you have left this week. You can ask a grown-up.`,
    slots: starts.map((s, i) => {
      const r = results[i]!;
      return { start: s.toISOString(), label: i === 0 ? 'Now' : hhmm(s, e.timeZone), ok: r.ok, reason: r.ok ? null : r.reason, askOnly: !r.ok && r.code === 'balance' };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Writes

/** The pictures an idea can have, as on the kiosk. */
export const IDEA_PICTURES = ['star', 'tent', 'pencil', 'ball', 'bike', 'book', 'lego', 'plant', 'heart'];

/** Requests still waiting for a grown-up, per child: more than this and the kiosk asks them to wait. */
export const MAX_OPEN_REQUESTS = 3;

export async function openRequests(db: Db, householdId: string, childId: string): Promise<number> {
  await kioskChild(db, householdId, childId);
  return (await db.select({ id: requests.id }).from(requests).where(and(eq(requests.childId, childId), eq(requests.status, 'waiting')))).length;
}

/** I did it: the completion, with its photo if there is one. Returns the completion's id. */
export async function kioskDone(db: Db, input: { householdId: string; childId: string; taskId: string; photo: string | null }, now: Date): Promise<string> {
  await kioskChild(db, input.householdId, input.childId);
  const id = await logCompletion(db, { childId: input.childId, taskId: input.taskId }, now);
  if (input.photo) {
    const jpeg = Buffer.from(input.photo.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    // A JPEG starts FF D8 FF. Anything else is not kept.
    if (jpeg.length > 3 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff && jpeg.length <= 1_500_000) {
      await db.insert(completionPhotos).values({ completionId: id, jpeg: new Uint8Array(jpeg), createdAt: now }).onConflictDoNothing();
    }
  }
  return id;
}

export async function addIdea(db: Db, input: { householdId: string; childId: string; text: string; picture: string }, now: Date) {
  await kioskChild(db, input.householdId, input.childId);
  return oneAtATime(db, input.childId, (tx) => addIdeaLocked(tx, input, now));
}

async function addIdeaLocked(db: Db, input: { childId: string; text: string; picture: string }, now: Date) {
  const count = await db.select({ id: ideas.id }).from(ideas).where(and(eq(ideas.childId, input.childId), isNull(ideas.removedAt)));
  if (!IDEA_PICTURES.includes(input.picture)) throw new KioskError('invalid', 'Pick one of the pictures.', 400);
  if (count.length >= 12) throw new KioskError('too_many', "That's 12 ideas, the most there's room for. Why not try one of them?", 409);
  const [row] = await db.insert(ideas).values({ childId: input.childId, text: input.text, picture: input.picture, createdAt: now }).returning({ id: ideas.id });
  return row!.id;
}

export async function saveReflection(db: Db, input: { householdId: string; childId: string; wentWell: string; wasHard: string; nextGoal: string }, now: Date) {
  await kioskChild(db, input.householdId, input.childId);
  const e = await loadEconomy(db, input.childId);
  const w = weekStarting(now, e.weekReset, e.timeZone);
  await db
    .insert(reflections)
    .values({ childId: input.childId, week: w.date, wentWell: input.wentWell, wasHard: input.wasHard, nextGoal: input.nextGoal, createdAt: now })
    .onConflictDoUpdate({ target: [reflections.childId, reflections.week], set: { wentWell: input.wentWell, wasHard: input.wasHard, nextGoal: input.nextGoal } });
}

/** The photo for a parent's approval card, only within their own household. */
export async function photoFor(db: Db, householdId: string, completionId: string): Promise<Uint8Array | null> {
  const row = (
    await db
      .select({ jpeg: completionPhotos.jpeg })
      .from(completionPhotos)
      .innerJoin(completions, eq(completions.id, completionPhotos.completionId))
      .innerJoin(people, eq(people.id, completions.childId))
      .where(and(eq(completionPhotos.completionId, completionId), eq(people.householdId, householdId)))
  )[0];
  return row?.jpeg ?? null;
}

/** The latest reflection for each child, for the family review. */
export async function latestReflection(db: Db, childId: string) {
  return (await db.select().from(reflections).where(eq(reflections.childId, childId)).orderBy(desc(reflections.week)).limit(1))[0] ?? null;
}

