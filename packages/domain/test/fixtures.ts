import type { Rules, Schedule, Service } from '../src/index.js';

export const TZ = 'Europe/London';
export const CHILD = 'child-ollie';

export const SERVICES: Service[] = [
  { id: 'youtube', name: 'YouTube', groupIds: ['video'] },
  { id: 'roblox', name: 'Roblox', groupIds: ['games'] },
  { id: 'facetime', name: 'FaceTime', groupIds: ['chat'] },
  { id: 'khan', name: 'Khan Academy', groupIds: [] },
];

/** The VALUES block's school night, Monday to Friday, plus a weekend. */
export const SCHEDULES: Schedule[] = [
  {
    id: 'school-night',
    name: 'School night',
    childId: null,
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
    id: 'weekend',
    name: 'Weekend',
    childId: null,
    weekdays: [0, 6],
    blocks: [
      { type: 'wind-down', start: '20:00', end: '21:00' },
      { type: 'bed', start: '21:00', end: '07:30' },
    ],
  },
];

export function rules(overrides: Partial<Rules> = {}): Rules {
  return {
    timeZone: TZ,
    childName: 'Ollie',
    childId: CHILD,
    services: SERVICES,
    policies: [
      { childId: CHILD, target: { kind: 'service', id: 'facetime' }, default: 'blocked', alwaysAllowed: true, allowedDuringWindDown: true },
      { childId: CHILD, target: { kind: 'service', id: 'khan' }, default: 'blocked', alwaysAllowed: true, allowedDuringWindDown: false },
    ],
    schedules: SCHEDULES,
    overrides: [],
    grants: [],
    ...overrides,
  };
}

/** A London wall-clock time as an instant, written plainly for tests: `at('2026-10-26 18:32')`. */
export function at(local: string): Date {
  const [d, t] = local.split(' ');
  const [y, m, day] = d!.split('-').map(Number);
  const [hh, mm] = t!.split(':').map(Number);
  // Build by search, independent of the code under test.
  for (const offset of [0, 60]) {
    const guess = new Date(Date.UTC(y!, m! - 1, day!, hh!, mm!) - offset * 60_000);
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(guess);
    if (s === `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) return guess;
  }
  throw new Error(`${local} does not exist in London`);
}
