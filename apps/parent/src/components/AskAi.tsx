// Plain-English control (Phase 7): type what you want and get a card on Approvals. Shown only when
// the owner has switched it on. Nothing changes until someone approves the card.
import type { AiControlResult } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { HelpButton } from '../help/HelpButton';
import { navigate } from '../router';

export function AskAi() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; cards: boolean }>();

  const send = async () => {
    setBusy(true);
    setAnswer(undefined);
    try {
      const r = await api<AiControlResult>('POST', '/api/ai/control', { text: text.trim() });
      if (r.ok) {
        setAnswer({ text: r.note, cards: r.made.length > 0 });
        if (r.made.length) setText('');
      } else setAnswer({ text: `${r.message} ${r.fallback}`, cards: false });
    } catch (err) {
      setAnswer({ text: (err as Error).message, cards: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sec" aria-labelledby="ask">
      <div className="sec-head">
        <h2 id="ask">Ask in your own words</h2>
        <HelpButton topic="ai-suggestions" label="Suggestions from AI" />
      </div>
      <form
        className="say ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3 && !busy) void send();
        }}
      >
        <label htmlFor="ask-text" className="sr">
          What would you like?
        </label>
        <textarea id="ask-text" value={text} maxLength={280} placeholder='For example, "YouTube for an hour after homework"' onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-quiet" disabled={busy || text.trim().length < 3}>
          {busy ? 'Making a card' : 'Make a card to approve'}
        </button>
      </form>
      {answer ? (
        <p className="req-detail" role="status">
          {answer.text}{' '}
          {answer.cards ? (
            <button type="button" className="link" onClick={() => navigate('/approvals')}>
              Open Approvals
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
