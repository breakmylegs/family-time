import { z } from 'zod';

export const RewardType = z.enum(['money', 'flex', 'time', 'praise']);
export type RewardType = z.infer<typeof RewardType>;

export const Recurrence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once') }),
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('weekly'), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
]);
export type Recurrence = z.infer<typeof Recurrence>;

/** The pictures a job can have: the app's own icons, no uploads. */
export const TASK_PICTURES = ['star', 'dishes', 'bed', 'bin', 'plant', 'book', 'bike', 'lego', 'pencil', 'ball', 'heart', 'tent'] as const;

export const TaskInput = z
  .object({
    title: z.string().trim().min(1, 'Give the job a name.').max(80),
    picture: z.enum(TASK_PICTURES).default('star'),
    rewardType: RewardType,
    amount: z.number().int().min(0).max(10_000),
    recurrence: Recurrence.default({ kind: 'daily' }),
    ageBand: z.enum(['5-7', '8-10', '11-13', '14+']).nullable().default(null),
    needsPhoto: z.boolean().default(false),
    /** Null: any child in the family. */
    childId: z.uuid().nullable().default(null),
  })
  .refine((t) => (t.rewardType === 'praise' ? t.amount === 0 : t.amount > 0), { message: 'Praise-only jobs carry no points; every other job needs an amount above zero.', path: ['amount'] });
export type TaskInput = z.infer<typeof TaskInput>;

export const Task = z.object({
  id: z.uuid(),
  title: z.string(),
  picture: z.string(),
  rewardType: RewardType,
  amount: z.number().int(),
  recurrence: Recurrence,
  ageBand: z.string().nullable(),
  needsPhoto: z.boolean(),
  childId: z.uuid().nullable(),
  active: z.boolean(),
  /** "50p", "20 points", "15 min", "Praise only". */
  rewardLabel: z.string(),
});
export type Task = z.infer<typeof Task>;

export const Reward = z.object({ type: RewardType, amount: z.number().int(), label: z.string() });

export const ApprovalItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('completion'),
    id: z.uuid(),
    childId: z.uuid(),
    childName: z.string(),
    title: z.string(),
    /** "today at 17:05". */
    when: z.string(),
    reward: Reward,
    /** What approving will pay, which the earned-time cap can make less than the job's amount. */
    willPay: z.object({ amount: z.number().int(), label: z.string() }).nullable(),
    /** Shown before the tap when the cap cuts the payment. */
    capNote: z.string().nullable(),
    hasPhoto: z.boolean(),
    suggestions: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('request'),
    id: z.uuid(),
    childId: z.uuid(),
    childName: z.string(),
    title: z.string(),
    /** The app asked for: "Roblox". */
    target: z.string(),
    when: z.string(),
    minutes: z.number().int(),
    /** "19:00 to 19:30". */
    window: z.string(),
    /** "Uses 30 minutes of his own time. He has 5 h 30 left this week, and wind-down starts at 19:30." */
    detail: z.string(),
    /** Null when it can be approved from the allowance. */
    blockedReason: z.string().nullable(),
    /** True when the only way to say yes is as extra time (the allowance has run out). */
    extraOnly: z.boolean(),
  }),
  // What AI or a connected app suggests (Phase 7). Nothing happens until a parent taps Approve.
  z.object({
    kind: z.literal('proposal'),
    id: z.uuid(),
    childId: z.uuid(),
    childName: z.string(),
    /** "Allow YouTube for Ollie for an hour". */
    title: z.string(),
    /** "Suggested by AI", "Suggested by Claude". */
    from: z.string(),
    /** What was typed or asked, shown as it was and never run. */
    asked: z.string().nullable(),
    when: z.string(),
    /** "This card closes at 19:02 if nobody answers it". */
    expires: z.string(),
    /** `parent`: an Allow or Block, which carers cannot approve. */
    needs: z.enum(['parent', 'anyone']),
  }),
]);
export type ApprovalItem = z.infer<typeof ApprovalItem>;

export const ApproveRequest = z.object({ note: z.string().trim().max(280).nullable().default(null) });
export const DecideRequestBody = z.object({ asExtra: z.boolean().default(false) });

export const WeekSummary = z.object({
  childId: z.uuid(),
  features: z.object({ economy: z.boolean(), bonus: z.boolean(), goal: z.boolean(), taper: z.boolean() }),
  allowanceMinutes: z.number().int(),
  leftMinutes: z.number().int(),
  plannedMinutes: z.number().int(),
  usedMinutes: z.number().int(),
  earnedMinutes: z.number().int(),
  earnedCapMinutes: z.number().int(),
  /** "Sunday at 18:00". */
  resets: z.string(),
  moneyPence: z.number().int(),
  flexPoints: z.number().int(),
  lastWeek: z.object({ minutesLeft: z.number().int(), bonusPence: z.number().int() }).nullable(),
  nextStep: z
    .object({
      minutes: z.number().int(),
      on: z.string(),
      onLabel: z.string(),
      agreed: z.boolean(),
      /** False until the pilot reaches its taper phase: until then no step happens, agreed or not. */
      active: z.boolean(),
      stepMinutes: z.number().int(),
      everyWeeks: z.number().int(),
      floorMinutes: z.number().int(),
      /** The reset days a step can fall on, for the plan sheet: the next four. */
      resetDays: z.array(z.object({ on: z.string(), label: z.string() })),
    })
    .nullable(),
  /** The next four reset days, for setting up a plan when there is none yet. */
  resetDays: z.array(z.object({ on: z.string(), label: z.string() })),
  goal: z.object({ title: z.string(), targetPence: z.number().int(), savedPence: z.number().int(), matchPercent: z.number().int() }).nullable(),
  /** The child's answers to the Sunday questions on the kiosk, this week's or last week's. */
  reflection: z.object({ week: z.string(), wentWell: z.string(), wasHard: z.string(), nextGoal: z.string() }).nullable(),
  rates: z.object({ pencePerBlock: z.number().int(), weeklyCapPence: z.number().int(), flexPence: z.number().int(), flexMinutes: z.number().int() }),
});
export type WeekSummary = z.infer<typeof WeekSummary>;

export const LedgerLine = z.object({
  ref: z.string(),
  kind: z.string(),
  at: z.string(),
  when: z.string(),
  reason: z.string(),
  /** "+50p", "-30 min", "+20 points". */
  change: z.string(),
  reversible: z.boolean(),
});
export type LedgerLine = z.infer<typeof LedgerLine>;

/** `key` is made by the app once per tap, so a retry after a lost answer is recorded once. */
/** The owner's Ledger screen: every entry, and on the Besu ledger, where it is on the chain. */
export const ChainLedger = z.object({
  adapter: z.enum(['postgres', 'besu']),
  contract: z.object({ address: z.string(), version: z.string(), deployedBlock: z.number().int(), indexedBlock: z.number().int().nullable() }).nullable(),
  queue: z.object({ pending: z.number().int(), sent: z.number().int(), mined: z.number().int(), failed: z.number().int() }).nullable(),
  entries: z.array(
    z.object({
      seq: z.number().int(),
      when: z.string(),
      childName: z.string(),
      kind: z.string(),
      reason: z.string(),
      change: z.string(),
      /** On the Postgres ledger, always `recorded`. */
      status: z.enum(['recorded', 'waiting', 'sent', 'confirmed', 'refused']),
      blockNumber: z.number().int().nullable(),
      txHash: z.string().nullable(),
    }),
  ),
});
export type ChainLedger = z.infer<typeof ChainLedger>;

export const PayoutRequest = z.object({ pence: z.number().int().min(1).max(100_000), key: z.uuid() });
export const ConvertRequest = z.object({ points: z.number().int().min(1).max(100_000), to: z.enum(['MONEY', 'TIME']), key: z.uuid() });
export const RefundPointsRequest = z.object({ points: z.number().int().min(1).max(1000), reason: z.string().trim().min(1).max(120), key: z.uuid() });
export const ReverseRequest = z.object({ entryRef: z.string().min(1).max(200) });
export const AllowanceRequest = z.object({
  minutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .refine((m) => m % 30 === 0, 'The allowance is in 30-minute blocks.'),
});
export const PlanRequest = z.object({
  stepMinutes: z.number().int().min(0).max(600),
  everyWeeks: z.number().int().min(1).max(52),
  floorMinutes: z.number().int().min(0).max(7 * 24 * 60),
  nextStepOn: z.iso.date(),
});
export const GoalRequest = z.object({
  title: z.string().trim().min(1).max(80),
  targetPence: z.number().int().min(1).max(1_000_000),
  /** Parental matching: the parents add this percent of each week's pocket money towards the goal. */
  matchPercent: z.number().int().min(0).max(100).default(0),
});
export const PilotPhaseRequest = z.object({ phase: z.enum(['baseline', 'reframe', 'reward-less', 'transitions', 'taper']) });
