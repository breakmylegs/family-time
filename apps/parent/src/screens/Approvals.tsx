// Approvals, from the mock: jobs to approve with a note of praise, things done for love that get
// praise only, and requests for time. Each collapses on decision, with a 10-second Undo.
import type { ApprovalItem, Me } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { useApprovals } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';

const CHIP_ICON = { money: 'coins', flex: 'star', time: 'clock', praise: 'heart' } as const;

export function Approvals({ me }: { me: Me }) {
  const toast = useToast();
  const { data: items, error, reload } = useApprovals(true);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const parent = me.capabilities.includes('control.change');

  const decide = async (item: ApprovalItem, action: 'approve' | 'not-yet', body: Record<string, unknown>, done: string) => {
    setGone((g) => new Set([...g, item.id]));
    const path = `/api/${item.kind === 'completion' ? 'completions' : 'requests'}/${item.id}`;
    try {
      await api('POST', `${path}/${action}`, body);
      toast(done, async () => {
        try {
          await api('POST', `${path}/undo`);
          setGone((g) => new Set([...g].filter((x) => x !== item.id)));
          toast('Undone. It is back in the list.');
        } catch (err) {
          toast((err as Error).message);
        }
        void reload();
      });
    } catch (err) {
      setGone((g) => new Set([...g].filter((x) => x !== item.id)));
      toast((err as Error).message);
      void reload();
    }
  };

  const showing = (items ?? []).filter((i) => !gone.has(i.id));
  const waiting = showing.length;

  return (
    <main className="screen" aria-label="Approvals">
      <div className="large">
        <h1>Approvals</h1>
        <p aria-live="polite">{items === undefined ? '' : waiting ? `${waiting} waiting for you` : 'Nothing waiting'}</p>
      </div>
      {error ? (
        <p className="empty-large" role="alert">
          {error}
        </p>
      ) : null}
      <div className="appr">
        {(items ?? []).map((item) => (
          <div key={item.id} className="item-wrap" data-gone={gone.has(item.id)} aria-hidden={gone.has(item.id)} inert={gone.has(item.id)}>
            <article className="item" aria-labelledby={`t-${item.id}`}>
              {item.kind === 'completion' ? (
                <Completion item={item} note={notes[item.id] ?? ''} setNote={(v) => setNotes((n) => ({ ...n, [item.id]: v }))} onDecide={decide} />
              ) : (
                <Request item={item} parent={parent} onDecide={decide} />
              )}
            </article>
          </div>
        ))}
      </div>
      {items && !waiting ? <p className="empty-large">All done. New jobs and requests will show up here and on your notifications.</p> : null}
      {items === undefined && !error ? <p className="empty-large">Loading.</p> : null}
    </main>
  );
}

type Decide = (item: ApprovalItem, action: 'approve' | 'not-yet', body: Record<string, unknown>, done: string) => Promise<void>;

function Completion({ item, note, setNote, onDecide }: { item: Extract<ApprovalItem, { kind: 'completion' }>; note: string; setNote: (v: string) => void; onDecide: Decide }) {
  const praise = item.reward.type === 'praise';
  const fieldId = `say-${item.id}`;
  const body = { note: note.trim() || null };
  const paid = item.willPay?.amount ? item.willPay.label : null;
  return (
    <>
      <div className="item-top">
        <div>
          <h2 className="item-title" id={`t-${item.id}`}>
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
            <button key={s} type="button" onClick={() => setNote(`${s}.`)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        {praise ? (
          <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', body, `Praise sent. ${item.childName} sees it on the kiosk.`)}>
            Send praise
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', body, paid ? `Approved. ${paid} added, and your note is on its way.` : 'Approved, and your note is on its way.')}>
              Approve
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void onDecide(item, 'not-yet', body, 'Left for later. It stays on the list.')}>
              Not yet
            </button>
          </>
        )}
      </div>
    </>
  );
}

function Request({ item, parent, onDecide }: { item: Extract<ApprovalItem, { kind: 'request' }>; parent: boolean; onDecide: Decide }) {
  return (
    <>
      <div className="item-top">
        <div>
          <h2 className="item-title" id={`t-${item.id}`}>
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
      <p className="req-detail">{item.blockedReason ? `${item.blockedReason} So this one can't be planned.` : item.detail}</p>
      <div className="actions">
        {item.blockedReason ? null : item.extraOnly ? (
          parent ? (
            <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', { asExtra: true }, `Yes, as extra time: ${item.window}. It doesn't come off the week.`)}>
              Yes, as extra time
            </button>
          ) : null
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void onDecide(item, 'approve', { asExtra: false }, `Planned for ${item.window}. ${item.minutes} minutes come off the week.`)}>
            <span className="nowrap">
              Yes, <span className="tnum">{item.window}</span>
            </span>
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => void onDecide(item, 'not-yet', {}, `Not tonight. ${item.childName} sees your answer on the kiosk.`)}>
          Not tonight
        </button>
      </div>
    </>
  );
}
