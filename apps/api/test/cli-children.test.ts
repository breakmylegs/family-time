// child-remove (Phase 12): shows first, refuses while devices are left, removes, and with --erase
// deletes what the child wrote while the ledger and audit log stay.
import { auditEvents, devices, ideas, journal, moodChecks, people, ruleAsks, sessionEndings, skills } from '@family-time/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { removeChild } from '../src/cli/children.js';
import { ownerInvite } from '../src/cli/commands.js';
import { addChild, addDevice } from '../src/cli/control.js';
import { seedPerson } from './accounts.js';
import { harness, type Harness } from './helpers.js';

const NOW = new Date('2026-11-15T10:00:00Z');
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function home() {
  h = await harness({ now: NOW });
  const db = h.handle.db;
  await ownerInvite(db, { origin: 'https://family.example.com' }, NOW);
  const [hh] = await h.handle.client.query<{ id: string }>('select id from households').then((r) => r.rows);
  const mum = await seedPerson(db, hh!.id, 'owner', 'Mum');
  const ollie = await addChild(db, 'Ollie');
  const sam = await addChild(db, 'Sam');
  for (const id of [ollie, sam]) {
    await db.insert(journal).values({ childId: id, text: 'Built a den' });
    await db.insert(skills).values({ childId: id, title: 'Swim' });
    await db.insert(ruleAsks).values({ childId: id, text: 'Why?' });
    await db.insert(ideas).values({ childId: id, text: 'Kite' });
    await db.insert(moodChecks).values({ childId: id, month: '2026-11', rating: 4, by: mum });
    await db.insert(sessionEndings).values({ childId: id, ref: `r-${id}`, endedAt: NOW, mood: 'calm', byPersonId: mum });
  }
  return { db, ollie, sam };
}

describe('child-remove', () => {
  it('shows what it will do, and changes nothing without --yes', async () => {
    const { db, ollie } = await home();
    const said = await removeChild(db, { child: 'ollie', erase: true, yes: false }, NOW);
    expect(said).toMatch(/Nothing has changed/);
    expect(said).toMatch(/Kept: the points history, and the audit log of who did what/);
    expect((await db.select().from(people).where(eq(people.id, ollie)))[0]!.active).toBe(true);
    expect(await db.select().from(journal)).toHaveLength(2);
  });

  it('refuses while the child still has a device', async () => {
    const { db } = await home();
    await addDevice(db, { child: 'Ollie', label: "Ollie's iPad", type: 'ipad', ids: ['192.168.1.50'] });
    await expect(removeChild(db, { child: 'Ollie', erase: false, yes: true }, NOW)).rejects.toThrow(/still has Ollie's iPad/);
    await db.update(devices).set({ removedAt: NOW });
    await expect(removeChild(db, { child: 'Ollie', erase: false, yes: true }, NOW)).resolves.toBe('Removed Ollie.');
  });

  it("removes, keeps what they wrote unless asked, and with --erase deletes only that child's", async () => {
    const { db, ollie, sam } = await home();
    await removeChild(db, { child: 'Ollie', erase: false, yes: true }, NOW);
    expect((await db.select().from(people).where(eq(people.id, ollie)))[0]).toMatchObject({ active: false });
    expect(await db.select().from(journal).where(eq(journal.childId, ollie))).toHaveLength(1);

    await removeChild(db, { child: 'Ollie', erase: true, yes: true }, NOW);
    for (const t of [journal, skills, ruleAsks, ideas, moodChecks, sessionEndings]) {
      const rows = (await db.select().from(t)) as { childId: string }[];
      expect(rows.map((r) => r.childId)).toEqual([sam]);
    }
    const [erased] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'child.erased'));
    expect(erased!.after).toMatchObject({ journal: 1, skills: 1, ruleAsks: 1, ideas: 1, moods: 1, endings: 1 });
    // A name is matched exactly: a wildcard finds nobody.
    await expect(removeChild(db, { child: 'S%', erase: false, yes: true }, NOW)).rejects.toThrow(/No child called S%/);
  });
});
