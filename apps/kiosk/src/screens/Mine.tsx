// Me (Phase 11): things I did away from screens, with praise from the grown-ups; things I can do and
// things I'm learning; and asking about a rule. Only this child's own, never a brother's or sister's.
import type { KioskHome, KioskMine } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Icon, IDEA_PICTURES } from '../icons';
import { useDialog } from './Home';

type Adding = { kind: 'did' } | { kind: 'learning' } | { kind: 'ask' };

const ADD = {
  did: { title: 'Something I did', label: 'What did you do away from screens?', placeholder: 'Built a den in the garden', max: 80, path: 'journal', pictures: true, button: 'Add it' },
  learning: { title: "Something I'm learning", label: 'What are you learning to do?', placeholder: 'Ride my bike with no stabilisers', max: 40, path: 'skills', pictures: true, button: 'Add it' },
  ask: { title: 'Ask about a rule', label: 'Which rule would you like to talk about, and why?', placeholder: 'Could I have more time on Saturdays?', max: 200, path: 'rule-asks', pictures: false, button: 'Send it' },
} as const;

export function Mine({ home, onDone }: { home: KioskHome; onDone: () => void }) {
  const [mine, setMine] = useState<KioskMine>();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState<Adding>();
  const base = `/children/${home.child.id}`;
  const load = useCallback(async () => {
    try {
      setMine(await api<KioskMine>('GET', `${base}/mine`));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [base]);
  useEffect(() => void load(), [load]);

  return (
    <main class="page" aria-label="Me">
      <header class="page-top">
        <button type="button" class="back" onClick={onDone}>
          <Icon name="left" />
          Back
        </button>
        <h1>Me</h1>
      </header>
      {error && !mine ? (
        <section class="card mine-locked" role="status">
          <Icon name="hand" />
          <p>{error}</p>
        </section>
      ) : null}
      {mine ? (
        <div class="mine">
          <section class="card" aria-labelledby="mine-did">
            <h2 id="mine-did">Things I did</h2>
            <ul class="mine-list">
              {mine.journal.map((j) => (
                <li key={j.id}>
                  <Icon name={j.picture} />
                  <span>
                    {j.text}
                    <small>{j.when}</small>
                    {j.praise ? (
                      <span class="praise">
                        <b>{j.praisedBy ?? 'A grown-up'}:</b> {j.praise}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {!mine.journal.length ? <p class="empty">Done something fun away from screens? Add it here.</p> : null}
            <button type="button" class="btn" onClick={() => setAdding({ kind: 'did' })}>
              <Icon name="plus" />
              Add something I did
            </button>
          </section>

          <section class="card" aria-labelledby="mine-can">
            <h2 id="mine-can">Things I can do</h2>
            <ul class="mine-list">
              {mine.canDo.map((s) => (
                <li key={s.id} class="can">
                  <Icon name="star" />
                  <span>{s.title}</span>
                </li>
              ))}
              {mine.learning.map((s) => (
                <li key={s.id}>
                  <Icon name={s.picture} />
                  <span>
                    {s.title}
                    <small>Learning</small>
                  </span>
                </li>
              ))}
            </ul>
            {!mine.canDo.length && !mine.learning.length ? <p class="empty">What are you learning? When you can do it, a grown-up adds a star.</p> : null}
            <button type="button" class="btn" onClick={() => setAdding({ kind: 'learning' })}>
              <Icon name="plus" />
              Add something I'm learning
            </button>
          </section>

          <section class="card" aria-labelledby="mine-ask">
            <h2 id="mine-ask">Ask about a rule</h2>
            <ul class="mine-list">
              {mine.ruleAsks.map((a) => (
                <li key={a.id}>
                  <Icon name="hand" />
                  <span>
                    {a.text}
                    <small>{a.status === 'answered' ? 'Answered' : a.status === 'review' ? "You'll talk about it at the family review" : 'Waiting for a grown-up'}</small>
                    {a.answer ? <span class="praise">{a.answer}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {!mine.ruleAsks.length ? <p class="empty">Is there a rule you'd like to talk about? You can ask any time.</p> : null}
            <button type="button" class="btn" onClick={() => setAdding({ kind: 'ask' })}>
              <Icon name="plus" />
              Ask about a rule
            </button>
          </section>
        </div>
      ) : null}
      {adding ? (
        <Add
          kind={adding.kind}
          path={`${base}/${ADD[adding.kind].path}`}
          onClose={() => {
            setAdding(undefined);
            void load();
          }}
        />
      ) : null}
    </main>
  );
}

function Add({ kind, path, onClose }: { kind: Adding['kind']; path: string; onClose: () => void }) {
  const a = ADD[kind];
  const [text, setText] = useState('');
  const [picture, setPicture] = useState('star');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('POST', path, a.pictures ? { text: text.trim(), title: text.trim(), picture } : { text: text.trim() });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={a.title} ref={useDialog(onClose)}>
      <div class="sheet">
        <h2 tabIndex={-1}>{a.title}</h2>
        <label for="mine-text">{a.label}</label>
        <input id="mine-text" class="field" value={text} maxLength={a.max} placeholder={a.placeholder} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        {a.pictures ? (
          <div class="pictures" role="group" aria-label="Choose a picture">
            {IDEA_PICTURES.map((p) => (
              <button key={p} type="button" aria-pressed={picture === p} aria-label={p.charAt(0).toUpperCase() + p.slice(1)} onClick={() => setPicture(p)}>
                <Icon name={p} />
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <p class="error" role="alert">
            {error}
          </p>
        ) : null}
        <div class="actions">
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn primary" disabled={!text.trim() || busy} onClick={() => void save()}>
            {a.button}
          </button>
        </div>
      </div>
    </div>
  );
}
