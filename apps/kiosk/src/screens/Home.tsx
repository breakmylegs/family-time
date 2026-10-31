// Home, from the mock: hello and the time, what's on now, the week as 30-minute blocks with Plan my
// time, my jobs with I did it, my savings goal, and my own ideas for when I'm bored.
import type { KioskHome } from '@family-time/schemas';
import { useRef, useState } from 'preact/hooks';
import { api } from '../api';
import type { Screen } from '../App';
import { Icon, IDEA_PICTURES } from '../icons';

interface Props {
  home: KioskHome;
  go: (s: Screen) => void;
  reload: () => Promise<void>;
  switchChild?: () => void;
}

export function Home({ home, go, reload, switchChild }: Props) {
  const [job, setJob] = useState<KioskHome['jobs'][number]>();
  const [adding, setAdding] = useState(false);
  const [planned, setPlanned] = useState(false);
  const base = `/children/${home.child.id}`;

  return (
    <main class="home" aria-label={`${home.child.name}'s screen`}>
      <header class="top">
        <div class="hello">
          <h1>
            {switchChild ? (
              <button type="button" class="hi-switch" onClick={switchChild}>
                Hi {home.child.name}
              </button>
            ) : (
              <>Hi {home.child.name}</>
            )}
          </h1>
          {/* The newest note from Mum or Dad: praise for a job, or an answer to asking. */}
          {home.notes[0] ? (
            <p class="note" role="status">
              <b>{home.notes[0].from}:</b> {home.notes[0].text}
            </p>
          ) : null}
        </div>
        <button type="button" class="link" onClick={() => go({ name: 'parents' })}>
          <Icon name="eye" />
          What Mum and Dad can see
        </button>
        <p class="clock">{home.clock}</p>
        {home.pill ? (
          <p class={`pill ${home.pill.kind}`}>
            <Icon name={home.pill.kind === 'pause' ? 'clock' : 'moon'} />
            {home.pill.label}
          </p>
        ) : null}
      </header>

      <div class="grid">
        <div class="col">
          <section class="card now" aria-label="Right now">
            {home.rightNow ? (
              <>
                <div class="now-row">
                  <span class="now-icon">
                    <Icon name={home.rightNow.icon ?? 'apps'} />
                  </span>
                  <div>
                    <h2>{home.rightNow.title}</h2>
                    <p>{home.rightNow.detail}</p>
                  </div>
                </div>
                <div class="bar" role="img" aria-label="How much of this session has been used">
                  <i style={{ transform: `scaleX(${home.rightNow.used})` }} />
                </div>
              </>
            ) : (
              <div class="now-row">
                <span class="now-icon quiet">
                  <Icon name="clock" />
                </span>
                <div>
                  <h2>Nothing on right now</h2>
                  <p>{home.week ? (home.features.ideas ? 'Plan some time, or try one of your ideas.' : 'Plan some time, or ask a grown-up.') : "Ask a grown-up if you'd like some screen time."}</p>
                </div>
              </div>
            )}
          </section>

          {home.week ? (
            <section class="card week" aria-label="This week">
              <h2>{home.week.headline}</h2>
              <div class="blocks" aria-hidden="true">
                {home.week.blocks.map((b, i) => (
                  <i key={i} class={`blk ${b}`}>
                    {b === 'used' ? <Icon name="check" /> : b === 'now' ? <Icon name="play" /> : null}
                  </i>
                ))}
              </div>
              <p class="caption">{home.week.caption}</p>
              <div class="actions">
                <button type="button" class="btn primary" onClick={() => go({ name: 'plan' })}>
                  <Icon name="clock" />
                  Plan my time
                </button>
                <button type="button" class="btn" aria-expanded={planned} onClick={() => setPlanned((p) => !p)}>
                  <Icon name="list" />
                  What's planned
                </button>
                <button type="button" class="btn" onClick={() => go({ name: 'plan', ask: true })}>
                  <Icon name="hand" />
                  Ask a grown-up
                </button>
              </div>
              {planned ? (
                <ul class="planned">
                  {home.planned.length ? (
                    home.planned.map((p) => (
                      <li key={p.id}>
                        <Icon name={p.icon ?? 'apps'} />
                        <span>
                          <b>{p.title}</b> {p.when}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li class="empty">Nothing planned yet.</li>
                  )}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        <div class="col">
          {home.reflection && !home.reflection.answered ? (
            <section class="card reflect" aria-label="How was your week?">
              <h2>How was your week?</h2>
              <p>Three quick questions. Mum or Dad will read your answers, then you can talk about them together.</p>
              <button type="button" class="btn primary" onClick={() => go({ name: 'reflection' })}>
                Answer the questions
              </button>
            </section>
          ) : null}

          {home.features.economy ? (
            <section class="card jobs" aria-label="My jobs">
              <h2>My jobs</h2>
              {home.jobs.length ? (
                <ul>
                  {home.jobs.map((j) => (
                    <li key={j.id}>
                      <span class="job-title">{j.title}</span>
                      <span class="tag">{j.reward}</span>
                      {j.status === 'todo' ? (
                        <button type="button" class="btn primary small" onClick={() => setJob(j)}>
                          <Icon name="check" />I did it
                        </button>
                      ) : j.status === 'waiting' ? (
                        <span class="with">
                          <Icon name="clock" />
                          With Mum or Dad
                        </span>
                      ) : (
                        <span class="with done">
                          <Icon name="check" />
                          Done
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="empty">No jobs today.</p>
              )}
            </section>
          ) : null}

          {home.goal ? (
            <section class="card goal" aria-label="My goal">
              <h2>My goal: {home.goal.title}</h2>
              <p class="goal-row">
                <b>{home.goal.saved}</b>
                <span>of {home.goal.target}</span>
              </p>
              <div class="bar sun" role="img" aria-label={`${home.goal.saved} of ${home.goal.target}`}>
                <i style={{ transform: `scaleX(${Math.min(1, home.goal.savedPence / home.goal.targetPence)})` }} />
              </div>
              <p class="caption">{home.goal.line}</p>
            </section>
          ) : null}
        </div>
      </div>

      <footer class="bottom">
        {home.features.ideas ? (
          <div class="ideas" role="group" aria-label="Bored? Your ideas">
            <h2>Bored? Your ideas</h2>
            {home.ideas.map((i) => (
              <span key={i.id} class="idea">
                <Icon name={i.picture} />
                {i.text}
              </span>
            ))}
            <button type="button" class="idea add" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              Add an idea
            </button>
          </div>
        ) : (
          <span />
        )}
      </footer>

      {job ? (
        <DidIt
          job={job}
          path={`${base}/jobs/${job.id}/done`}
          onClose={() => {
            setJob(undefined);
            void reload();
          }}
        />
      ) : null}
      {adding ? (
        <AddIdea
          path={`${base}/ideas`}
          onClose={() => {
            setAdding(false);
            void reload();
          }}
        />
      ) : null}
    </main>
  );
}

/** I did it: an optional photo, then off to Mum or Dad. */
function DidIt({ job, path, onClose }: { job: KioskHome['jobs'][number]; path: string; onClose: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const send = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('POST', path, { photo });
      setSent(true);
      setTimeout(onClose, 1600);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={job.title}>
      <div class="sheet">
        {sent ? (
          <p class="sent">
            <Icon name="check" />
            Sent to Mum or Dad. Nice one!
          </p>
        ) : (
          <>
            <h2>{job.title}</h2>
            <p>Want to show them? Take a photo, or just send it.</p>
            {photo ? <img class="preview" src={photo} alt="Your photo" /> : null}
            <input ref={input} class="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => void shrink((e.target as HTMLInputElement).files?.[0]).then(setPhoto)} />
            <div class="actions">
              <button type="button" class="btn" onClick={() => input.current?.click()}>
                <Icon name="camera" />
                {photo ? 'Take another' : 'Take a photo'}
              </button>
              <button type="button" class="btn primary" disabled={busy} onClick={() => void send()}>
                <Icon name="check" />
                {busy ? 'Sending' : 'Send to Mum or Dad'}
              </button>
            </div>
            {error ? (
              <p class="error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" class="link" onClick={onClose}>
              Not yet
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Shrinks a photo to 1024 px on its longer side, as a JPEG, so it is quick to send. */
async function shrink(file: File | undefined): Promise<string | null> {
  if (!file) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AddIdea({ path, onClose }: { path: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [picture, setPicture] = useState('star');
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      await api('POST', path, { text: text.trim(), picture });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Add an idea">
      <div class="sheet">
        <h2>Add an idea</h2>
        <label for="idea">Something fun to do when you're bored</label>
        <input id="idea" class="field" value={text} maxLength={40} placeholder="Trampoline tricks" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <div class="pictures" role="group" aria-label="Picture">
          {IDEA_PICTURES.map((p) => (
            <button key={p} type="button" aria-pressed={picture === p} aria-label={p} onClick={() => setPicture(p)}>
              <Icon name={p} />
            </button>
          ))}
        </div>
        {error ? (
          <p class="error" role="alert">
            {error}
          </p>
        ) : null}
        <div class="actions">
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn primary" disabled={!text.trim()} onClick={() => void save()}>
            Add it
          </button>
        </div>
      </div>
    </div>
  );
}
