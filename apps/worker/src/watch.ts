// Two more alerts (Phase 9, brief Part 12). AdGuard's own health: when it stops answering, or its
// protection is switched off, for three minutes in a row, owners and parents hear once, and once
// more when it is working again. And the family review: an hour before the week resets, a nudge
// that the agenda is ready, once a week, while the pilot's economy is on.
import type { AdGuard } from '@family-time/adguard-client';
import { households, settings, type Db } from '@family-time/db';
import { features, parseWeekReset, weekStarting } from '@family-time/domain';
import { and, eq } from 'drizzle-orm';

/** Minutes in a row AdGuard must be unwell before anyone is told: a restart takes less. */
export const ADGUARD_ALERT_AFTER = 3;

/** What is wrong with AdGuard, in a sentence, or null when it is answering and protecting. */
export async function adguardProblem(adguard: AdGuard): Promise<string | null> {
  try {
    const s = await adguard.status();
    if (!s.running) return 'The blocking service has stopped.';
    if (!s.protection_enabled) return 'The blocking service has been switched off.';
    return null;
  } catch {
    return "The blocking service isn't answering.";
  }
}

/** Counts unwell checks in a row; says `down` on the one that reaches the limit and `up` when it recovers after that. */
export class AdGuardWatch {
  private failures = 0;
  private told = false;

  observe(problem: string | null): 'down' | 'up' | undefined {
    if (problem) {
      this.failures++;
      if (this.failures === ADGUARD_ALERT_AFTER && !this.told) {
        this.told = true;
        return 'down';
      }
      return undefined;
    }
    this.failures = 0;
    if (this.told) {
      this.told = false;
      return 'up';
    }
    return undefined;
  }
}

export const SETTING_REVIEW_REMINDED = 'review_reminded_week';
export const REVIEW_REMINDER_MS = 60 * 60_000;

/** Households whose week resets within the hour and who have not had this week's reminder. Marks them as reminded. */
export async function reviewsDue(db: Db, now: Date): Promise<{ householdId: string; resets: Date; timeZone: string }[]> {
  const due: { householdId: string; resets: Date; timeZone: string }[] = [];
  for (const h of await db.select().from(households)) {
    if (!features(h.pilotPhase).economy) continue;
    const w = weekStarting(now, parseWeekReset(h.weekResets), h.timezone);
    if (w.next.getTime() - now.getTime() > REVIEW_REMINDER_MS) continue;
    const key = and(eq(settings.householdId, h.id), eq(settings.key, SETTING_REVIEW_REMINDED));
    const last = (await db.select({ value: settings.value }).from(settings).where(key))[0]?.value;
    if (last === w.date) continue;
    await db
      .insert(settings)
      .values({ householdId: h.id, key: SETTING_REVIEW_REMINDED, value: w.date })
      .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value: w.date } });
    due.push({ householdId: h.id, resets: w.next, timeZone: h.timezone });
  }
  return due;
}
