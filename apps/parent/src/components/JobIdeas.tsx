// Job ideas (Phase 7): suggestions for the family's ages and the season. Tapping one opens it in
// the job sheet to check and save; nothing is added by itself.
import type { JobIdeas as Ideas } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { pence } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';

type Idea = Ideas['ideas'][number];

const reward = (i: Idea) => (i.rewardType === 'money' ? pence(i.amount) : i.rewardType === 'flex' ? `${i.amount} points` : 'Praise only');

export function JobIdeas({ onPick }: { onPick: (idea: Idea, from: HTMLElement) => void }) {
  const [ideas, setIdeas] = useState<Ideas>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setIdeas(await api<Ideas>('GET', '/api/ai/job-ideas'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sec" aria-labelledby="ideas">
      <div className="sec-head">
        <h2 id="ideas">Ideas for new jobs</h2>
        <HelpButton topic="ai-suggestions" label="Suggestions from AI" />
      </div>
      {ideas ? (
        <div className="group">
          {ideas.ideas.map((i) => (
            <button key={i.title} type="button" className="job-row" aria-label={`Add ${i.title}, ${reward(i)}`} onClick={(e) => onPick(i, e.currentTarget)}>
              <span className="job-text">
                <span className="job-title">{i.title}</span>
                <span className="job-meta">{reward(i)}</span>
              </span>
              <Icon name="plus" className="ic chev" />
            </button>
          ))}
          {!ideas.ideas.length ? <p className="empty">No new ideas this time. You have plenty of jobs already.</p> : null}
        </div>
      ) : null}
      {ideas?.message ? <p className="list-note">{ideas.message} These ideas suit most ages.</p> : null}
      {error ? (
        <p className="empty" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={() => void load()}>
        {busy ? 'Thinking of ideas' : ideas ? 'More ideas' : 'Suggest some jobs'}
      </button>
    </section>
  );
}
