// Approvals, from the mock: jobs to approve with a note of praise, things done for love that get
// praise only, and requests for time. Each collapses on decision, with a 10-second Undo.
import type { ApprovalItem, Me } from '@family-time/schemas';
import { useRef, useState } from 'react';
import { api } from '../api';
import { useApprovals } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';

const CHIP_ICON = { money: 'coins', flex: 'star', time: 'clock', praise: 'heart' } as const;

/** What an approval added, in words: "50p added to Ollie's pocket money". */
function added(item: Extract<ApprovalItem, { kind: 'completion' }>): string | null {
  const pay = item.willPay;
  if (!pay?.amount) return null;
  if (item.reward.type === 'money') return `${pay.label} added to ${item.childName}'s pocket money`;
  if (item.reward.type === 'flex') return `${pay.label} added to ${item.childName}'s flex points`;
  return `${pay.label} added to ${item.childName}'s week`;
}

export function Approvals({ me }: { me: Me }) {
  const toast = useToast();
  const { data: items, error, reload } = useApprovals(true);
  const [gone, setGone] = useState<Set<string>>(new Set());
  // Decided cards stay in the list (collapsed to nothing), so the collapse finishes even when the
  // fresh list arrives mid-way, and Undo opens the card again where it was.
  const [kept, setKept] = useState<Map<string, { item: ApprovalItem; at: number }>>(new Map());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const titles = useRef(new Map<string, HTMLHeadingElement>());
  const doneRef = useRef<HTMLParagraphElement>(null);
  const parent = me.capabilities.includes('control.change');

  const list = [...(items ?? [])];
  for (const [id, { item, at }] of kept) if (!list.some((i) => i.id === id)) list.splice(Math.min(at, list.length), 0, item);
  const showing = list.filter((i) => !gone.has(i.id));

  /** Focus moves to the next card, or the one before it, or "All done", never to the page's top. */
  const focusAfter = (id: string) => {
    const at = showing.findIndex((i) => i.id === id);
    const next = showing[at + 1] ?? showing[at - 1];
    requestAnimationFrame(() => (next ? titles.current.get(next.id) : doneRef.current)?.focus({ preventScroll: true }));
  };

  const decide = async (item: ApprovalItem, action: 'approve' | 'not-yet', body: Record<string, unknown>, done: string) => {
    setKept((k) => new Map(k).set(item.id, { item, at: list.findIndex((i) => i.id === item.id) }));
    focusAfter(item.id);
    setGone((g) => new Set([...g, item.id]));
    const path = `/api/${item.kind === 'completion' ? 'completions' : 'requests'}/${item.id}`;
    const back = () => {
      setGone((g) => new Set([...g].filter((x) => x !== item.id)));
      requestAnimationFrame(() => titles.current.get(item.id)?.focus({ preventScroll: true }));
    };
    try {
      await api('POST', `${path}/${action}`, body);
      toast(done, async () => {
        try {
          await api('POST', `${path}/undo`);
          back();
          toast('Undone. It is back in the list.');
        } catch (err) {
          toast((err as Error).message);
        }
        void reload();
      });
    } catch (err) {
      back();
      toast((err as Error).message);
      void reload();
    }
  };

  return (
    <main className="screen" aria-label="Approvals">
      <div className="large">
        <h1>Approvals</h1>
        <p>{items === undefined ? '' : showing.length ? `${showing.length} waiting for you` : 'Nothing waiting'}</p>
      </div>
      {error && items === undefined ? (
        <div className="sec">
          <p className="empty-large" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn-quiet" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : null}
      <div className="appr">
        {list.map((item) => (
          <div key={item.id} className="item-wrap" data-gone={gone.has(item.id)} aria-hidden={gone.has(item.id)} inert={gone.has(item.id)}>
            <div className="item-clip">
              <article className="item" aria-labelledby={`t-${item.id}`}>
                {item.kind === 'completion' ? (
                  <Completion
                    item={item}
                    titleRef={(el) => void (el ? titles.current.set(item.id, el) : titles.current.delete(item.id))}
                    note={notes[item.id] ?? ''}
                    setNote={(v) => setNotes((n) => ({ ...n, [item.id]: v }))}
                    onDecide={decide}
                  />
                ) : (
                  <Request item={item} parent={parent} titleRef={(el) => void (el ? titles.current.set(item.id, el) : titles.current.delete(item.id))} onDecide={decide} />
                )}
              </article>
            </div>
          </div>
        ))}
      </div>
      {items && !showing.length ? (
        <p className="empty-large done" ref={doneRef} tabIndex={-1}>
          All done. New jobs and requests show up here.
        </p>
      ) : null}
      {items === undefined && !error ? <p className="empty-large">Loading.</p> : null}
    </main>
  );
}

type Decide = (item: ApprovalItem, action: 'approve' | 'not-yet', body: Record<string, unknown>, done: string) => Promise<void>;
type TitleRef = (el: HTMLHeadingElement | null) => void;

function Completion({ item, titleRef, note, setNote, onDecide }: { item: Extract<ApprovalItem, { kind: 'completion' }>; titleRef: TitleRef; note: string; setNote: (v: string) => void; onDecide: Decide }) {
  const praise = item.reward.type === 'praise';
  const fieldId = `say-${item.id}`;
  const text = note.trim();
  const body = { note: text || null };
  const what = added(item);
  const approvedToast = what && text ? `Approved. ${what}, and your note is on its way.` : what ? `Approved. ${what}.` : text ? 'Approved, and your note is on its way.' : 'Approved.';
  // A suggestion fills an empty box, or joins what was typed; never a second full stop after "?".
  const suggest = (s: string) => {
    const phrase = /[.?!]$/.test(s) ? s : `${s}.`;
    setNote(text ? `${text} ${phrase}` : phrase);
  };
  return (
    <>
      <div className="item-top">
        <div>
          <h2 className="item-title" id={`t-${item.id}`} ref={titleRef} tabIndex={-1}>
            {item.title}
          </h2>
          <p className="item-meta">
            {item.childName}, {item.when}
          </p>
        </div>
        <span className={`chip ${item.reward.type}`}>
          <Icon name={CHIP_ICON[item.reward.type]} />
          {item.reward.label}
        </span>
      </div>
      {item.capNote ? <p className="cap-note">{item.capNote}</p> : null}
      <div className="say">
        <div className="say-head">
          <label htmlFor={fieldId}>Say something to {item.childName}</label>
          <HelpButton topic="praise-not-prizes" label={praise ? 'Why praise only' : 'Praise, not prizes'} />
        </div>
        <textarea id={fieldId} value={note} maxLength={280} placeholder={praise ? 'Say what you liked about it.' : `Optional. ${item.childName} sees it on the kiosk.`} onChange={(e) => setNote(e.target.value)} />
        <div className="suggest" role="group" aria-label="Suggested words">
          {item.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => suggest(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        {praise ? (
          <button type="button" className="btn btn-primary" disabled={!text} onClick={() => void onDecide(item, 'approve', body, `Praise sent. ${item.childName} sees it on the kiosk.`)}>
            {text ? 'Send praise' : 'Write a few words first'}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', body, approvedToast)}>
              Approve
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void onDecide(item, 'not-yet', body, `Not yet. It's back on ${item.childName}'s jobs for when it's finished.`)}>
              Not yet
            </button>
          </>
        )}
      </div>
    </>
  );
}

function Request({ item, parent, titleRef, onDecide }: { item: Extract<ApprovalItem, { kind: 'request' }>; parent: boolean; titleRef: TitleRef; onDecide: Decide }) {
  return (
    <>
      <div className="item-top">
        <div>
          <h2 className="item-title" id={`t-${item.id}`} ref={titleRef} tabIndex={-1}>
            {item.title}
          </h2>
          <p className="item-meta">
            {item.childName} asked {item.when}
          </p>
        </div>
        <span className="chip time">
          <Icon name="clock" />
          {item.minutes} min
        </span>
      </div>
      <p className="req-detail">
        {item.blockedReason ? `${item.blockedReason} It can't be planned, so tap Not this time.` : item.detail}
        {item.extraOnly && !parent ? ' Only a parent can say yes as extra time.' : ''}
      </p>
      <div className="actions req">
        {item.blockedReason ? null : item.extraOnly ? (
          parent ? (
            <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', { asExtra: true }, `${item.target} allowed ${item.window} as extra time. It doesn't come off ${item.childName}'s week.`)}>
              Yes, as extra time
            </button>
          ) : null
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', { asExtra: false }, `${item.target} planned for ${item.window}. ${item.minutes} minutes come off ${item.childName}'s week.`)}>
            <span className="nowrap">
              Yes, <span className="tnum">{item.window}</span>
            </span>
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => void onDecide(item, 'not-yet', {}, `Not this time. ${item.childName} sees your answer on the kiosk.`)}>
          Not this time
        </button>
        <HelpButton topic="asking-for-time" label="Asking for time" />
      </div>
    </>
  );
}
