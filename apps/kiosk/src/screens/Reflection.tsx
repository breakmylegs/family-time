// The Sunday reflection (brief Parts 11 and 14): three short questions about the week. The
// answers go to the family chat on the parents' Family screen. Any of them can be left blank.
import type { KioskHome } from '@family-time/schemas';
import { useState } from 'preact/hooks';
import { api } from '../api';
import { Icon } from '../icons';

const QUESTIONS = [
  { key: 'wentWell', label: 'What went well this week?', hint: 'Something you enjoyed, or something you did well.' },
  { key: 'wasHard', label: 'What was tricky?', hint: 'Anything that felt hard, big or small.' },
  { key: 'nextGoal', label: 'What would you like to try next week?', hint: 'One small thing.' },
] as const;

export function Reflection({ home, onDone }: { home: KioskHome; onDone: () => void }) {
  const [answers, setAnswers] = useState({ wentWell: '', wasHard: '', nextGoal: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('POST', `/children/${home.child.id}/reflection`, answers);
      setSaved(true);
      setTimeout(onDone, 1600);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="page" aria-label="How was your week?">
      <header class="page-top">
        <button type="button" class="back" onClick={onDone}>
          <Icon name="left" />
          Back
        </button>
        <h1>How was your week?</h1>
      </header>
      {saved ? (
        <p class="sent big" role="status">
          <Icon name="check" />
          Thanks, {home.child.name}. You can talk about it together.
        </p>
      ) : (
        <div class="reflect-form">
          {QUESTIONS.map((q) => (
            <div key={q.key} class="q">
              <label for={q.key}>{q.label}</label>
              <textarea id={q.key} maxLength={200} placeholder={q.hint} value={answers[q.key]} onInput={(e) => setAnswers((a) => ({ ...a, [q.key]: (e.target as HTMLTextAreaElement).value }))} />
            </div>
          ))}
          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}
          <div class="actions">
            <button type="button" class="btn primary big" disabled={busy} onClick={() => void save()}>
              <Icon name="check" />
              {busy ? 'Sending' : 'Send my answers'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
