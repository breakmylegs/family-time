// Removing a child (Children's Code standard 15, docs/privacy/childrens-code.md). Removing turns
// the profile off: the kiosk stops showing them and nothing more is kept from then on. With
// --erase, everything the child wrote and the parents' notes about them are deleted too. The
// points history and the audit log stay, because they are the family's record of what was earned
// and who did what; neither holds what the child wrote.
import { completionPhotos, completions, devices, ideas, journal, moodChecks, people, reflections, requests, ruleAsks, sessionEndings, skills, unmanagedTime, type Db } from '@family-time/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { audit } from '../audit.js';
import { theHousehold } from '../settings.js';
import { CliError } from './commands.js';

/** What `--erase` deletes, in the words the command prints. */
export const ERASED = [
  'things done away from screens, and the praise sent back',
  'things they were learning or could do',
  'questions about rules, and the answers',
  "their ideas for when they're bored, and their answers to How was your week?",
  'photos sent with jobs, notes sent with jobs, and anything they typed when asking for time',
  "the parents' estimates, monthly mood checks and how each session ended",
  'their age band, pronouns and setup checklist',
];

export async function removeChild(db: Db, input: { child: string; erase: boolean; yes: boolean }, now: Date): Promise<string> {
  // The same family child-add uses.
  const hh = await theHousehold(db);
  if (!hh) throw new CliError('There is no family yet. Run owner-invite first.');
  // An exact name, whatever its case: % and _ are letters here, not wildcards.
  const rows = await db
    .select({ id: people.id, name: people.displayName, active: people.active })
    .from(people)
    .where(and(eq(people.householdId, hh.id), eq(people.role, 'child'), sql`lower(${people.displayName}) = lower(${input.child.trim()})`));
  if (rows.length !== 1) throw new CliError(rows.length ? `More than one child is called ${input.child}. Ask for help in the project's issues: this needs fixing by hand.` : `No child called ${input.child}. Check the name is spelt as it is in the app.`);
  const c = rows[0]!;
  if (!c.active && !input.erase) return `${c.name} has already been removed. Add --erase to delete what they wrote and your notes about them.`;

  const plan = [
    c.active ? `Remove ${c.name}: the kiosk stops showing them, and their kiosk PIN is cleared.` : `${c.name} is already removed.`,
    ...(input.erase ? [`Delete for good: ${ERASED.join('; ')}.`] : []),
    'Kept: the points history, and the audit log of who did what.',
  ];

  const counts: Record<string, number> = {};
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    // Checked inside the transaction, so a device added meanwhile is seen.
    const live = await tx.select({ label: devices.label }).from(devices).where(and(eq(devices.childId, c.id), isNull(devices.removedAt)));
    if (live.length) throw new CliError(`${c.name} still has ${live.map((d) => d.label).join(', ')}. Remove ${live.length === 1 ? 'it' : 'them'} first in Settings, under Set-up, so nothing is left blocked.`);
    if (!input.yes) return;
    if (c.active) await tx.update(people).set({ active: false, deactivatedAt: now, kioskPinHash: null }).where(eq(people.id, c.id));
    if (input.erase) {
      const done = await tx.select({ id: completions.id }).from(completions).where(eq(completions.childId, c.id));
      counts.photos = done.length ? (await tx.delete(completionPhotos).where(inArray(completionPhotos.completionId, done.map((d) => d.id))).returning({ id: completionPhotos.completionId })).length : 0;
      counts.notes = (await tx.update(completions).set({ note: null }).where(eq(completions.childId, c.id)).returning({ id: completions.id })).length;
      counts.requests = (await tx.update(requests).set({ detail: null }).where(eq(requests.childId, c.id)).returning({ id: requests.id })).length;
      counts.journal = (await tx.delete(journal).where(eq(journal.childId, c.id)).returning({ id: journal.id })).length;
      counts.skills = (await tx.delete(skills).where(eq(skills.childId, c.id)).returning({ id: skills.id })).length;
      counts.ruleAsks = (await tx.delete(ruleAsks).where(eq(ruleAsks.childId, c.id)).returning({ id: ruleAsks.id })).length;
      counts.ideas = (await tx.delete(ideas).where(eq(ideas.childId, c.id)).returning({ id: ideas.id })).length;
      counts.reflections = (await tx.delete(reflections).where(eq(reflections.childId, c.id)).returning({ id: reflections.id })).length;
      counts.endings = (await tx.delete(sessionEndings).where(eq(sessionEndings.childId, c.id)).returning({ id: sessionEndings.id })).length;
      counts.unmanaged = (await tx.delete(unmanagedTime).where(eq(unmanagedTime.childId, c.id)).returning({ week: unmanagedTime.week })).length;
      counts.moods = (await tx.delete(moodChecks).where(eq(moodChecks.childId, c.id)).returning({ month: moodChecks.month })).length;
      await tx.update(people).set({ ageBand: null, pronouns: null, setupDone: [] }).where(eq(people.id, c.id));
    }
    // In the same transaction: the change and its record land together or not at all. Counts only.
    await audit(tx, { householdId: hh.id, actor: { label: 'cli' }, action: input.erase ? 'child.erased' : 'child.removed', targetType: 'person', targetId: c.id, ...(input.erase ? { after: counts } : {}) });
  });
  if (!input.yes) return `${plan.join('\n')}\n\nNothing has changed. Run it again with --yes to do it.`;
  return input.erase ? `Removed ${c.name}, and deleted everything listed above. Older copies stay in the nightly backups until those are cleared, after about six months.` : `Removed ${c.name}.`;
}
