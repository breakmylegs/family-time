// The kiosk's API (brief Part 11, ADR 0015): what the child's tablet reads and sends. Every label
// comes from the server in the child's words, so the kiosk never works out times or rules.
import { z } from 'zod';

export const KioskPairRequest = z.object({ code: z.string().regex(/^\d{6}$/, 'The code is six numbers.') });
export const KioskPairResponse = z.object({ token: z.string(), householdName: z.string() });

export const KioskChild = z.object({ id: z.uuid(), name: z.string() });
export const KioskUnlockRequest = z.object({ pin: z.string().regex(/^\d{4}$/, 'Your PIN is four numbers.') });
export const KioskUnlockResponse = z.object({ ticket: z.string() });
/** Owner: set (four numbers) or remove (null) a child's kiosk PIN. */
export const KioskPinRequest = z.object({ pin: z.string().regex(/^\d{4}$/, 'A PIN is four numbers.').nullable() });
export const KioskPinChild = z.object({ id: z.uuid(), name: z.string(), pin: z.boolean() });
export type KioskPinChild = z.infer<typeof KioskPinChild>;
/** `pin`: the child has a kiosk PIN, so the tablet asks for it before showing their home. */
export const KioskMe = z.object({ householdName: z.string(), children: z.array(KioskChild.extend({ pin: z.boolean() })) });
export type KioskMe = z.infer<typeof KioskMe>;

export const KioskTarget = z.object({ kind: z.enum(['service', 'group']), id: z.uuid() });
export type KioskTarget = z.infer<typeof KioskTarget>;

export const KioskHome = z.object({
  child: KioskChild,
  /** "Monday 18:32". */
  clock: z.string(),
  /** "Wind-down at 19:30", or null when nothing is coming today. */
  pill: z.object({ kind: z.enum(['wind-down', 'bed', 'pause']), label: z.string() }).nullable(),
  /** True in the bed block: the calm bedtime screen. */
  night: z.boolean(),
  /** "Sleep well, Ollie. See you at 07:00." */
  nightLine: z.string(),
  rightNow: z
    .object({
      title: z.string(),
      detail: z.string(),
      icon: z.string().nullable(),
      /** How much of the session has been used, 0 to 1. Null in finishing-up time: no countdown. */
      used: z.number().nullable(),
    })
    .nullable(),
  /** Null until the pilot switches the economy on. */
  week: z
    .object({
      leftMinutes: z.number().int(),
      /** "5 h 30 left to plan this week". */
      headline: z.string(),
      blocks: z.array(z.enum(['used', 'now', 'planned', 'left'])),
      /** "Each block is 30 minutes. Blocks you save turn into 10p on Sunday." */
      caption: z.string(),
    })
    .nullable(),
  planned: z.array(z.object({ id: z.uuid(), title: z.string(), when: z.string(), icon: z.string().nullable() })),
  jobs: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      picture: z.string(),
      reward: z.string(),
      /** `todo`: I did it. `waiting`: With Mum or Dad. `done`: approved today. */
      status: z.enum(['todo', 'waiting', 'done']),
    }),
  ),
  goal: z.object({ title: z.string(), savedPence: z.number().int(), targetPence: z.number().int(), saved: z.string(), target: z.string(), line: z.string() }).nullable(),
  ideas: z.array(z.object({ id: z.uuid(), text: z.string(), picture: z.string() })),
  /** Notes from parents: praise for a job, answers to requests. Newest first, the last few days. */
  notes: z.array(z.object({ id: z.string(), text: z.string(), from: z.string(), when: z.string() })),
  /** The Sunday reflection, when it is open. */
  reflection: z.object({ week: z.string(), answered: z.boolean() }).nullable(),
  /** The whole family (the transitions phase on): this week's challenge, and the grown-ups' own screen time. */
  family: z
    .object({
      challenge: z.object({ title: z.string(), target: z.number().int(), done: z.number().int() }).nullable(),
      /** "Grown-ups' screen time this week: 6 hours", when a parent has said. */
      grownUps: z.string().nullable(),
    })
    .nullable(),
  /** Which features the pilot phase has switched on. */
  features: z.object({ economy: z.boolean(), goal: z.boolean(), ideas: z.boolean(), reflection: z.boolean() }),
  /** What the children call their grown-ups: "Mum and Dad", and "Mum or Dad". */
  words: z.object({ both: z.string(), either: z.string() }),
});
export type KioskHome = z.infer<typeof KioskHome>;

/** What can be planned: the apps and groups, then the slots for one of them. */
export const KioskTargets = z.array(z.object({ kind: z.enum(['service', 'group']), id: z.uuid(), name: z.string(), icon: z.string().nullable() }));
export type KioskTargets = z.infer<typeof KioskTargets>;

export const KioskSlots = z.object({
  minutes: z.number().int(),
  /** "30 minutes is 1 block. You'll have 5 h left after." */
  cost: z.string(),
  slots: z.array(
    z.object({
      start: z.string(),
      /** "Now", or "19:00". */
      label: z.string(),
      ok: z.boolean(),
      /** Why not, in the child's words: "Wind-down starts at 19:30." */
      reason: z.string().nullable(),
      /** True when the only way is to ask a grown-up (the week's time is used up). */
      askOnly: z.boolean(),
    }),
  ),
});
export type KioskSlots = z.infer<typeof KioskSlots>;

export const KioskPlanRequest = z.object({ target: KioskTarget, start: z.iso.datetime(), minutes: z.union([z.literal(30), z.literal(60)]) });
export const KioskAskRequest = KioskPlanRequest;

/** A JPEG already shrunk on the tablet, as base64. About 200 KB at 1024 px; 1.5 MB at most. */
export const KioskDoneRequest = z.object({ photo: z.string().max(2_000_000).nullable().default(null) });

export const KioskIdeaRequest = z.object({ text: z.string().trim().min(1, 'Write your idea first.').max(40), picture: z.enum(['star', 'tent', 'pencil', 'ball', 'bike', 'book', 'lego', 'plant', 'heart']).default('star') });

export const KioskReflectionRequest = z.object({
  wentWell: z.string().trim().max(200).default(''),
  wasHard: z.string().trim().max(200).default(''),
  nextGoal: z.string().trim().max(200).default(''),
});

/** Settings: the kiosks a household has, and a new pairing code. */
export const KioskDevice = z.object({ id: z.uuid(), label: z.string(), createdAt: z.string(), lastSeen: z.string().nullable() });
export type KioskDevice = z.infer<typeof KioskDevice>;
export const KioskPairing = z.object({ code: z.string(), expires: z.string(), label: z.string(), kioskUrl: z.string().nullable() });
export type KioskPairing = z.infer<typeof KioskPairing>;
export const KioskPairingRequest = z.object({ label: z.string().trim().min(1).max(40).default('Kiosk') });

/** The owner's choice of what the kiosk calls the grown-ups: "Mum and Dad", "Dad", "Nana and Grandad". */
export const KioskWordsRequest = z.object({
  both: z
    .string()
    .trim()
    .min(2, 'Write what your children call you.')
    .max(40)
    .regex(/^[\p{L}' -]+$/u, 'Use only letters, spaces, hyphens and apostrophes, like Mum and Dad.'),
});
export const KioskWords = z.object({ both: z.string(), either: z.string() });
export type KioskWords = z.infer<typeof KioskWords>;

/** "Mum and Dad" becomes "Mum or Dad"; "Dad" stays "Dad". Only the last "and" changes, in any case. */
export function eitherOf(both: string): string {
  const m = /^(.*) and (.*)$/i.exec(both);
  return m ? `${m[1]} or ${m[2]}` : both;
}
