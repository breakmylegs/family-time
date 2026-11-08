// The whole family (Phase 9, the transitions phase): the parents' own screen time beside the
// child's, one cooperative challenge at a time, and the minutes to find a stopping point.
import type { WholeFamily as Whole } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { minutes, useFetched } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { Sheet } from './Sheet';
import { useSheetAction } from './useSheetAction';

type Kind = 'mine' | 'challenge' | 'stopping';

const IDEAS = ['Screen-free tea', 'Phones out of bedrooms', 'A walk together', 'Board game night'];
const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`;
const grace = (n: number) => (n ? `${n} minutes` : 'Off');

export function WholeFamily({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, reload } = useFetched<Whole>('/api/family/whole');
  const [sheet, setSheet] = useState<{ kind: Kind; from: HTMLElement | null }>();
  const [ticking, setTicking] = useState(false);
  if (!data?.on) return null;

  const me = data.parents.find((p) => p.me);
  const c = data.challenge;
  const open = (kind: Kind) => (e: { currentTarget: HTMLElement }) => setSheet({ kind, from: e.currentTarget });
  const tick = async () => {
    if (ticking) return;
    setTicking(true);
    try {
      const after = await api<{ done: number; target: number }>('POST', '/api/family/challenge/tick', {});
      toast(after.done >= after.target ? 'Challenge done this week. Well done, everyone.' : `${after.done} of ${times(after.target)} this week.`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setTicking(false);
      void reload();
    }
  };

  return (
    <section className="sec" aria-labelledby="whole-family">
      <div className="sec-head">
        <h2 id="whole-family">The whole family</h2>
        <HelpButton topic="whole-family" label="The whole family" />
      </div>
      <div className="group">
        {data.parents.map((p) => {
          const now = p.weeks[0]?.minutes;
          const before = p.weeks
            .slice(1)
            .filter((w) => w.minutes !== null)
            .map((w) => minutes(w.minutes!));
          return (
            <div className="row" key={p.id}>
              <span className="row-text">
                {p.me ? 'Your screen time this week' : `${p.name}'s screen time this week`}
                <small className="tnum">
                  {now === null || now === undefined ? 'Not given yet' : minutes(now)}
                  {before.length ? `. Earlier weeks: ${before.join(', ')}` : ''}
                </small>
              </span>
              {p.me && canEdit ? (
                <span className="row-end">
                  <button type="button" className="btn btn-quiet row-btn" aria-label="Change your screen time this week" onClick={open('mine')}>
                    Change
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
        <div className="row goal challenge">
          <span className="row-text">
            {c ? `Family challenge: ${c.title}` : 'No family challenge this week'}
            {c ? (
              <>
                <small className="tnum">
                  {c.done} of {times(c.target)}
                  {c.ticks[0] ? `. Last: ${c.ticks[0].by}, ${c.ticks[0].when}` : ''}
                </small>
                <span className="progress" role="img" aria-label={`${c.done} of ${times(c.target)} this week`}>
                  <i style={{ transform: `translateX(${(Math.min(1, c.done / c.target) - 1) * 100}%)` }} />
                </span>
              </>
            ) : null}
          </span>
          <span className="row-end">
            {c && c.done < c.target ? (
              <button type="button" className="btn btn-quiet row-btn" disabled={ticking} onClick={() => void tick()}>
                We did it
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" className="btn btn-quiet row-btn" aria-label={c ? 'Change the family challenge' : 'Set a family challenge'} onClick={open('challenge')}>
                {c ? 'Change' : 'Set one'}
              </button>
            ) : null}
          </span>
        </div>
        <div className="row">
          <span className="row-text">
            <span className="label-row">
              Time to find a stopping point
              <HelpButton topic="stopping-points" label="Time to find a stopping point" />
            </span>
            <small className="tnum">{grace(data.stoppingPointMinutes)}</small>
          </span>
          {canEdit ? (
            <span className="row-end">
              <button type="button" className="btn btn-quiet row-btn" aria-label="Change: time to find a stopping point" onClick={open('stopping')}>
                Change
              </button>
            </span>
          ) : null}
        </div>
      </div>
      {sheet ? (
        <Sheets
          key={sheet.kind}
          kind={sheet.kind}
          from={sheet.from}
          whole={data}
          mine={me?.weeks[0]?.minutes ?? null}
          onClosed={() => setSheet(undefined)}
          onDone={(text) => {
            toast(text);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}

interface SheetsProps {
  kind: Kind;
  from: HTMLElement | null;
  whole: Whole;
  mine: number | null;
  onClosed: () => void;
  onDone: (toast: string) => void;
}

function Sheets({ kind, from, whole, mine, onClosed, onDone }: SheetsProps) {
  const sheet = useSheetAction(onClosed);
  const c = whole.challenge;
  const [n, setN] = useState(() => (kind === 'mine' ? (mine ?? 600) : kind === 'challenge' ? (c?.target ?? 5) : whole.stoppingPointMinutes));
  const [title, setTitle] = useState(c?.title ?? '');
  const common = { open: sheet.open, onClose: sheet.close, returnFocus: from, error: sheet.error };
  const busy = sheet.busy;
  const send = (method: 'PUT' | 'DELETE', path: string, body: unknown, done: string) => void sheet.run(() => api(method, path, body), () => onDone(done));

  const stepper = (label: string, show: (x: number) => string, step: number, min: number, max: number) => (
    <div>
      <span className="label">{label}</span>
      <div className="stepper" role="group" aria-label={label}>
        <button type="button" aria-label={`${label}: ${show(step)} less`} disabled={n <= min} onClick={() => setN((x) => Math.max(min, x - step))}>
          <Icon name="minus" />
        </button>
        <output className="tnum" aria-live="polite">
          {show(n)}
        </output>
        <button type="button" aria-label={`${label}: ${show(step)} more`} disabled={n >= max} onClick={() => setN((x) => Math.min(max, x + step))}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );

  if (kind === 'mine') {
    return (
      <Sheet {...common} title="Your screen time this week" sub="Your best guess of your own leisure screen time this week: phone, TV, games. Not work. Nobody checks it.">
        <div className="form">
          {stepper('This week', minutes, 30, 0, 7 * 24 * 60)}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('PUT', '/api/family/my-screen-time', { minutes: n }, `Saved: ${minutes(n)} this week.`)}>
            {busy ? 'Saving' : `Save ${minutes(n)}`}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'challenge') {
    const t = title.trim();
    return (
      <Sheet {...common} title="Family challenge" sub="Something the whole family does together this week. Agree it together first. No points, and nothing lost if you miss it.">
        <div className="form">
          <div>
            <label htmlFor="challenge-title">The challenge</label>
            <input id="challenge-title" className="field" value={title} maxLength={60} placeholder="For example: Screen-free tea" onChange={(e) => setTitle(e.target.value)} />
            <div className="choice" role="group" aria-label="Ideas">
              {IDEAS.map((idea) => (
                <button key={idea} type="button" aria-pressed={t === idea} onClick={() => setTitle(idea)}>
                  {idea}
                </button>
              ))}
            </div>
          </div>
          {stepper('This week', times, 1, 1, 14)}
          <button type="button" className="btn btn-primary" disabled={t.length < 3 || busy} onClick={() => send('PUT', '/api/family/challenge', { title: t, target: n }, `Challenge set: ${t}, ${times(n)} this week.`)}>
            {busy ? 'Saving' : t.length < 3 ? 'Name the challenge first' : 'Save the challenge'}
          </button>
          {c ? (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send('DELETE', '/api/family/challenge', undefined, 'Challenge ended. Set a new one when you are ready.')}>
              End this challenge
            </button>
          ) : null}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet {...common} title="Time to find a stopping point" sub="When a planned session or an Allow ends on its own, the app stays allowed this much longer. Never into wind-down, bedtime or school time. Pause and Block still start within a minute.">
      <div className="form">
        {stepper('Extra minutes', grace, 5, 0, 15)}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('PUT', '/api/family/stopping-point', { minutes: n }, n ? `Saved: ${n} minutes to find a stopping point.` : 'Saved: no extra time. Apps are blocked within a minute of time ending.')}>
          {busy ? 'Saving' : n ? `Save ${n} minutes` : 'Save: no extra time'}
        </button>
      </div>
    </Sheet>
  );
}
