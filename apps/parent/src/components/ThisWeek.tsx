// "This week" on Control, from the mock: time left as 30-minute blocks, the bonus, the next step.
import type { WeekSummary } from '@family-time/schemas';
import { minutes, pence } from '../economy/data';
import { HelpButton } from '../help/HelpButton';

const BLOCK = 30;

/** "8 Nov", from the server's date. */
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function ThisWeek({ week }: { week: WeekSummary }) {
  const used = Math.round(week.usedMinutes / BLOCK);
  const planned = Math.round(week.plannedMinutes / BLOCK);
  const left = Math.floor(Math.max(0, week.leftMinutes) / BLOCK);
  const total = Math.max(Math.round(week.allowanceMinutes / BLOCK), used + planned + left, 1);
  const blocks = Array.from({ length: total }, (_, i) => (i < used ? 'used' : i < used + planned ? 'planned' : i < used + planned + left ? '' : 'used'));
  const spoken = `${minutes(week.leftMinutes)} left to plan of ${minutes(week.allowanceMinutes)}. ${minutes(week.usedMinutes)} used${week.plannedMinutes ? `, ${minutes(week.plannedMinutes)} planned` : ''}.`;

  return (
    <section className="sec" aria-labelledby="this-week">
      <div className="sec-head">
        <h2 id="this-week">This week</h2>
        <HelpButton topic="weekly-allowance" label="Weekly allowance" />
      </div>
      <div className="group week">
        <p className="week-total tnum">
          {minutes(week.leftMinutes)} left to plan <span>of {minutes(week.allowanceMinutes)}</span>
        </p>
        <div className="blocks" role="img" aria-label={spoken} style={{ gridTemplateColumns: `repeat(${Math.min(total, 14)}, 1fr)` }}>
          {blocks.map((c, i) => (
            <i key={i} className={`blk ${c}`} />
          ))}
        </div>
        <p className="week-cap">
          Each block is 30 minutes. Resets {week.resets}.
        </p>
        <div className="wrows">
          {week.features.bonus ? (
            <div className="wrow">
              <span className="wrow-label">Unused-time bonus</span>
              <HelpButton topic="unused-time-bonus" label="Unused-time bonus" />
              <span className="wrow-value tnum">{week.lastWeek ? `Last week ${pence(week.lastWeek.bonusPence)}` : `${pence(week.rates.pencePerBlock)} per 30 minutes`}</span>
            </div>
          ) : null}
          {week.nextStep ? (
            <div className="wrow">
              <span className="wrow-label">Reduction plan</span>
              <HelpButton topic="gradual-reduction" label="Gradual reduction plan" />
              <span className="wrow-value tnum">
                {minutes(week.nextStep.minutes)} from {shortDate(week.nextStep.on)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
