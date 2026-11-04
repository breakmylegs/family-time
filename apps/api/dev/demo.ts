// The mock's family, for the end-to-end tests and screenshots: Mum, Dad and Ollie on a school
// night, with YouTube, Roblox and Minecraft, a tea pause, and the history the mock shows at 18:32.
// The names are the mock's placeholders. Never part of the image.
import { devices, grants, households, overrides, people, policies, schedules, serviceGroupMembers, serviceGroups, services, settings, usageMinutes, type Db } from '@family-time/db';

const at = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00Z`);

export async function seedDemo(db: Db, origin: string) {
  const [hh] = await db.insert(households).values({ name: 'The demo family', timezone: 'Europe/London' }).returning();
  const householdId = hh!.id;
  await db.insert(settings).values({ householdId, key: 'public_origin', value: origin });
  const [mum] = await db.insert(people).values({ householdId, displayName: 'Mum', role: 'owner' }).returning();
  const [dad] = await db.insert(people).values({ householdId, displayName: 'Dad', role: 'parent' }).returning();
  const [gran] = await db.insert(people).values({ householdId, displayName: 'Gran', role: 'carer' }).returning();
  // Ollie joined two weeks before the mock's Monday, so the pilot measures have weeks to show.
  const [ollie] = await db.insert(people).values({ householdId, displayName: 'Ollie', role: 'child', pronouns: 'he', createdAt: new Date('2026-10-12T09:00:00Z') }).returning();
  const [jamie] = await db.insert(people).values({ householdId, displayName: 'Jamie', role: 'child', pronouns: 'she' }).returning();

  const [youtube] = await db
    .insert(services)
    .values({ householdId, name: 'YouTube', icon: 'video', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com', 'googlevideo.com', 'ytimg.com'] })
    .returning();
  const [roblox] = await db.insert(services).values({ householdId, name: 'Roblox', icon: 'pad', source: 'adguard', adguardId: 'roblox', domains: ['roblox.com', 'rbxcdn.com'] }).returning();
  const [minecraft] = await db.insert(services).values({ householdId, name: 'Minecraft', icon: 'cube', source: 'custom', domains: ['minecraft.net', 'mojang.com'] }).returning();
  const [video] = await db.insert(serviceGroups).values({ householdId, name: 'Video' }).returning();
  const [games] = await db.insert(serviceGroups).values({ householdId, name: 'Games' }).returning();
  await db.insert(serviceGroupMembers).values([
    { groupId: video!.id, serviceId: youtube!.id },
    { groupId: games!.id, serviceId: roblox!.id },
    { groupId: games!.id, serviceId: minecraft!.id },
  ]);
  for (const child of [ollie!, jamie!]) {
    await db.insert(policies).values([
      { childId: child.id, groupId: video!.id, defaultState: 'blocked' },
      { childId: child.id, groupId: games!.id, defaultState: 'blocked' },
    ]);
  }
  await db.insert(schedules).values([
    {
      householdId,
      name: 'School night',
      weekdays: [1, 2, 3, 4, 5],
      blocks: [
        { type: 'school', start: '08:30', end: '15:30' },
        { type: 'free', start: '15:30', end: '17:30' },
        { type: 'pause', start: '17:30', end: '18:15', label: 'Tea' },
        { type: 'free', start: '18:15', end: '19:30' },
        { type: 'wind-down', start: '19:30', end: '20:30' },
        { type: 'bed', start: '20:30', end: '07:00' },
      ],
    },
    {
      householdId,
      name: 'Weekend',
      weekdays: [0, 6],
      blocks: [
        { type: 'free', start: '08:00', end: '12:30' },
        { type: 'pause', start: '12:30', end: '13:15', label: 'Lunch' },
        { type: 'free', start: '13:15', end: '19:30' },
        { type: 'wind-down', start: '19:30', end: '20:30' },
        { type: 'bed', start: '20:30', end: '08:00' },
      ],
    },
  ]);
  const [ipad] = await db.insert(devices).values([
    { householdId, childId: ollie!.id, label: "Ollie's iPad", type: 'ipad', adguardName: 'ft-ollie-ipad', identifiers: ['192.168.1.50'] },
    { householdId, childId: jamie!.id, label: "Jamie's laptop", type: 'laptop', adguardName: 'ft-jamie-laptop', identifiers: ['192.168.1.51'] },
  ]).returning();

  // Last week's use, for the pilot measures: YouTube after school, Roblox at the weekend, and a few
  // minutes after bedtime one night. Minutes only, as the usage reader keeps them.
  const used: { deviceId: string; serviceId: string; minute: Date; queries: number }[] = [];
  const minutesOf = (day: number, hhmm: string, n: number, serviceId: string) => {
    const start = new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00Z`).getTime();
    for (let i = 0; i < n; i++) used.push({ deviceId: ipad!.id, serviceId, minute: new Date(start + i * 60_000), queries: 5 });
  };
  for (const day of [19, 20, 21, 22, 23]) minutesOf(day, '15:00', 35, youtube!.id);
  for (const day of [24, 25]) minutesOf(day, '10:00', 50, roblox!.id);
  minutesOf(22, '19:40', 6, youtube!.id);
  await db.insert(usageMinutes).values(used);

  // The night's backup, as backup.sh records it.
  await db.insert(settings).values({ householdId, key: 'last_backup', value: { at: '2026-10-26T02:31:12.000Z', ok: true, lastOkAt: '2026-10-26T02:31:12.000Z', bytes: 1_843_200, snapshot: '4f9c2a1e7b30', problem: null } });

  // What the mock shows at 18:32: Dad allowed Minecraft at 17:58, and Ollie planned YouTube at 18:30.
  await db.insert(overrides).values({
    householdId,
    childId: ollie!.id,
    targetKind: 'service',
    targetId: minecraft!.id,
    type: 'allow',
    startsAt: at('17:58'),
    endsAt: at('19:30'),
    countsAgainstAllowance: false,
    createdBy: dad!.id,
    createdAt: at('17:58'),
  });
  const [youtubeGrant] = await db.insert(grants).values({
    householdId,
    childId: ollie!.id,
    targetKind: 'service',
    targetId: youtube!.id,
    startsAt: at('18:30'),
    endsAt: at('19:00'),
    source: 'planned',
    status: 'active',
    createdAt: at('16:10'),
  }).returning();
  return { householdId, mum: mum!, dad: dad!, gran: gran!, ollie: ollie!, jamie: jamie!, roblox: roblox!, youtubeGrant: youtubeGrant! };
}
