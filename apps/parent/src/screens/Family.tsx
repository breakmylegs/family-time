// Family: one child's week in money and time, the savings goal, the family review's agenda, the
// allowance and the reduction plan with its "agreed at the family review" switch, and the history,
// where a mistake can be put right by undoing one entry exactly.
import type { ChildSummary, LedgerLine, WeekSummary } from '@family-time/schemas';
import type { TopicId } from '@family-time/help-content/content';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { useSheetAction } from '../components/useSheetAction';
import { minutes, pence, useLedger, useWeek } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';

interface Props {
  kids: ChildSummary[];
  /** The child Control is showing; the same switcher changes it here. */
  childId: string | undefined;
  canEdit: boolean;
  onSwitchChild: (from: HTMLElement) => void;
}

export function Family({ kids, childId, canEdit, onSwitchChild }: Props) {
  const kid = kids.find((k) => k.id === childId) ?? kids[0];
  return (
    <main className="screen" aria-label="Family">
      <div className="large">
        {kid && kids.length > 1 ? (
          <h1>
            <button type="button" className="child-switch large-switch" aria-label={`Family: showing ${kid.name}. Switch child`} onClick={(e) => onSwitchChild(e.currentTarget)}>
              {kid.name}
              <Icon name="down" />
            </button>
          </h1>
        ) : (
          <h1>{kid?.name ?? 'Family'}</h1>
        )}
        <p>Money, time and the family review.</p>
      </div>
      {kid ? <Child key={kid.id} kid={kid} canEdit={canEdit} /> : <p className="empty-large">No children yet.</p>}
    </main>
  );
}

type SheetKind = 'pay' | 'convert' | 'makeUp' | 'goal' | 'allowance' | 'plan' | { fix: LedgerLine };

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
const every = (n: number) => (n === 1 ? 'every week' : `every ${n} weeks`);
/** The history shows this many lines at first, then this many more on each tap. */
const PAGE = 12;

function Child({ kid, canEdit }: { kid: ChildSummary; canEdit: boolean }) {
  const toast = useToast();
  const { data: week, error, reload } = useWeek(kid.id);
  const { data: lines, error: ledgerError, reload: reloadLedger } = useLedger(canEdit ? kid.id : undefined);
  const [sheet, setSheet] = useState<{ kind: SheetKind; from: HTMLElement | null }>();
  const [agreeing, setAgreeing] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const base = `/api/children/${kid.id}`;

  const reloadAll = () => {
    void reload();
    void reloadLedger();
  };
  const open = (kind: SheetKind) => (e: { currentTarget: HTMLElement }) => setSheet({ kind, from: e.currentTarget });

  if (!week) {
    return error ? (
      <div className="sec">
        <p className="empty-large" role="alert">
          {error}
        </p>
        <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => void reload()}>
          Try again
        </button>
      </div>
    ) : (
      <p className="empty-large">Loading.</p>
    );
  }

  const step = week.nextStep;
  const agree = async () => {
    if (!step || agreeing) return;
    setAgreeing(true);
    try {
      await api('POST', `${base}/plan/${step.agreed ? 'unagree' : 'agree'}`, {});
      toast(step.agreed ? `Not agreed yet. The allowance stays at ${minutes(week.allowanceMinutes)} a week until you agree the step together.` : `Agreed. ${minutes(step.minutes)} a week from ${step.onLabel}.`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setAgreeing(false);
      reloadAll();
    }
  };
  const stepNote = !step?.active
    ? 'Steps are off for now. The owner switches them on when the family is ready.'
    : `${step.agreed ? `It starts on ${step.onLabel}.` : "The step waits until it's agreed together."}${canEdit ? '' : ' Only a parent can change this.'}`;

  return (
    <>
      <section className="sec" aria-labelledby={`money-${kid.id}`}>
        <div className="sec-head">
          <h2 id={`money-${kid.id}`}>This week</h2>
        </div>
        <div className="group">
          <Row label="Left to plan this week" value={`${minutes(week.leftMinutes)} of ${minutes(week.allowanceMinutes)}`} help={{ topic: 'weekly-allowance', label: 'Weekly allowance' }} />
          <Row
            label="Pocket money owed"
            value={pence(week.moneyPence)}
            help={{ topic: 'pocket-money', label: 'Pocket money' }}
            action={canEdit && week.moneyPence > 0 ? { text: 'Mark as paid', onClick: open('pay') } : undefined}
          />
          <Row label="Flex points" value={String(week.flexPoints)} help={{ topic: 'flex-points', label: 'Flex points' }} action={canEdit && week.flexPoints > 0 ? { text: 'Convert', onClick: open('convert') } : undefined} />
          {week.features.goal ? (
            <div className="row goal">
              <span className="row-text">
                <span className="label-row">
                  {week.goal ? `Saving for ${week.goal.title}` : 'No savings goal yet'}
                  <HelpButton topic="savings-goal" label="Savings goal" />
                </span>
                {week.goal ? (
                  <>
                    <small className="tnum">
                      {pence(week.goal.savedPence)} of {pence(week.goal.targetPence)}
                    </small>
                    <span className="progress" role="img" aria-label={`${pence(week.goal.savedPence)} of ${pence(week.goal.targetPence)} towards ${week.goal.title}`}>
                      <i style={{ transform: `translateX(${(Math.min(1, week.goal.savedPence / week.goal.targetPence) - 1) * 100}%)` }} />
                    </span>
                  </>
                ) : null}
              </span>
              {canEdit ? (
                <span className="row-end">
                  <button type="button" className="btn btn-quiet row-btn" onClick={open('goal')} aria-label={week.goal ? 'Change the savings goal' : 'Set a savings goal'}>
                    {week.goal ? 'Change' : 'Set a goal'}
                  </button>
                </span>
              ) : null}
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

      <section className="sec" aria-labelledby={`allow-${kid.id}`}>
        <div className="sec-head">
          <h2 id={`allow-${kid.id}`}>Allowance and plan</h2>
          <HelpButton topic="gradual-reduction" label="Gradual reduction plan" />
        </div>
        <div className="group">
          <Row label="Weekly allowance" value={minutes(week.allowanceMinutes)} action={canEdit ? { text: 'Change', onClick: open('allowance') } : undefined} />
          <Row
            label="Next step"
            value={step ? `${minutes(step.minutes)} a week from ${step.onLabel}${step.active ? '' : ', steps off for now'}` : 'No plan yet'}
            action={canEdit ? { text: step ? 'Change' : 'Set up', onClick: open('plan') } : undefined}
          />
          {step ? (
            <div className="row">
              <span className="row-text">
                Agreed at the family review
                <small>{stepNote}</small>
              </span>
              <span className="row-end">
                <button type="button" className="switch" role="switch" aria-checked={step.agreed} aria-label="Agreed at the family review" disabled={!canEdit || agreeing} onClick={() => void agree()} />
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {canEdit ? (
        <section className="sec" aria-labelledby={`ledger-${kid.id}`}>
          <div className="sec-head">
            <h2 id={`ledger-${kid.id}`}>History</h2>
          </div>
          {ledgerError && !lines ? (
            <>
              <p className="empty" role="alert">
                {ledgerError}
              </p>
              <button type="button" className="btn btn-quiet" style={{ width: '100%' }} onClick={() => void reloadLedger()}>
                Try again
              </button>
            </>
          ) : (
            <ol className="group ledger">
              {(lines ?? []).slice(0, shown).map((l) => (
                <li key={l.ref}>
                  <span>
                    {l.reason}
                    <span className="when">{l.when}</span>
                  </span>
                  <span className="chg tnum">{l.change}</span>
                  {l.reversible ? (
                    <button type="button" className="fix" aria-label={`Fix a mistake: ${l.reason}, ${l.change}`} onClick={open({ fix: l })}>
                      Fix a mistake
                    </button>
                  ) : null}
                </li>
              ))}
              {lines && !lines.length ? <li className="empty">Nothing yet.</li> : null}
              {!lines ? <li className="empty">Loading.</li> : null}
            </ol>
          )}
          {lines && lines.length > shown ? (
            <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => setShown((n) => n + PAGE)}>
              Show older lines
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={open('makeUp')}>
            Make up for a problem
          </button>
        </section>
      ) : null}

      {sheet ? (
        <Sheets
          key={typeof sheet.kind === 'string' ? sheet.kind : sheet.kind.fix.ref}
          kid={kid}
          week={week}
          kind={sheet.kind}
          from={sheet.from}
          base={base}
          onClosed={() => setSheet(undefined)}
          onDone={(done) => {
            toast(done);
            reloadAll();
          }}
        />
      ) : null}
    </>
  );
}

interface RowProps {
  label: string;
  value: string;
  help?: { topic: TopicId; label: string };
  action?: { text: string; onClick: (e: { currentTarget: HTMLElement }) => void } | undefined;
}

function Row({ label, value, help, action }: RowProps) {
  return (
    <div className="row">
      <span className="row-text">
        {help ? (
          <span className="label-row">
            {label}
            <HelpButton topic={help.topic} label={help.label} />
          </span>
        ) : (
          label
        )}
        <small className="tnum">{value}</small>
      </span>
      {action ? (
        <span className="row-end">
          <button type="button" className="btn btn-quiet row-btn" onClick={action.onClick} aria-label={`${action.text}: ${label}`}>
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
        {w.lastWeek
          ? `Last week: ${minutes(w.lastWeek.minutesLeft)} left over${w.features.bonus ? `, ${pence(w.lastWeek.bonusPence)} bonus` : ''}. Ask ${name} what helped.`
          : 'First week, so nothing to look back on yet.'}
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
  if (w.nextStep?.active) {
    items.push(
      <li key="step">
        <span>
          The next step: {minutes(w.nextStep.minutes)} a week from {w.nextStep.onLabel}. {w.nextStep.agreed ? 'Agreed.' : 'Talk it through together, then turn on Agreed at the family review.'}
        </span>
      </li>,
    );
  }
  items.push(
    <li key="rules">
      <span>Your family&apos;s rules: do they still fit? Say the reason for each one.</span>
    </li>,
  );
  return items;
}

/** One step down or up, landing on a whole step: 37 goes to 30 or 40, not 27 or 47. */
const down = (x: number, step: number, min: number) => Math.max(min, x % step ? x - (x % step) : x - step);
const up = (x: number, step: number, max: number) => Math.min(max, x - (x % step) + step);

/** What Fix a mistake does to this line, on its button: the opposite of what the line did. */
function undoLabel(line: LedgerLine): string {
  const parts = line.change.split(', ');
  const gained = parts.find((p) => p.startsWith('+'))?.slice(1);
  const spent = parts.find((p) => p.startsWith('-'))?.slice(1);
  if (line.kind === 'payout' && spent) return `Mark ${spent} as not paid`;
  if (line.kind === 'convert' && gained && spent) return `Turn ${gained} back into ${spent}`;
  return `Take back ${gained ?? line.change}`;
}

interface SheetsProps {
  kid: ChildSummary;
  week: WeekSummary;
  kind: SheetKind;
  from: HTMLElement | null;
  base: string;
  onClosed: () => void;
  onDone: (toast: string) => void;
}

function Sheets({ kid, week, kind, from, base, onClosed, onDone }: SheetsProps) {
  const sheet = useSheetAction(onClosed);
  // Made once per sheet: a second tap after a lost answer is recorded once.
  const [key] = useState(() => crypto.randomUUID());
  const [n, setN] = useState(() => (kind === 'pay' ? week.moneyPence : kind === 'convert' ? week.flexPoints : kind === 'makeUp' ? 10 : kind === 'allowance' ? week.allowanceMinutes : kind === 'goal' ? (week.goal?.targetPence ?? 500) : 0));
  const [to, setTo] = useState<'MONEY' | 'TIME'>('MONEY');
  const [text, setText] = useState(kind === 'goal' ? (week.goal?.title ?? '') : '');
  const days = week.nextStep?.resetDays ?? week.resetDays;
  const [plan, setPlan] = useState({
    stepMinutes: week.nextStep?.stepMinutes ?? 30,
    everyWeeks: week.nextStep?.everyWeeks ?? 4,
    floorMinutes: week.nextStep?.floorMinutes ?? Math.max(0, week.allowanceMinutes - 120),
    nextStepOn: week.nextStep?.on ?? days[0]?.on ?? '',
  });

  const send = (method: 'POST' | 'PUT', path: string, body: unknown, done: string) => void sheet.run(() => api(method, `${base}${path}`, body), () => onDone(done));
  const common = { open: sheet.open, onClose: sheet.close, returnFocus: from, error: sheet.error };
  const busy = sheet.busy;

  /** A stepper whose buttons say what they do: "10p less", "Fewer weeks between steps". */
  const stepper = (label: string, value: string, less: [string, (() => void) | null], more: [string, (() => void) | null]) => (
    <div>
      <span className="label">{label}</span>
      <div className="stepper" role="group" aria-label={label}>
        <button type="button" aria-label={less[0]} disabled={!less[1]} onClick={less[1] ?? undefined}>
          <Icon name="minus" />
        </button>
        <output className="tnum" aria-live="polite">
          {value}
        </output>
        <button type="button" aria-label={more[0]} disabled={!more[1]} onClick={more[1] ?? undefined}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
  /** A stepper for `n`, moving by `step` between `min` and `max`. */
  const nStepper = (label: string, show: (x: number) => string, step: number, min: number, max: number) =>
    stepper(label, show(n), [`${show(step)} less`, n > min ? () => setN((x) => down(x, step, min)) : null], [`${show(step)} more`, n < max ? () => setN((x) => up(x, step, max)) : null]);

  if (kind === 'pay') {
    return (
      <Sheet
        {...common}
        title={`Pay ${kid.name}`}
        sub={`${pence(week.moneyPence)} is owed. Mark what you handed over.${week.goal ? ' The savings bar counts money still owed, so it goes down by the same amount.' : ''}`}
      >
        <div className="form">
          {nStepper('Paid', pence, 10, 1, week.moneyPence)}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('POST', '/payouts', { pence: n, key }, `${pence(n)} marked as paid.`)}>
            {busy ? 'Saving' : `Mark ${pence(n)} as paid`}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'convert') {
    const result = to === 'MONEY' ? pence(n * week.rates.flexPence) : minutes(n * week.rates.flexMinutes);
    const capLeft = Math.max(0, week.earnedCapMinutes - week.earnedMinutes);
    return (
      <Sheet {...common} title="Convert flex points" sub={`${kid.name} has ${points(week.flexPoints)}.`}>
        <div className="form">
          {nStepper('Points', points, 5, 1, week.flexPoints)}
          <div>
            <span className="label" id="convert-into">
              Into
            </span>
            <div className="choice" role="group" aria-labelledby="convert-into">
              <button type="button" aria-pressed={to === 'MONEY'} onClick={() => setTo('MONEY')}>
                Pocket money
              </button>
              <button type="button" aria-pressed={to === 'TIME'} onClick={() => setTo('TIME')}>
                Screen time
              </button>
            </div>
            {to === 'TIME' ? (
              <p className="hint">
                Screen time from points counts towards the weekly cap on earned screen time.{' '}
                {capLeft ? `${kid.name} can have ${minutes(capLeft)} more this week.` : `${kid.name} has had all of it this week, so choose pocket money.`}
              </p>
            ) : null}
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('POST', '/convert', { points: n, to, key }, `${points(n)} became ${result}.`)}>
            {busy ? 'Saving' : `Convert ${points(n)} into ${result}`}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'makeUp') {
    const why = text.trim();
    return (
      <Sheet
        {...common}
        title="Make up for a problem"
        sub={`For when something went wrong that wasn't ${kid.name}'s fault, like the Wi-Fi going down. If you stop a planned session, its time goes back to ${kid.name}'s week on its own.`}
      >
        <div className="form">
          {nStepper('Flex points', points, 5, 1, 1000)}
          <div>
            <label htmlFor="make-up-why">What went wrong?</label>
            <input id="make-up-why" className="field" value={text} maxLength={120} placeholder="For example: The Wi-Fi was down" onChange={(e) => setText(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={!why || busy} onClick={() => send('POST', '/refund-points', { points: n, reason: why, key }, `${points(n)} added to ${kid.name}'s flex points.`)}>
            {busy ? 'Saving' : why ? `Add ${points(n)}` : 'Say what went wrong first'}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'goal') {
    return (
      <Sheet {...common} title={`${kid.name}'s savings goal`} sub={`The bar fills with the pocket money you owe ${kid.name}. Marking money as paid moves it back.`}>
        <div className="form">
          <div>
            <label htmlFor="goal-title">Saving for</label>
            <input id="goal-title" className="field" value={text} maxLength={80} placeholder="For example: bike lights" onChange={(e) => setText(e.target.value)} />
          </div>
          {nStepper('Costs', pence, 50, 50, 1_000_000)}
          <button type="button" className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => send('PUT', '/goal', { title: text.trim(), targetPence: n }, `Goal saved: ${text.trim()}.`)}>
            {busy ? 'Saving' : 'Save the goal'}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'allowance') {
    return (
      <Sheet {...common} title="Weekly allowance" sub={`Agree it with ${kid.name} first. A change starts from ${week.resets}.`}>
        <div className="form">
          {nStepper('A week', minutes, 30, 0, 7 * 24 * 60)}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('PUT', '/allowance', { minutes: n }, `Allowance saved: ${minutes(n)} a week from ${week.resets}.`)}>
            {busy ? 'Saving' : `Save ${minutes(n)} a week`}
          </button>
        </div>
      </Sheet>
    );
  }
  if (kind === 'plan') {
    const first = Math.max(plan.floorMinutes, week.allowanceMinutes - plan.stepMinutes);
    const firstLabel = days.find((d) => d.on === plan.nextStepOn)?.label ?? plan.nextStepOn;
    const set = (patch: Partial<typeof plan>) => () => setPlan((p) => ({ ...p, ...patch }));
    return (
      <Sheet {...common} title="Reduction plan" sub="Small steps, each agreed at the family review before it happens.">
        <div className="form">
          {stepper(
            'Each step',
            minutes(plan.stepMinutes),
            ['Each step: 30 min less', plan.stepMinutes > 30 ? set({ stepMinutes: plan.stepMinutes - 30 }) : null],
            ['Each step: 30 min more', plan.stepMinutes < 600 ? set({ stepMinutes: plan.stepMinutes + 30 }) : null],
          )}
          {stepper(
            'Weeks between steps',
            weeks(plan.everyWeeks),
            ['Fewer weeks between steps', plan.everyWeeks > 1 ? set({ everyWeeks: plan.everyWeeks - 1 }) : null],
            ['More weeks between steps', plan.everyWeeks < 52 ? set({ everyWeeks: plan.everyWeeks + 1 }) : null],
          )}
          {stepper(
            'Never below',
            minutes(plan.floorMinutes),
            ['Never below: 30 min less', plan.floorMinutes > 0 ? set({ floorMinutes: plan.floorMinutes - 30 }) : null],
            ['Never below: 30 min more', plan.floorMinutes < week.allowanceMinutes ? set({ floorMinutes: plan.floorMinutes + 30 }) : null],
          )}
          <div>
            <span className="label" id="plan-next">
              Next step on
            </span>
            <div className="choice" role="group" aria-labelledby="plan-next">
              {days.map((d) => (
                <button key={d.on} type="button" aria-pressed={plan.nextStepOn === d.on} onClick={set({ nextStepOn: d.on })}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="hint">
              From {firstLabel}: {minutes(first)} a week, then {minutes(plan.stepMinutes)} less {every(plan.everyWeeks)}, never below {minutes(plan.floorMinutes)}. If you change the plan, agree the next step again at the family review.
            </p>
          </div>
          <button type="button" className="btn btn-primary" disabled={!plan.nextStepOn || busy} onClick={() => send('PUT', '/plan', plan, 'Plan saved. Agree the first step at the family review.')}>
            {busy ? 'Saving' : 'Save the plan'}
          </button>
        </div>
      </Sheet>
    );
  }
  const line = kind.fix;
  return (
    <Sheet {...common} title="Fix a mistake" sub={`This undoes "${line.reason}" (${line.change}) exactly. The original line and this correction both stay in the history.`}>
      <div className="form">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('POST', '/reverse', { entryRef: line.ref }, `Fixed. "${line.reason}" is undone.`)}>
          {busy ? 'Saving' : undoLabel(line)}
        </button>
      </div>
    </Sheet>
  );
}
