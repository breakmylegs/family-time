import { devices, households, people, policies, schedules, serviceGroupMembers, serviceGroups, services, type Db } from '@family-time/db';

/** Monday 26 October 2026, 16:00 in London (GMT): free time on a school night. */
export const FREE_TIME = new Date('2026-10-26T16:00:00Z');
/** The same Monday, 22:00: bedtime. */
export const BEDTIME = new Date('2026-10-26T22:00:00Z');

export async function seedHome(db: Db) {
  const [hh] = await db.insert(households).values({ name: 'Test' }).returning();
  const [mum] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Mum', role: 'owner' }).returning();
  const [ollie] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Ollie', role: 'child' }).returning();
  const [youtube] = await db
    .insert(services)
    .values({ householdId: hh!.id, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com', 'googlevideo.com', 'ytimg.com'] })
    .returning();
  const [roblox] = await db
    .insert(services)
    .values({ householdId: hh!.id, name: 'Roblox', source: 'adguard', adguardId: 'roblox', domains: ['roblox.com', 'rbxcdn.com'] })
    .returning();
  const [minecraft] = await db
    .insert(services)
    .values({ householdId: hh!.id, name: 'Minecraft', source: 'custom', domains: ['minecraft.net', 'mojang.com'] })
    .returning();
  const [games] = await db.insert(serviceGroups).values({ householdId: hh!.id, name: 'Games' }).returning();
  await db.insert(serviceGroupMembers).values([
    { groupId: games!.id, serviceId: roblox!.id },
    { groupId: games!.id, serviceId: minecraft!.id },
  ]);
  await db.insert(policies).values({ childId: ollie!.id, groupId: games!.id, defaultState: 'blocked' });
  await db.insert(schedules).values({
    householdId: hh!.id,
    name: 'School night',
    weekdays: [1, 2, 3, 4, 5],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  });
  const [ipad] = await db
    .insert(devices)
    .values({ householdId: hh!.id, childId: ollie!.id, label: "Ollie's iPad", type: 'ipad', adguardName: 'ft-ollieipad', identifiers: ['192.168.1.50'] })
    .returning();
  return { hh: hh!, mum: mum!, ollie: ollie!, youtube: youtube!, roblox: roblox!, minecraft: minecraft!, games: games!, ipad: ipad! };
}
