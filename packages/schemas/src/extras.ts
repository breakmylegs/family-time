// Phase 11: enhancements from the research (docs/plans/phase-11.md). Praise, never points.
import { z } from 'zod';

export const AGE_BANDS = ['5-7', '8-10', '11-13', '14+'] as const;
export const AgeBand = z.enum(AGE_BANDS);
export type AgeBand = z.infer<typeof AgeBand>;

export const PICTURES = ['star', 'tent', 'pencil', 'ball', 'bike', 'book', 'lego', 'plant', 'heart'] as const;

/** One item of a child's platform setup checklist, in a parent's words. */
export const ChecklistItem = z.object({ id: z.string(), title: z.string(), detail: z.string(), done: z.boolean() });
export const SetupChecklist = z.object({ childId: z.uuid(), name: z.string(), ageBand: AgeBand.nullable(), items: z.array(ChecklistItem) });
export type SetupChecklist = z.infer<typeof SetupChecklist>;

/** Family's view of one child's extras: what they did, what they can do, their rule questions, the estimates. */
export const ChildExtras = z.object({
  journal: z.array(z.object({ id: z.uuid(), text: z.string(), picture: z.string(), when: z.string(), praise: z.string().nullable() })),
  skills: z.array(z.object({ id: z.uuid(), title: z.string(), picture: z.string(), mastered: z.boolean(), since: z.string() })),
  ruleAsks: z.array(z.object({ id: z.uuid(), text: z.string(), when: z.string(), status: z.enum(['open', 'review', 'answered']), answer: z.string().nullable() })),
  /** The parents' estimate of screen time away from managed devices this week, or null if not given. */
  unmanagedMinutes: z.number().int().nullable(),
  /** This month's mood check, if one has been done. */
  mood: z.object({ month: z.string(), rating: z.number().int(), note: z.string().nullable() }).nullable(),
  /** The month label the mood check is for: "November". */
  monthLabel: z.string(),
});
export type ChildExtras = z.infer<typeof ChildExtras>;

export const AgeBandRequest = z.object({ ageBand: AgeBand.nullable() });
export const ChecklistTickRequest = z.object({ done: z.boolean() });
export const UnmanagedRequest = z.object({ minutes: z.number().int().min(0).max(7 * 24 * 60) });
export const MoodRequest = z.object({ rating: z.number().int().min(1).max(5), note: z.string().trim().max(300).optional() });
export const PraiseRequest = z.object({ text: z.string().trim().min(1, 'Write a few words first.').max(200) });
export const SkillRequest = z.object({ title: z.string().trim().min(1, 'Write the skill first.').max(40), picture: z.enum(PICTURES).default('star') });
export const RuleAnswerRequest = z.object({ action: z.enum(['review', 'answer']), answer: z.string().trim().max(300).optional() });

/** From the kiosk. */
export const KioskJournalRequest = z.object({ text: z.string().trim().min(1, 'Write what you did first.').max(80), picture: z.enum(PICTURES).default('star') });
export const KioskSkillRequest = SkillRequest;
export const KioskRuleAskRequest = z.object({ text: z.string().trim().min(1, 'Write what you would like to talk about.').max(200) });

/** The kiosk's "Me" screen. */
export const KioskMine = z.object({
  journal: z.array(z.object({ id: z.uuid(), text: z.string(), picture: z.string(), when: z.string(), praise: z.string().nullable(), praisedBy: z.string().nullable() })),
  learning: z.array(z.object({ id: z.uuid(), title: z.string(), picture: z.string() })),
  canDo: z.array(z.object({ id: z.uuid(), title: z.string(), picture: z.string() })),
  ruleAsks: z.array(z.object({ id: z.uuid(), text: z.string(), status: z.enum(['open', 'review', 'answered']), answer: z.string().nullable() })),
});
export type KioskMine = z.infer<typeof KioskMine>;
