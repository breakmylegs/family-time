// A short note on the week for the family review (Phase 7), from totals only. Written by AI when
// the owner has switched it on, otherwise from the same totals in plain words.
import type { WeekNote as Note } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';

export function WeekNote({ childId }: { childId: string }) {
  const [note, setNote] = useState<Note>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setNote(await api<Note>('GET', `/api/children/${childId}/week-note`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="week-note">
      {note ? (
        <p>
          {note.text}
          <small>{note.fromAi ? ' Written by AI from the totals.' : ''}</small>
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void load()}>
        {busy ? 'Writing the note' : note ? 'Write it again' : 'Write a note on the week'}
      </button>
    </div>
  );
}
