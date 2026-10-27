// The control engine. Pure: given the time and the household's rules, it says what each child may
// reach, why, in words a parent can read, and until when. No I/O; the clock is a parameter.
//
// Precedence, highest first (brief Part 4):
//   1. Pause: a parent's Pause everything, or a scheduled routine pause such as tea
//   2. Parent override: allow or block for a while
//   3. Schedule blocks: school, wind-down, bed
//   4. Allowed time: a grant the child planned or a parent approved, or "always allowed"
//   5. Default: the policy, normally blocked
//
// One exception protects sleep: an Allow does not beat bedtime unless the parent chose "Through
// bedtime" (`overridesBedtime`). A Block always wins over everything below it.

import { activeBlocks, blocksAround, ruleNameAt, type BlockInterval, type Schedule } from './schedule.js';
import { clockLabel } from './time.js';

export type State = 'allowed' | 'blocked' | 'paused';
export type Layer = 'pause' | 'override' | 'schedule' | 'allowed-time' | 'default';

export type Target = { kind: 'service'; id: string } | { kind: 'group'; id: string } | { kind: 'everything' };

export interface Service {
  id: string;
  name: string;
  groupIds: string[];
}

export interface Policy {
  childId: string;
  target: { kind: 'service'; id: string } | { kind: 'group'; id: string };
  default: 'blocked' | 'allowed';
  alwaysAllowed: boolean;
  allowedDuringWindDown: boolean;
}

export interface Override {
  id: string;
  childId: string;
  target: Target;
  type: 'allow' | 'block' | 'pause';
  start: Date;
  /** Null means until a parent resumes. Every other override ends on its own. */
  end: Date | null;
  createdByName: string;
  /** Only for allow: keeps working through bedtime. Off unless the parent chose it. */
  overridesBedtime?: boolean;
}

export interface Grant {
  id: string;
  childId: string;
  target: { kind: 'service'; id: string } | { kind: 'group'; id: string };
  start: Date;
  end: Date;
  source: 'planned' | 'approved';
  status: 'scheduled' | 'active' | 'paused' | 'ended' | 'refunded';
  /** Who said yes, for approved requests. */
  approvedByName?: string;
}

export interface Rules {
  timeZone: string;
  childName: string;
  childId: string;
  services: Service[];
  policies: Policy[];
  schedules: Schedule[];
  overrides: Override[];
  grants: Grant[];
}

export interface Decision {
  state: State;
  layer: Layer;
  /** A sentence for the parent app, used verbatim. */
  reason: string;
  /** When this decision next changes, or null when nothing scheduled changes it. */
  until: Date | null;
  /** The override, grant or block behind it, for the app to act on. */
  sourceId?: string;
}

const HORIZON_MS = 48 * 3_600_000;

function targets(target: Target, service: Service): boolean {
  if (target.kind === 'everything') return true;
  if (target.kind === 'service') return target.id === service.id;
  return service.groupIds.includes(target.id);
}

/** A service-level policy beats a group-level one. */
function policyFor(rules: Rules, service: Service): Policy | undefined {
  const mine = rules.policies.filter((p) => p.childId === rules.childId);
  return (
    mine.find((p) => p.target.kind === 'service' && p.target.id === service.id) ??
    mine.find((p) => p.target.kind === 'group' && service.groupIds.includes(p.target.id))
  );
}

function activeAt(start: Date, end: Date | null, at: Date): boolean {
  const t = at.getTime();
  return start.getTime() <= t && (end === null || t < end.getTime());
}

/** The newest matching override of the given types active at `at`. Newer instructions win. */
function override(rules: Rules, service: Service, at: Date, types: Override['type'][]): Override | undefined {
  return rules.overrides
    .filter((o) => o.childId === rules.childId && types.includes(o.type) && targets(o.target, service) && activeAt(o.start, o.end, at))
    .sort((a, b) => b.start.getTime() - a.start.getTime())[0];
}

interface Raw {
  state: State;
  layer: Layer;
  /** Builds the sentence once `until` is known. */
  say: (until: string | null) => string;
  sourceId?: string;
}

function blockName(b: BlockInterval): string {
  if (b.label) return b.label;
  return { school: 'School time', pause: 'Pause', 'wind-down': 'Wind-down', bed: 'Bedtime', free: 'Free time' }[b.type];
}

function decideRaw(rules: Rules, service: Service, at: Date): Raw {
  const name = rules.childName;
  const blocks = activeBlocks(rules.schedules, rules.childId, at, rules.timeZone);
  const policy = policyFor(rules, service);

  // 1. Pause
  const pause = override(rules, service, at, ['pause']);
  if (pause) {
    return {
      state: 'paused',
      layer: 'pause',
      sourceId: pause.id,
      say: (until) => (until ? `Paused by ${pause.createdByName} until ${until}.` : `Paused by ${pause.createdByName} until they resume.`),
    };
  }
  const routinePause = blocks.find((b) => b.type === 'pause');
  if (routinePause) {
    return { state: 'paused', layer: 'pause', say: (until) => `${blockName(routinePause)}. Everything is paused${until ? ` until ${until}` : ''}.` };
  }

  // 2. Parent override (an Allow gives way to bedtime unless it was made to run through it)
  const bed = blocks.find((b) => b.type === 'bed');
  const parentOverride = override(rules, service, at, ['allow', 'block']);
  if (parentOverride && !(parentOverride.type === 'allow' && bed && !parentOverride.overridesBedtime)) {
    const verb = parentOverride.type === 'allow' ? 'allowed it' : 'blocked it';
    return {
      state: parentOverride.type === 'allow' ? 'allowed' : 'blocked',
      layer: 'override',
      sourceId: parentOverride.id,
      say: (until) => `${parentOverride.createdByName} ${verb}${until ? ` until ${until}` : ' until they set it back'}.`,
    };
  }

  // 3. Schedule blocks
  if (bed) return { state: 'blocked', layer: 'schedule', say: (until) => `Bedtime${until ? ` until ${until}` : ''}.` };
  const school = blocks.find((b) => b.type === 'school');
  if (school) return { state: 'blocked', layer: 'schedule', say: (until) => `${blockName(school)}${until ? ` until ${until}` : ''}.` };
  const wind = blocks.find((b) => b.type === 'wind-down');
  if (wind && !policy?.allowedDuringWindDown) {
    return { state: 'blocked', layer: 'schedule', say: (until) => `${blockName(wind)}. Screens are off${until ? ` until ${until}` : ''}.` };
  }

  // 4. Allowed time
  const grant = rules.grants
    .filter((g) => g.childId === rules.childId && (g.status === 'scheduled' || g.status === 'active') && targets(g.target, service) && activeAt(g.start, g.end, at))
    .sort((a, b) => b.start.getTime() - a.start.getTime())[0];
  if (grant) {
    const minutes = Math.round((grant.end.getTime() - grant.start.getTime()) / 60_000);
    return {
      state: 'allowed',
      layer: 'allowed-time',
      sourceId: grant.id,
      say: () =>
        grant.source === 'planned'
          ? // No pronoun: V2 serves any family, and a guessed pronoun is worse than none.
            `${name} planned ${duration(minutes)} of screen time.`
          : `${grant.approvedByName ?? 'A parent'} said yes to ${name}'s request.`,
    };
  }
  if (policy?.alwaysAllowed) return { state: 'allowed', layer: 'allowed-time', say: () => 'Always allowed.' };

  // 5. Default
  if (policy?.default === 'allowed') return { state: 'allowed', layer: 'default', say: () => 'Allowed by your family rules.' };
  const rule = ruleNameAt(rules.schedules, rules.childId, at, rules.timeZone);
  return { state: 'blocked', layer: 'default', say: () => `Not planned today.${rule ? ` Usual ${rule.toLowerCase()} rule.` : ''}` };
}

function duration(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} hour${minutes >= 120 ? 's' : ''} ${minutes % 60} minutes`;
  return `${minutes} minutes`;
}

/** Every instant in the next 48 hours at which some rule starts or stops. */
function boundaries(rules: Rules, at: Date): number[] {
  const t = at.getTime();
  const limit = t + HORIZON_MS;
  const out = new Set<number>();
  const add = (d: Date | null | undefined) => {
    if (!d) return;
    const x = d.getTime();
    if (x > t && x <= limit) out.add(x);
  };
  for (const o of rules.overrides) if (o.childId === rules.childId) {
    add(o.start);
    add(o.end);
  }
  for (const g of rules.grants) if (g.childId === rules.childId) {
    add(g.start);
    add(g.end);
  }
  for (const b of blocksAround(rules.schedules, rules.childId, at, rules.timeZone, 1, 2)) {
    add(b.start);
    add(b.end);
  }
  return [...out].sort((a, b) => a - b);
}

/** The decision for one service, with when it changes. */
export function decide(rules: Rules, serviceId: string, at: Date): Decision {
  const service = rules.services.find((s) => s.id === serviceId);
  if (!service) throw new Error(`Unknown service ${serviceId}`);
  const now = decideRaw(rules, service, at);
  let until: Date | null = null;
  for (const b of boundaries(rules, at)) {
    const next = decideRaw(rules, service, new Date(b));
    if (next.state !== now.state || next.layer !== now.layer || next.sourceId !== now.sourceId) {
      until = new Date(b);
      break;
    }
  }
  return {
    state: now.state,
    layer: now.layer,
    reason: now.say(until ? clockLabel(until, at, rules.timeZone) : null),
    until,
    ...(now.sourceId ? { sourceId: now.sourceId } : {}),
  };
}

/** Every service for one child. */
export function decideAll(rules: Rules, at: Date): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const s of rules.services) out.set(s.id, decide(rules, s.id, at));
  return out;
}
