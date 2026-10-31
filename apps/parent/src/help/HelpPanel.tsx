// The right-hand panel. Radix Dialog does the focus trap, Escape, tapping outside and the aria
// wiring; the panel itself is styled to the mock. Swiping right closes it too.
import content, { type TopicId } from '@family-time/help-content/content';
import { forChild, type ChildWords, type Evidence } from '@family-time/help-content';
import type { ChildStatus, WeekSummary } from '@family-time/schemas';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import { pinInPlace } from '../components/motion';
import { Icon } from '../icons';
import { RIGHT_NOW } from './rightNow';

const LEVEL: Record<Evidence, { bars: number; name: string }> = {
  strong: { bars: 3, name: 'Strong evidence.' },
  moderate: { bars: 2, name: 'Moderate evidence.' },
  early: { bars: 1, name: 'Early evidence.' },
};

/** The child's words, then a capital at the start, for "{child} plans" when there is no child yet. */
function words(text: string, child: ChildWords) {
  const t = forChild(text, child);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface Props {
  open: boolean;
  trail: TopicId[];
  child: ChildWords;
  status: ChildStatus | undefined;
  week?: WeekSummary | undefined;
  /** What opened the panel, to get focus back. */
  returnTo: HTMLElement | null;
  onFollow: (id: TopicId) => void;
  onBack: () => void;
  onClose: () => void;
}

export function HelpPanel({ open, trail, child, status, week, returnTo, onFollow, onBack, onClose }: Props) {
  const id = trail[trail.length - 1];
  const topic = id ? content.topics[id] : undefined;
  const previous = trail.length > 1 ? content.topics[trail[trail.length - 2]!] : undefined;
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState<string>();
  // The swipe lives in a ref and writes the transform straight to the element: no re-render per move.
  const swipe = useRef<{ x: number; t: number; id: number; dx: number }>(undefined);

  // A new topic: back to the top, title focused so a screen reader starts there.
  useEffect(() => {
    setAnswered(undefined);
    if (!open) return;
    body.current?.scrollTo({ top: 0 });
    title.current?.focus({ preventScroll: true });
  }, [id, open]);


  const feedback = async (helpful: boolean) => {
    setAnswered(id);
    try {
      await api('POST', '/api/help/feedback', { topicId: id, helpful });
    } catch {
      // Feedback is a nicety. Losing one answer is not worth an error on screen.
    }
  };

  const close = () => {
    pinInPlace(panel.current);
    onClose();
  };

  const onPointerDown = (e: PointerEvent) => {
    // One finger only: a second one must not become the new starting point.
    if (swipe.current || e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button,summary,a')) return;
    swipe.current = { x: e.clientX, t: performance.now(), id: e.pointerId, dx: 0 };
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = swipe.current;
    const el = panel.current;
    if (!s || !el || e.pointerId !== s.id) return;
    s.dx = Math.max(0, e.clientX - s.x);
    if (s.dx <= 6) return;
    if (el.dataset.dragging !== 'true') {
      // A swipe that starts during the entrance takes over from it.
      el.getAnimations().forEach((a) => a.finish());
      el.dataset.dragging = 'true';
    }
    el.style.transform = `translateX(${s.dx}px)`;
  };
  const onPointerEnd = (e: PointerEvent) => {
    const s = swipe.current;
    const el = panel.current;
    if (!s || e.pointerId !== s.id) return;
    swipe.current = undefined;
    if (!el || el.dataset.dragging !== 'true') return;
    const speed = s.dx / Math.max(1, performance.now() - s.t);
    if (e.type === 'pointerup' && (s.dx > 90 || (speed > 0.11 && s.dx > 20))) {
      close();
      return;
    }
    // Short of closing: the open state's transition carries it home.
    el.dataset.dragging = 'false';
    el.style.transform = '';
  };

  const rightNow = id && status ? RIGHT_NOW[id]?.(status, week) : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        {/* Above any sheet, so "Why?" in the Pause sheet opens help on top of it. */}
        <Dialog.Overlay className="scrim scrim-help" />
        <Dialog.Content
          ref={panel}
          className="panel"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            title.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => {
            // No Radix trigger: the (?) that opened it gets focus back.
            e.preventDefault();
            if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div className="panel-top">
            <span className="crumb">
              {previous ? (
                <button type="button" aria-label={`Back to ${previous.title}`} onClick={onBack}>
                  <Icon name="right" />
                  {previous.title}
                </button>
              ) : (
                'Help'
              )}
            </span>
            <Dialog.Close className="close" aria-label="Close help">
              <Icon name="x" />
            </Dialog.Close>
          </div>
          <div className="panel-body" ref={body}>
            {topic ? (
              <>
                <Dialog.Title className="p-title" ref={title} tabIndex={-1}>
                  {topic.title}
                </Dialog.Title>
                <p className="p-lead">{words(topic.inShort, child)}</p>

                {topic.howToUse ? (
                  <section className="p-sec">
                    <h3>How to use it</h3>
                    <ol className="p-steps">
                      {topic.howToUse.map((s) => (
                        <li key={s}>{words(s, child)}</li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {topic.howItWorks ? (
                  <section className="p-sec">
                    <h3>How it works</h3>
                    {topic.howItWorks.map((p) => (
                      <p key={p}>{words(p, child)}</p>
                    ))}
                  </section>
                ) : null}

                {topic.whyItHelps ? (
                  <section className="p-sec">
                    <h3>Why it helps</h3>
                    {topic.evidence ? (
                      <div className="ev">
                        <span className="meter" data-level={LEVEL[topic.evidence].bars} aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="ev-text">
                          <strong>{LEVEL[topic.evidence].name}</strong> {topic.evidenceNote}
                        </span>
                      </div>
                    ) : null}
                    {topic.whyItHelps.map((p) => (
                      <p key={p}>{words(p, child)}</p>
                    ))}
                  </section>
                ) : null}

                {topic.childSees ? (
                  <section className="p-sec">
                    <h3>{forChild('What {child} sees', child)}</h3>
                    <p className="sees">{forChild(topic.childSees, child)}</p>
                  </section>
                ) : null}

                {topic.watchOutFor ? (
                  <section className="p-sec">
                    <h3>Watch out for</h3>
                    {topic.watchOutFor.map((p) => (
                      <p key={p}>{words(p, child)}</p>
                    ))}
                  </section>
                ) : null}

                {rightNow?.length ? (
                  <section className="p-sec">
                    <h3>Right now</h3>
                    <dl className="dl">
                      {rightNow.map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd className="tnum">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {topic.research ? (
                  <details className="research">
                    <summary>
                      The research
                      <Icon name="right" />
                    </summary>
                    {topic.research.map((p) => (
                      <p key={p}>{words(p, child)}</p>
                    ))}
                    {topic.sources.map((s) => (
                      <p key={s} className="cite">
                        {content.sources[s]?.citation}
                      </p>
                    ))}
                  </details>
                ) : null}

                {topic.related.length ? (
                  <section className="p-sec">
                    <h3>Related</h3>
                    <div className="related">
                      {topic.related.map((r) => (
                        <button key={r} type="button" onClick={() => onFollow(r)}>
                          {content.topics[r].title}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="helpful" role="group" aria-label="Was this helpful?">
                  {answered === id ? (
                    <span role="status">Thanks. Your answer stays in your own Family time and is never sent anywhere else.</span>
                  ) : (
                    <>
                      <span>Was this helpful?</span>
                      <span className="gap" />
                      <button type="button" onClick={() => void feedback(true)}>
                        Yes
                      </button>
                      <button type="button" onClick={() => void feedback(false)}>
                        No
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <Dialog.Title className="p-title">Help</Dialog.Title>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
