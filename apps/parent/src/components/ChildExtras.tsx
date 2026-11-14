// Phase 11 on Family: what the child said they did away from screens, with praise sent back; the
// things they are learning and can do, confirmed by a grown-up; their questions about rules; and
// the parents' own estimates for the pilot. Praise, never points.
import type { ChildExtras, ChildSummary } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { minutes } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { Sheet } from './Sheet';
import { useSheetAction } from './useSheetAction';

export const MOOD_WORDS = ['Not good', 'Not great', 'OK', 'Good', 'Very good'] as const;
const PRAISE_IDEAS = ['That sounds brilliant', 'Tell me about it later', 'I loved hearing that'];

type Open =
  | { kind: 'praise'; id: string; text: string }
  | { kind: 'skill' }
  | { kind: 'answer'; id: string; text: string }
  | { kind: 'unmanaged' }
  | { kind: 'mood' };

interface Props {
  kid: ChildSummary;
  extras: ChildExtras;
  reload: () => void;
}

/** The "Away from screens" section. Carers see and praise it too; questions about rules are for parents. */
export function AwayFromScreens({ kid, extras, canEdit, reload }: Props & { canEdit: boolean }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<{ open: Open; from: HTMLElement | null }>();
  const [busy, setBusy] = useState(false);
  const show = (open: Open) => (e: { currentTarget: HTMLElement }) => setSheet({ open, from: e.currentTarget });
  const learning = extras.skills.filter((s) => !s.mastered);
  const canDo = extras.skills.filter((s) => s.mastered);

  const quick = async (method: 'PUT' | 'DELETE' | 'POST', path: string, body: unknown, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(method, path, body);
      toast(done);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <section className="sec" aria-labelledby={`away-${kid.id}`}>
      <div className="sec-head">
        <h2 id={`away-${kid.id}`}>Away from screens</h2>
        <HelpButton topic="away-from-screens" label="Away from screens" />
      </div>

      <h3 className="sub-head">Things {kid.name} did</h3>
      <ol className="group">
        {extras.journal.map((j) => (
          <li key={j.id} className="row">
            <span className="row-text">
              {j.text}
              <small>
                Added {j.when}
                {j.praise ? `. Praise sent: "${j.praise}"` : ''}
              </small>
            </span>
            <span className="row-end">
              <button type="button" className="btn btn-quiet row-btn" aria-label={`${j.praise ? 'Change your praise' : 'Send praise'}: ${j.text}`} onClick={show({ kind: 'praise', id: j.id, text: j.text })}>
                {j.praise ? 'Change praise' : 'Send praise'}
              </button>
            </span>
          </li>
        ))}
        {!extras.journal.length ? <li className="empty">Nothing in the last two weeks. {kid.name} adds these on the kiosk, under Me.</li> : null}
      </ol>

      <h3 className="sub-head">Things {kid.name} can do</h3>
      <ul className="group">
        {canDo.map((s) => (
          <li key={s.id} className="row">
            <span className="row-icon">
              <Icon name="star" />
            </span>
            <span className="row-text">
              {s.title}
              <small>Could do it from {s.since}</small>
            </span>
            <span className="row-end">
              <button type="button" className="btn btn-quiet row-btn" disabled={busy} aria-label={`Move back to learning: ${s.title}`} onClick={() => void quick('PUT', `/api/skills/${s.id}`, { mastered: false }, `${s.title} moved back to learning.`)}>
                Move back to learning
              </button>
            </span>
          </li>
        ))}
        {learning.map((s) => (
          <li key={s.id} className="row">
            <span className="row-text">
              {s.title}
              <small>Learning from {s.since}</small>
            </span>
            <span className="row-end">
              <button type="button" className="btn btn-quiet row-btn" disabled={busy} aria-label={`${kid.name} can do it now: ${s.title}`} onClick={() => void quick('PUT', `/api/skills/${s.id}`, { mastered: true }, `${s.title} is now under Things I can do on ${kid.name}'s kiosk.`)}>
                Can do it now
              </button>
              <button type="button" className="btn btn-quiet row-btn" disabled={busy} aria-label={`Remove ${s.title}`} onClick={() => void quick('DELETE', `/api/skills/${s.id}`, undefined, `${s.title} removed.`)}>
                Remove
              </button>
            </span>
          </li>
        ))}
        {!extras.skills.length ? <li className="empty">Nothing yet. Add something {kid.name} is learning, like riding a bike or tying laces.</li> : null}
      </ul>
      <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={show({ kind: 'skill' })}>
        <Icon name="plus" />
        Add something {kid.name} is learning
      </button>

      {canEdit ? (
        <>
          <h3 className="sub-head">Questions about rules</h3>
          <ol className="group">
            {extras.ruleAsks.map((a) => (
              <li key={a.id} className="row">
                <span className="row-text">
                  &ldquo;{a.text}&rdquo;
                  <small>
                    Asked {a.when}. {a.status === 'answered' ? `Answer sent: "${a.answer}"` : a.status === 'review' ? 'On the family review agenda.' : 'Waiting for an answer.'}
                  </small>
                </span>
                {a.status !== 'answered' ? (
                  <span className="row-end">
                    <button type="button" className="btn btn-quiet row-btn" aria-label={`Answer: ${a.text}`} onClick={show({ kind: 'answer', id: a.id, text: a.text })}>
                      Answer
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
            {!extras.ruleAsks.length ? <li className="empty">No questions. {kid.name} can ask about any rule from the kiosk, under Me.</li> : null}
          </ol>
        </>
      ) : null}

      {sheet ? <ExtrasSheet kid={kid} extras={extras} open={sheet.open} from={sheet.from} onClosed={() => setSheet(undefined)} onDone={(t) => (toast(t), reload())} /> : null}
    </section>
  );
}

/** The parents' estimates, in the pilot measures section. */
export function PilotEstimates({ kid, extras, reload }: Props) {
  const toast = useToast();
  const [sheet, setSheet] = useState<{ open: Open; from: HTMLElement | null }>();
  const show = (open: Open) => (e: { currentTarget: HTMLElement }) => setSheet({ open, from: e.currentTarget });
  return (
    <>
      <div className="group" style={{ marginBottom: 12 }}>
        <div className="row">
          <span className="row-text">
            Screen time Family time can't see this week
            <small className="tnum">{extras.unmanagedMinutes === null ? 'Not given yet. Your best guess is fine.' : `About ${minutes(extras.unmanagedMinutes)}, your estimate`}</small>
          </span>
          <span className="row-end">
            <button type="button" className="btn btn-quiet row-btn" aria-label={`${extras.unmanagedMinutes === null ? 'Add' : 'Change'}: screen time Family time can't see this week`} onClick={show({ kind: 'unmanaged' })}>
              {extras.unmanagedMinutes === null ? 'Add' : 'Change'}
            </button>
          </span>
        </div>
        <div className="row">
          <span className="row-text">
            How {kid.name} has seemed in {extras.monthLabel}
            <small>{extras.mood ? `${MOOD_WORDS[extras.mood.rating - 1]}${extras.mood.note ? `: "${extras.mood.note}"` : ''}` : 'Not checked yet this month.'}</small>
          </span>
          <span className="row-end">
            <button type="button" className="btn btn-quiet row-btn" aria-label={`${extras.mood ? 'Change' : 'Add'}: how ${kid.name} has seemed in ${extras.monthLabel}`} onClick={show({ kind: 'mood' })}>
              {extras.mood ? 'Change' : 'Add'}
            </button>
          </span>
        </div>
      </div>
      {sheet ? <ExtrasSheet kid={kid} extras={extras} open={sheet.open} from={sheet.from} onClosed={() => setSheet(undefined)} onDone={(t) => (toast(t), reload())} /> : null}
    </>
  );
}

function ExtrasSheet({ kid, extras, open, from, onClosed, onDone }: { kid: ChildSummary; extras: ChildExtras; open: Open; from: HTMLElement | null; onClosed: () => void; onDone: (toast: string) => void }) {
  const sheet = useSheetAction(onClosed);
  const [text, setText] = useState(open.kind === 'praise' ? (extras.journal.find((j) => j.id === open.id)?.praise ?? '') : open.kind === 'mood' ? (extras.mood?.note ?? '') : '');
  const [n, setN] = useState(open.kind === 'unmanaged' ? (extras.unmanagedMinutes ?? 0) : open.kind === 'mood' ? (extras.mood?.rating ?? 0) : 0);
  const common = { open: sheet.open, onClose: sheet.close, returnFocus: from, error: sheet.error };
  const busy = sheet.busy;
  const t = text.trim();
  const send = (method: 'POST' | 'PUT', path: string, body: unknown, done: string) => void sheet.run(() => api(method, path, body), () => onDone(done));

  if (open.kind === 'praise') {
    return (
      <Sheet {...common} title="Send praise" sub={`For "${open.text}". ${kid.name} sees it on the kiosk, under Me.`}>
        <div className="form">
          <div>
            <label htmlFor="praise-text">Say something to {kid.name}</label>
            <textarea id="praise-text" className="field" value={text} maxLength={200} placeholder="Say what you liked about it." onChange={(e) => setText(e.target.value)} />
            <div className="suggest" role="group" aria-label="Suggested words">
              {PRAISE_IDEAS.map((s) => (
                <button key={s} type="button" onClick={() => setText(t ? `${t} ${s}.` : `${s}.`)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn btn-primary" disabled={!t || busy} onClick={() => send('POST', `/api/journal/${open.id}/praise`, { text: t }, `Praise sent. ${kid.name} sees it on the kiosk.`)}>
            {busy ? 'Sending' : t ? 'Send praise' : 'Write a few words first'}
          </button>
        </div>
      </Sheet>
    );
  }
  if (open.kind === 'skill') {
    return (
      <Sheet {...common} title={`Something ${kid.name} is learning`} sub={`When ${kid.name} can do it, tap Can do it now. It's a badge to be proud of, not points.`}>
        <div className="form">
          <div>
            <label htmlFor="skill-title">Learning to</label>
            <input id="skill-title" className="field" value={text} maxLength={40} placeholder="For example: ride a bike" onChange={(e) => setText(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={!t || busy} onClick={() => send('POST', `/api/children/${kid.id}/skills`, { title: t, picture: 'star' }, `Added: ${t}.`)}>
            {busy ? 'Saving' : t ? 'Add it' : 'Write the skill first'}
          </button>
        </div>
      </Sheet>
    );
  }
  if (open.kind === 'answer') {
    return (
      <Sheet {...common} title={`${kid.name} asked`} sub={`"${open.text}"`}>
        <div className="form">
          <div>
            <label htmlFor="answer-text">Your answer</label>
            <textarea id="answer-text" className="field" value={text} maxLength={300} placeholder="Give the reason for the rule, or what you'll change." onChange={(e) => setText(e.target.value)} />
            <p className="hint">{kid.name} sees your answer on the kiosk, under Me.</p>
          </div>
          <button type="button" className="btn btn-primary" disabled={!t || busy} onClick={() => send('POST', `/api/rule-asks/${open.id}/answer`, { action: 'answer', answer: t }, `Answered. ${kid.name} sees it on the kiosk.`)}>
            {busy ? 'Sending' : t ? 'Send the answer' : 'Write your answer first'}
          </button>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send('POST', `/api/rule-asks/${open.id}/answer`, { action: 'review' }, 'On the family review agenda, to talk about together.')}>
            Add to the family review
          </button>
        </div>
      </Sheet>
    );
  }
  if (open.kind === 'unmanaged') {
    return (
      <Sheet {...common} title="Screen time Family time can't see" sub={`About how much screen time ${kid.name} had this week away from home Wi-Fi, or at home on a screen or app Family time doesn't manage. A rough guess is fine.`}>
        <div className="form">
          <div>
            <span className="label">This week</span>
            <div className="stepper" role="group" aria-label="This week">
              <button type="button" aria-label="30 minutes less" disabled={n <= 0} onClick={() => setN((x) => Math.max(0, x - 30))}>
                <Icon name="minus" />
              </button>
              <output className="tnum" aria-live="polite">
                {minutes(n)}
              </output>
              <button type="button" aria-label="30 minutes more" disabled={n >= 7 * 24 * 60} onClick={() => setN((x) => Math.min(7 * 24 * 60, x + 30))}>
                <Icon name="plus" />
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('PUT', `/api/children/${kid.id}/unmanaged`, { minutes: n }, `Saved: about ${minutes(n)} this week.`)}>
            {busy ? 'Saving' : `Save about ${minutes(n)}`}
          </button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet {...common} title={`How ${kid.name} has seemed`} sub={`Your own view of ${extras.monthLabel}, once a month. It's a simple check for the pilot, not a medical scale.`}>
      <div className="form">
        <div>
          <span className="label" id="mood-pick">
            In {extras.monthLabel}
          </span>
          <div className="choice" role="group" aria-labelledby="mood-pick">
            {MOOD_WORDS.map((w, i) => (
              <button key={w} type="button" aria-pressed={n === i + 1} onClick={() => setN(i + 1)}>
                {w}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="mood-note">Anything to remember (optional)</label>
          <textarea id="mood-note" className="field" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" disabled={!n || busy} onClick={() => send('PUT', `/api/children/${kid.id}/mood`, { rating: n, note: t || undefined }, `Saved for ${extras.monthLabel}.`)}>
          {busy ? 'Saving' : n ? 'Save' : 'Choose one first'}
        </button>
      </div>
    </Sheet>
  );
}
