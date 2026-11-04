// The pilot's measures (brief Part 14, ADR 0017), for parents, week by week. Counts from what
// Family time already keeps; nothing here is shown to the child. Downloadable for a spreadsheet.
import type { PilotMeasures as Measures } from '@family-time/schemas';
import { useState } from 'react';
import { minutes, useFetched } from '../economy/data';
import { Icon } from '../icons';

export function PilotMeasures({ childId, childName }: { childId: string; childName: string }) {
  const { data, error } = useFetched<Measures>(`/api/children/${childId}/measures`);
  const [all, setAll] = useState(false);
  if (error && !data) return <p className="empty">Couldn't load the measures. Check your connection and open Family again.</p>;
  if (!data) return null;
  const weeks = all ? data.weeks : data.weeks.slice(0, 4);

  return (
    <>
      <ol className="group measures">
        {weeks.map((w) => {
          const total = w.minutesByApp.reduce((n, a) => n + a.minutes, 0);
          const endings = w.endings.calm + w.endings.grumble + w.endings.meltdown;
          return (
            <li key={w.week}>
              <h3>{w.label}</h3>
              <dl>
                <dt>Screen time</dt>
                <dd>{total ? `${minutes(total)}: ${w.minutesByApp.map((a) => `${a.app} ${minutes(a.minutes)}`).join(', ')}` : 'None recorded'}</dd>
                <dt>In wind-down and bedtime</dt>
                <dd>
                  {minutes(w.windDownMinutes)} in wind-down, {minutes(w.bedtimeMinutes)} at bedtime
                </dd>
                <dt>Unused time that became pocket money</dt>
                <dd>{minutes(w.unusedMinutesConverted)}</dd>
                <dt>Jobs and ideas</dt>
                <dd>
                  {w.jobsApproved} {w.jobsApproved === 1 ? 'job' : 'jobs'} approved, {w.offlineVariety} different {w.offlineVariety === 1 ? 'job or idea' : 'jobs and ideas'}
                </dd>
                <dt>How sessions ended</dt>
                <dd>{endings ? `${w.endings.calm} calm, ${w.endings.grumble} ${w.endings.grumble === 1 ? 'grumble' : 'grumbles'}, ${w.endings.meltdown} ${w.endings.meltdown === 1 ? 'meltdown' : 'meltdowns'}` : 'None tapped'}</dd>
              </dl>
            </li>
          );
        })}
      </ol>
      {data.weeks.length > 4 ? (
        <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => setAll(!all)}>
          {all ? 'Show the last four weeks' : `Show all ${data.weeks.length} weeks`}
        </button>
      ) : null}
      <a className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} href={`/api/children/${childId}/measures.csv`} download={`${childName} pilot measures.csv`}>
        <Icon name="down" />
        Download as a spreadsheet
      </a>
    </>
  );
}
