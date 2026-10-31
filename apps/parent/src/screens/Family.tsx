// Family: each child's week in money and time, the savings goal, the allowance and the reduction
// plan with its "agreed at the family review" tick, the review's agenda, and the ledger, where a
// mistake can be put right by reversing one entry exactly.
import type { ChildSummary, LedgerLine, WeekSummary } from '@family-time/schemas';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { minutes, pence, useLedger, useWeek } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { useToast } from '../toast';

export function Family({ kids, canEdit }: { kids: ChildSummary[]; canEdit: boolean }) {
  return (
    <main className="screen" aria-label="Family">
      <div className="large">
        <h1>Family</h1>
        <p>Money, time and the weekly review.</p>
      </div>
      {ordered(kids).map((k) => (
        <Child key={k.id} kid={k} canEdit={canEdit} />
      ))}
      {!kids.length ? <p className="empty-large">No children yet.</p> : null}
    </main>
  );
}

/** The child Control is showing comes first. */
function ordered(kids: ChildSummary[]): ChildSummary[] {
  const shown = new URLSearchParams(location.search).get('child');
  return [...kids].sort((a, b) => Number(b.id === shown) - Number(a.id === shown));
}

type SheetKind = 'pay' | 'convert' | 'refund' | 'goal' | 'allowance' | 'plan' | { fix: LedgerLine };

function Child({ kid, canEdit }: { kid: ChildSummary; canEdit: boolean }) {
  const toast = useToast();
  const { data: week, reload } = useWeek(kid.id);
  const { data: lines, reload: reloadLedger } = useLedger(kid.id);
  const [sheet, setSheet] = useState<{ kind: SheetKind; from: HTMLElement | null }>();
  const base = `/api/children/${kid.id}`;

  const send = async (method: 'POST' | 'PUT', path: string, body: unknown, done: string) => {
    try {
      await api(method, `${base}${path}`, body);
      setSheet(undefined);
      toast(done);
    } catch (err) {
      toast((err as Error).message);
    }
    void reload();
    void reloadLedger();
  };
  const open = (kind: SheetKind) => (e: { currentTarget: HTMLElement }) => setSheet({ kind, from: e.currentTarget });
  if (!week) return null;

  const agreed = week.nextStep?.agreed ?? false;
  return (
    <>
      <section className="sec" aria-labelledby={`kid-${kid.id}`}>
        <div className="sec-head">
          <h2 id={`kid-${kid.id}`}>{kid.name}</h2>
        </div>
        <div className="group kid">
          <div className="balances">
            <div className="balance">
              <b className="tnum">{minutes(week.leftMinutes)}</b>
              <span>Time left this week</span>
            </div>
            <div className="balance">
              <b className="tnum">{pence(week.moneyPence)}</b>
              <span>Pocket money owed</span>
            </div>
            <div className="balance">
              <b className="tnum">{week.flexPoints}</b>
              <span>Flex points</span>
            </div>
          </div>
          {canEdit ? (
            <div className="actions">
              {week.moneyPence > 0 ? (
                <button type="button" className="btn btn-quiet" onClick={open('pay')}>
                  Mark as paid
                </button>
              ) : null}
              {week.flexPoints > 0 ? (
                <button type="button" className="btn btn-quiet" onClick={open('convert')}>
                  Convert points
                </button>
              ) : null}
            </div>
          ) : null}
          {week.features.goal ? (
            <div style={{ marginTop: 16 }}>
              <div className="wrow" style={{ minHeight: 0, padding: 0 }}>
                <span className="wrow-label">{week.goal ? `Saving for ${week.goal.title}` : 'No savings goal yet'}</span>
                <span className="wrow-value tnum">{week.goal ? `${pence(week.goal.savedPence)} of ${pence(week.goal.targetPence)}` : ''}</span>
              </div>
              {week.goal ? (
                <div className="progress" role="img" aria-label={`${pence(week.goal.savedPence)} saved of ${pence(week.goal.targetPence)}`}>
                  <i style={{ transform: `scaleX(${Math.min(1, week.goal.savedPence / week.goal.targetPence)})` }} />
                </div>
              ) : null}
              {canEdit ? (
                <button type="button" className="btn btn-quiet" style={{ marginTop: 12 }} onClick={open('goal')}>
                  {week.goal ? 'Change the goal' : 'Set a goal'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="sec" aria-labelledby={`allow-${kid.id}`}>
        <div className="sec-head">
          <h2 id={`allow-${kid.id}`}>Allowance and plan</h2>
          <HelpButton topic="gradual-reduction" label="Gradual reduction plan" />
        </div>
        <div className="group">
          <Row label="Weekly allowance" value={minutes(week.allowanceMinutes)} action={canEdit ? { text: 'Change', onClick: open('allowance') } : undefined} />
          <Row
            label="Next step"
            value={week.nextStep ? `${minutes(week.nextStep.minutes)} from ${week.nextStep.onLabel}` : 'No plan yet'}
            action={canEdit ? { text: week.nextStep ? 'Change' : 'Set up', onClick: open('plan') } : undefined}
          />
          {week.nextStep ? (
            <div className="row">
              <span className="row-text">
                Agreed at the family review
                <small>{agreed ? 'The step happens when it is due.' : "The step waits until it's agreed together."}</small>
              </span>
              <span className="row-end">
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={agreed}
                  aria-label="Agreed at the family review"
                  disabled={!canEdit}
                  onClick={() => void send('POST', agreed ? '/plan/unagree' : '/plan/agree', {}, agreed ? 'Not agreed yet. The step waits.' : `Agreed. ${minutes(week.nextStep!.minutes)} from ${week.nextStep!.onLabel}.`)}
                />
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="sec" aria-labelledby={`review-${kid.id}`}>
        <div className="sec-head">
          <h2 id={`review-${kid.id}`}>For the family review</h2>
          <HelpButton topic="family-review" label="The family review" />
        </div>
        <ol className="group agenda">{agenda(kid.name, week)}</ol>
      </section>

      <section className="sec" aria-labelledby={`ledger-${kid.id}`}>
        <div className="sec-head">
          <h2 id={`ledger-${kid.id}`}>History</h2>
        </div>
        <ol className="group ledger">
          {(lines ?? []).slice(0, 12).map((l) => (
            <li key={l.ref}>
              <span>
                {l.reason}
                <span className="when" style={{ display: 'block' }}>
                  {l.when}
                </span>
              </span>
              <span className="chg tnum">{l.change}</span>
              {canEdit && l.reversible ? (
                <button type="button" className="fix" onClick={open({ fix: l })}>
                  Fix a mistake
                </button>
              ) : null}
            </li>
          ))}
          {lines && !lines.length ? <li className="empty">Nothing yet.</li> : null}
        </ol>
        {canEdit ? (
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={open('refund')}>
            Give flex points back
          </button>
        ) : null}
      </section>

      {sheet ? <Sheets kid={kid} week={week} kind={sheet.kind} from={sheet.from} onClose={() => setSheet(undefined)} send={send} /> : null}
    </>
  );
}

function Row({ label, value, action }: { label: string; value: string; action?: { text: string; onClick: (e: { currentTarget: HTMLElement }) => void } | undefined }) {
  return (
    <div className="row">
      <span className="row-text">
        {label}
        <small className="tnum">{value}</small>
      </span>
      {action ? (
        <span className="row-end">
          <button type="button" className="btn btn-quiet" style={{ height: 40 }} onClick={action.onClick} aria-label={`${action.text}: ${label}`}>
            {action.text}
          </button>
        </span>
      ) : null}
    </div>
  );
}

function agenda(name: string, w: WeekSummary): ReactNode[] {
  const items: ReactNode[] = [];
  items.push(
    <li key="week">
      <span>
        How the week went: {minutes(w.usedMinutes)} used{w.lastWeek ? `, and last week ended with ${minutes(w.lastWeek.minutesLeft)} left` : ''}
        {w.lastWeek && w.features.bonus ? `, ${pence(w.lastWeek.bonusPence)} bonus` : ''}. Ask {name} what helped.
      </span>
    </li>,
  );
  if (w.goal) {
    items.push(
      <li key="goal">
        <span>
          {name}&apos;s goal: {w.goal.title}, {pence(w.goal.savedPence)} of {pence(w.goal.targetPence)}. Is it still the one?
        </span>
      </li>,
    );
  }
  if (w.nextStep) {
    items.push(
      <li key="step">
        <span>
          The next step: {minutes(w.nextStep.minutes)} from {w.nextStep.onLabel}. {w.nextStep.agreed ? 'Agreed.' : 'Talk it through together, then tick agreed.'}
        </span>
      </li>,
    );
  }
  items.push(
    <li key="rules">
      <span>The family rules: are three to five still the right ones? Say the reason for each.</span>
    </li>,
  );
  return items;
}

interface SheetsProps {
  kid: ChildSummary;
  week: WeekSummary;
  kind: SheetKind;
  from: HTMLElement | null;
  onClose: () => void;
  send: (method: 'POST' | 'PUT', path: string, body: unknown, done: string) => Promise<void>;
}

function Sheets({ kid, week, kind, from, onClose, send }: SheetsProps) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    setTimeout(onClose, 240);
  };
  const [n, setN] = useState(() => (kind === 'pay' ? week.moneyPence : kind === 'convert' ? week.flexPoints : kind === 'refund' ? 10 : kind === 'allowance' ? week.allowanceMinutes : kind === 'goal' ? (week.goal?.targetPence ?? 500) : 0));
  const [to, setTo] = useState<'MONEY' | 'TIME'>('MONEY');
  const [text, setText] = useState(kind === 'goal' ? (week.goal?.title ?? '') : '');
  const [plan, setPlan] = useState({
    stepMinutes: week.nextStep?.stepMinutes ?? 30,
    everyWeeks: week.nextStep?.everyWeeks ?? 4,
    floorMinutes: week.nextStep?.floorMinutes ?? Math.max(0, week.allowanceMinutes - 120),
    nextStepOn: week.nextStep?.on ?? '',
  });

  const stepper = (label: string, value: string, minus: () => void, plus: () => void) => (
    <div>
      <span className="label">{label}</span>
      <div className="stepper" role="group" aria-label={label}>
        <button type="button" aria-label={`Less: ${label}`} onClick={minus}>
          -
        </button>
        <output className="tnum" aria-live="polite">
          {value}
        </output>
        <button type="button" aria-label={`More: ${label}`} onClick={plus}>
          +
        </button>
      </div>
    </div>
  );

  if (kind === 'pay') {
    return (
      <Sheet open={open} onClose={close} title={`Pay ${kid.name}`} sub={`${pence(week.moneyPence)} is owed. Mark what you handed over.`} returnFocus={from}>
        <div className="form">
          {stepper('Paid', pence(n), () => setN((x) => Math.max(1, x - 10)), () => setN((x) => Math.min(week.moneyPence, x + 10)))}
          <button type="button" className="btn btn-primary" onClick={() => void send('POST', '/payouts', { pence: n }, `${pence(n)} marked as paid.`)}>
            Mark {pence(n)} as paid
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'convert') {
    const result = to === 'MONEY' ? pence(n * week.rates.flexPence) : minutes(n * week.rates.flexMinutes);
    return (
      <Sheet open={open} onClose={close} title="Convert flex points" sub={`${kid.name} has ${week.flexPoints} points.`} returnFocus={from}>
        <div className="form">
          {stepper('Points', String(n), () => setN((x) => Math.max(1, x - 5)), () => setN((x) => Math.min(week.flexPoints, x + 5)))}
          <div>
            <span className="label">Into</span>
            <div className="choice" role="group" aria-label="Into">
              <button type="button" aria-pressed={to === 'MONEY'} onClick={() => setTo('MONEY')}>
                Pocket money
              </button>
              <button type="button" aria-pressed={to === 'TIME'} onClick={() => setTo('TIME')}>
                Screen time
              </button>
            </div>
            {to === 'TIME' ? <p className="hint">Screen time from points counts towards the 15% cap on earned time.</p> : null}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void send('POST', '/convert', { points: n, to }, `${n} points became ${result}.`)}>
            Convert {n} points into {result}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'refund') {
    return (
      <Sheet open={open} onClose={close} title="Give flex points back" sub={`For when ${kid.name} lost out, for example a session you had to stop. Points, not screen time.`} returnFocus={from}>
        <div className="form">
          {stepper('Points', String(n), () => setN((x) => Math.max(1, x - 5)), () => setN((x) => Math.min(1000, x + 5)))}
          <div>
            <label htmlFor="refund-why">Why</label>
            <input id="refund-why" className="field" value={text} maxLength={120} placeholder="For example: Roblox stopped for tea" onChange={(e) => setText(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => void send('POST', '/refund-points', { points: n, reason: text.trim() }, `${n} flex points given back.`)}>
            Give {n} points back
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'goal') {
    return (
      <Sheet open={open} onClose={close} title={`${kid.name}'s savings goal`} sub="Progress comes from the pocket money owed." returnFocus={from}>
        <div className="form">
          <div>
            <label htmlFor="goal-title">Saving for</label>
            <input id="goal-title" className="field" value={text} maxLength={80} placeholder="For example: Bike lights" onChange={(e) => setText(e.target.value)} />
          </div>
          {stepper('Costs', pence(n), () => setN((x) => Math.max(50, x - 50)), () => setN((x) => x + 50))}
          <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => void send('PUT', '/goal', { title: text.trim(), targetPence: n }, 'Goal saved.')}>
            Save the goal
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'allowance') {
    return (
      <Sheet open={open} onClose={close} title="Weekly allowance" sub={`Agreed with ${kid.name}. A change starts with the next week.`} returnFocus={from}>
        <div className="form">
          {stepper('A week', minutes(n), () => setN((x) => Math.max(0, x - 30)), () => setN((x) => x + 30))}
          <button type="button" className="btn btn-primary" onClick={() => void send('PUT', '/allowance', { minutes: n }, `${minutes(n)} a week, from the next week.`)}>
            Save {minutes(n)} a week
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'plan') {
    return (
      <Sheet open={open} onClose={close} title="Reduction plan" sub="Small steps, each agreed at the family review before it happens." returnFocus={from}>
        <div className="form">
          {stepper('Each step', minutes(plan.stepMinutes), () => setPlan((p) => ({ ...p, stepMinutes: Math.max(30, p.stepMinutes - 30) })), () => setPlan((p) => ({ ...p, stepMinutes: p.stepMinutes + 30 })))}
          {stepper('Every', `${plan.everyWeeks} weeks`, () => setPlan((p) => ({ ...p, everyWeeks: Math.max(1, p.everyWeeks - 1) })), () => setPlan((p) => ({ ...p, everyWeeks: p.everyWeeks + 1 })))}
          {stepper('Never below', minutes(plan.floorMinutes), () => setPlan((p) => ({ ...p, floorMinutes: Math.max(0, p.floorMinutes - 30) })), () => setPlan((p) => ({ ...p, floorMinutes: p.floorMinutes + 30 })))}
          <div>
            <label htmlFor="plan-next">First step on</label>
            <input id="plan-next" className="field" type="date" value={plan.nextStepOn} onChange={(e) => setPlan((p) => ({ ...p, nextStepOn: e.target.value }))} />
            <p className="hint">The day the week resets, {week.resets.replace(/ at .*/, '')}s. Changing the plan clears an earlier agreement.</p>
          </div>
          <button type="button" className="btn btn-primary" disabled={!plan.nextStepOn} onClick={() => void send('PUT', '/plan', plan, 'Plan saved. Agree the first step at the review.')}>
            Save the plan
          </button>
        </div>
      </Sheet>
    );
  }
  const line = kind.fix;
  return (
    <Sheet open={open} onClose={close} title="Fix a mistake" sub={`This reverses "${line.reason}" (${line.change}) exactly. It stays in the history, with the fix beside it.`} returnFocus={from}>
      <div className="form">
        <button type="button" className="btn btn-primary" onClick={() => void send('POST', '/reverse', { entryRef: line.ref }, 'Put right.')}>
          Reverse it
        </button>
      </div>
    </Sheet>
  );
}
