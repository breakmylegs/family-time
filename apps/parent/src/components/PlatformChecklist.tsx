// The setup checklist (Phase 11): settings parents change in each app and on each device, outside
// Family time, chosen by the child's age band. Family time only keeps the ticks.
import { AGE_BANDS, type AgeBand, type SetupChecklist } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { useFetched } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { useToast } from '../toast';

export const AGE_WORDS: Record<AgeBand, string> = { '5-7': '5 to 7', '8-10': '8 to 10', '11-13': '11 to 13', '14+': '14 and over' };

export function PlatformChecklist() {
  const toast = useToast();
  const { data, error, reload } = useFetched<SetupChecklist[]>('/api/setup/checklists');
  const [childId, setChildId] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const kid = data?.find((c) => c.childId === childId) ?? data?.[0];

  const send = async (key: string, path: string, body: unknown, done?: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await api('PUT', path, body);
      if (done) toast(done);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(undefined);
      void reload();
    }
  };

  if (error && !data) return <p className="empty">Couldn&apos;t load the checklist. Check your connection and open Set-up again.</p>;
  if (!data || !kid) return null;
  const done = kid.items.filter((i) => i.done).length;

  return (
    <section className="sec" aria-labelledby="setup-checklist">
      <div className="sec-head">
        <h2 id="setup-checklist">Settings and habits outside Family time</h2>
        <HelpButton topic="platform-setup" label="Settings and habits outside Family time" />
      </div>
      {data.length > 1 ? (
        <div className="choice choice-above" role="group" aria-label="Whose checklist">
          {data.map((c) => (
            <button key={c.childId} type="button" aria-pressed={c.childId === kid.childId} onClick={() => setChildId(c.childId)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="group">
        <div className="row">
          <span className="row-text">
            <span id={`age-${kid.childId}`}>{kid.name}&apos;s age</span>
            <small>{kid.ageBand ? 'The checklist and its advice fit this age.' : 'Choose one to see everything for this age.'}</small>
            <span className="choice" role="group" aria-labelledby={`age-${kid.childId}`} style={{ marginTop: 8 }}>
              {AGE_BANDS.map((b) => (
                <button key={b} type="button" aria-pressed={kid.ageBand === b} disabled={busy !== undefined} onClick={() => void send('age', `/api/children/${kid.childId}/age-band`, { ageBand: kid.ageBand === b ? null : b }, kid.ageBand === b ? 'Age cleared.' : `Saved: ${AGE_WORDS[b]}.`)}>
                  {AGE_WORDS[b]}
                </button>
              ))}
            </span>
          </span>
        </div>
        {kid.items.map((item) => (
          <div key={item.id} className="row">
            <span className="row-text">
              <span id={`check-${kid.childId}-${item.id}`}>{item.title}</span>
              <small>{item.detail}</small>
            </span>
            <span className="row-end">
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={item.done}
                aria-labelledby={`check-${kid.childId}-${item.id}`}
                disabled={busy !== undefined}
                onClick={() => void send(item.id, `/api/children/${kid.childId}/checklist/${item.id}`, { done: !item.done }, item.done ? 'Marked as not done.' : 'Marked as done.')}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="hint" aria-live="polite">
        {done === kid.items.length ? `All done for ${kid.name}.` : `${done} of ${kid.items.length} done for ${kid.name}.`}
      </p>
    </section>
  );
}
