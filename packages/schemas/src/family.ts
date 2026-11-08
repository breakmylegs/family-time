// The whole family (Phase 9, the pilot's transitions phase): stopping points, the parents' own
// screen time, and a cooperative family challenge.
import { z } from 'zod';

export const FamilyChallenge = z.object({
  id: z.uuid(),
  title: z.string(),
  target: z.number().int(),
  done: z.number().int(),
  /** Who ticked it, newest first: "Mum, today at 18:40". */
  ticks: z.array(z.object({ by: z.string(), when: z.string() })),
});
export type FamilyChallenge = z.infer<typeof FamilyChallenge>;

export const WholeFamily = z.object({
  /** The pilot's transitions phase or later: everything below is in use. */
  on: z.boolean(),
  /** Minutes a session or Allow gets to reach a natural stopping point. 0 is off. */
  stoppingPointMinutes: z.number().int(),
  parents: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      me: z.boolean(),
      /** Newest first: this week, then the three before. */
      weeks: z.array(z.object({ week: z.string(), label: z.string(), minutes: z.number().int().nullable() })),
    }),
  ),
  challenge: FamilyChallenge.nullable(),
});
export type WholeFamily = z.infer<typeof WholeFamily>;

export const MyScreenTimeRequest = z.object({ minutes: z.number().int().min(0).max(7 * 24 * 60) });
export const ChallengeRequest = z.object({ title: z.string().trim().min(3, 'Give the challenge a name of at least 3 letters.').max(60, 'Keep the name to 60 letters.'), target: z.number().int().min(1).max(14) });
export const StoppingPointRequest = z.object({ minutes: z.number().int().min(0).max(15) });
