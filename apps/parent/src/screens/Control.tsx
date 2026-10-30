// Control: what is on and why, and Allow, Block, Normal and Pause everything in a couple of taps.
// Optimistic: the screen changes at once, the server's answer replaces the guess, and a 10-second
// toast offers Undo. Only Pause everything asks first.
import type { ChildStatus, ChildSummary, HistoryEntry, Me, Mood, ServiceStatus } from '@family-time/schemas';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { DurationSheet, devicesOf, PHRASE, serviceLine, type Choice, type SheetKind } from '../components/DurationSheet';
import { Rail } from '../components/Rail';
import { Sheet } from '../components/Sheet';
import { HelpButton } from '../help/HelpButton';
import { Icon, serviceIcon } from '../icons';
import { useToast } from '../toast';

interface Props {
  me: Me;
  kids: ChildSummary[];
  status: ChildStatus;
  history: HistoryEntry[];
  setStatus: (s: ChildStatus) => void;
  accept: (s: ChildStatus) => void;
  setHistory: (h: HistoryEntry[]) => void;
  refresh: () => Promise<void>;
  onPickChild: (id: string) => void;
}

const MOODS: { mood: Mood; label: string }[] = [
  { mood: 'calm', label: 'Calm' },
  { mood: 'grumble', label: 'Grumble' },
  { mood: 'meltdown', label: 'Meltdown' },
];

const untilOf = (label: string) => label.replace(/^until /, '') || null;

export function Control({ me, kids, status, history, setStatus, accept, setHistory, refresh, onPickChild }: Props) {
  const toast = useToast();
  const [sheet, setSheet] = useState<{ kind: SheetKind; serviceId?: string; from: HTMLElement | null }>();
  const [picking, setPicking] = useState<HTMLElement | null>();
  const canChange = me.capabilities.includes('control.change');
  const canPause = me.capabilities.includes('control.pause');
  const childId = status.child.id;
  const base = `/api/children/${childId}`;

  // "Starting on Ollie's iPad" until AdGuard confirms, then "Working on Ollie's iPad now" for a moment.
  const [watching, setWatching] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const confirmed = [...watching].filter((id) => status.services.find((s) => s.id === id)?.inForce);
    if (!confirmed.length) return;
    setWatching((w) => new Set([...w].filter((id) => !confirmed.includes(id))));
    setDone((d) => new Set([...d, ...confirmed]));
    timers.current.push(setTimeout(() => setDone((d) => new Set([...d].filter((id) => !confirmed.includes(id)))), 5_000));
  }, [status, watching]);

  const watch = (ids: string[]) => {
    setWatching((w) => new Set([...w, ...ids]));
    setDone((d) => new Set([...d].filter((id) => !ids.includes(id))));
  };

  /** Shows the guess, sends the action, then shows the server's answer. On failure, says why and reloads. */
  const act = async (guess: ChildStatus, send: () => Promise<ChildStatus>, ids: string[]): Promise<ChildStatus | undefined> => {
    setStatus(guess);
    watch(ids);
    try {
      const answer = await send();
      accept(answer);
      void refresh();
      return answer;
    } catch (err) {
      toast((err as Error).message);
      void refresh();
      return undefined;
    }
  };

  const patchService = (id: string, patch: Partial<ServiceStatus>): ChildStatus => ({
    ...status,
    services: status.services.map((s) => (s.id === id ? { ...s, ...patch, inForce: false } : s)),
  });

  const allowOrBlock = async (kind: 'allow' | 'block', svc: ServiceStatus, choice: Choice, counts: boolean, until: string) => {
    setSheet(undefined);
    const guess = patchService(svc.id, {
      state: kind === 'allow' ? 'allowed' : 'blocked',
      layer: 'override',
      untilLabel: untilOf(until),
      reason: `${me.displayName} ${kind === 'allow' ? 'allowed' : 'blocked'} it.`,
      override: { id: 'pending', type: kind },
    });
    const answer = await act(
      guess,
      () => api<ChildStatus>('POST', `${base}/overrides`, { target: { kind: 'service', id: svc.id }, type: kind, duration: choice, countsAgainstAllowance: counts }),
      [svc.id],
    );
    const made = answer?.services.find((s) => s.id === svc.id)?.override;
    if (!answer || !made) return;
    toast(`${svc.name} ${kind === 'allow' ? 'allowed' : 'blocked'} ${PHRASE[choice]}.`, () => void undo(`${base}/overrides/${made.id}/end`, [svc.id]));
  };

  const normal = async (svc: ServiceStatus) => {
    if (!svc.override) return;
    const target = { kind: 'service', id: svc.id };
    const answer = await act(
      patchService(svc.id, { override: null, reason: 'Going back to normal.' }),
      () => api<ChildStatus>('POST', `${base}/normal`, { target }),
      [svc.id],
    );
    const now = answer?.services.find((s) => s.id === svc.id);
    if (!answer || !now) return;
    toast(`${svc.name} back to normal. ${serviceLine(now)}.`, () => void undo(`${base}/normal/undo`, [svc.id], { target }));
  };

  const pause = async (choice: Choice, until: string) => {
    setSheet(undefined);
    const untilLabel = choice === 'until-resume' ? null : untilOf(until);
    const guess: ChildStatus = {
      ...status,
      headline: { lead: 'Everything is paused', rest: `${untilLabel ? `until ${untilLabel}` : 'until you resume'}. ${me.displayName} started it.` },
      pause: { id: 'pending', by: me.displayName, until: null, untilLabel },
      services: status.services.map((s) => ({ ...s, state: 'paused', inForce: false })),
    };
    const ids = status.services.map((s) => s.id);
    const answer = await act(guess, () => api<ChildStatus>('POST', `${base}/overrides`, { target: { kind: 'everything' }, type: 'pause', duration: choice }), ids);
    if (!answer?.pause) return;
    const pauseId = answer.pause.id;
    toast(`Everything paused ${PHRASE[choice]}. Takes up to a minute.`, () => void undo(`${base}/overrides/${pauseId}/end`, ids));
  };

  const resume = async () => {
    const ids = status.services.map((s) => s.id);
    const answer = await act({ ...status, pause: null }, () => api<ChildStatus>('POST', `${base}/resume`), ids);
    if (answer) toast("Everything's back to normal.");
  };

  const undo = async (path: string, ids: string[], body?: unknown) => {
    watch(ids);
    try {
      accept(await api<ChildStatus>('POST', path, body));
      toast('Undone.');
    } catch (err) {
      toast((err as Error).message);
    }
    void refresh();
  };

  const tapMood = async (entry: HistoryEntry, mood: Mood) => {
    if (!entry.ending) return;
    const ref = entry.ending.ref;
    setHistory(history.map((h) => (h.ending?.ref === ref ? { ...h, ending: { ref, mood } } : h)));
    try {
      await api('POST', `${base}/endings`, { ref, mood });
    } catch (err) {
      toast((err as Error).message);
      void refresh();
    }
  };

  const sheetService = sheet?.serviceId ? status.services.find((s) => s.id === sheet.serviceId) : undefined;
  const paused = Boolean(status.pause);
  const devices = devicesOf(status);
  const problems = status.devices.filter((d) => d.quietSince || d.sync === 'not-confirmed');

  return (
    <main className="screen" aria-label="Control">
      <div className="shell">
        <div className="shell-inner">
          {kids.length > 1 ? (
            <button type="button" className="child-switch" aria-label={`Showing ${status.child.name}. Switch child`} onClick={(e) => setPicking(e.currentTarget)}>
              {status.child.name}
              <Icon name="down" />
            </button>
          ) : (
            <h1 className="child-name">{status.child.name}</h1>
          )}
          <p className="now-line" aria-live="polite">
            <strong>{status.headline.lead}</strong> {status.headline.rest}
          </p>
          <Rail status={status} />
          {canPause ? (
            <div className="pause-row">
              {paused ? (
                <button type="button" className="shell-action" data-paused="true" onClick={() => void resume()}>
                  <Icon name="play" />
                  <span>Resume now</span>
                </button>
              ) : (
                <button type="button" className="shell-action" data-paused="false" onClick={(e) => setSheet({ kind: 'pause', from: e.currentTarget })}>
                  <Icon name="pause" />
                  <span>Pause everything</span>
                </button>
              )}
              <HelpButton topic="pause-everything" label="Pause everything" />
            </div>
          ) : null}
        </div>
      </div>

      <section className="sec" aria-labelledby="right-now">
        <div className="sec-head">
          <h2 id="right-now">Right now</h2>
          <HelpButton topic="allow-block-normal" label="Allow, Block and Normal" />
        </div>
        {problems.length ? (
          <div className="group" style={{ marginBottom: 12 }}>
            {problems.map((d) => (
              <div key={d.id} className="row">
                <span className="row-icon">
                  <Icon name="alert" />
                </span>
                <span className="row-text">
                  {d.quietSince ? `${d.label} has gone quiet.` : `Not confirmed on ${d.label}.`}
                  <small>{d.quietSince ? 'Its apps are not being managed right now.' : 'Family time keeps trying every minute.'}</small>
                </span>
                <span className="row-end">
                  <HelpButton topic={d.quietSince ? 'device-gone-quiet' : 'device-status'} label={d.quietSince ? 'A device has gone quiet' : 'Is it working yet?'} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <ul className="group">
          {status.services.map((s) => (
            <ServiceRow
              key={s.id}
              svc={s}
              devices={status.devices.length ? devices : undefined}
              watching={watching.has(s.id)}
              done={done.has(s.id)}
              notConfirmed={status.devices.some((d) => d.sync === 'not-confirmed')}
              canChange={canChange}
              paused={paused}
              onAllow={(from) => setSheet({ kind: 'allow', serviceId: s.id, from })}
              onBlock={(from) => setSheet({ kind: 'block', serviceId: s.id, from })}
              onNormal={() => void normal(s)}
            />
          ))}
          {!status.services.length ? <li className="empty">No apps to manage yet. Whoever set up Family time can add them.</li> : null}
        </ul>
        <p className="foot">
          <Icon name="clock" />
          <span>Changes take up to a minute. A video that&apos;s already playing may finish first.</span>
        </p>
      </section>

      <section className="sec" aria-labelledby="today">
        <div className="sec-head">
          <h2 id="today">Today</h2>
          <HelpButton topic="how-it-ended" label="How did it end?" />
        </div>
        <ol className="group hist">
          {history.map((h) => (
            <li key={`${h.at}${h.text}`}>
              <time className="tnum" dateTime={h.at}>
                {h.time}
              </time>
              <div>
                <span>{h.text}</span>
                {h.ending ? (
                  <div className="moods" role="group" aria-label={`How did it go? ${h.text}`}>
                    {MOODS.map((m) => (
                      <button key={m.mood} type="button" aria-pressed={h.ending!.mood === m.mood} onClick={() => void tapMood(h, m.mood)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
          {!history.length ? <li className="empty">Nothing yet today.</li> : null}
        </ol>
      </section>

      <DurationSheet
        kind={sheet?.kind}
        service={sheetService}
        status={status}
        returnFocus={sheet?.from ?? null}
        onClose={() => setSheet(undefined)}
        onConfirm={(choice, counts, option) => {
          if (sheet?.kind === 'pause') void pause(choice, option.until);
          else if (sheet && sheetService) void allowOrBlock(sheet.kind as 'allow' | 'block', sheetService, choice, counts, option.until);
        }}
      />

      <Sheet open={Boolean(picking)} onClose={() => setPicking(null)} title="Show" returnFocus={picking ?? null}>
        <div className="opts" role="radiogroup" aria-label="Show">
          {kids.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              className="opt"
              aria-checked={k.id === childId}
              onClick={() => {
                setPicking(null);
                onPickChild(k.id);
              }}
            >
              <span className="radio" aria-hidden="true" />
              <span className="opt-text">
                <span className="opt-label">{k.name}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </main>
  );
}

interface RowProps {
  svc: ServiceStatus;
  devices: string | undefined;
  watching: boolean;
  done: boolean;
  notConfirmed: boolean;
  canChange: boolean;
  paused: boolean;
  onAllow: (from: HTMLElement) => void;
  onBlock: (from: HTMLElement) => void;
  onNormal: () => void;
}

function ServiceRow({ svc, devices, watching, done, notConfirmed, canChange, paused, onAllow, onBlock, onNormal }: RowProps) {
  const index = svc.override?.type === 'allow' ? 0 : svc.override?.type === 'block' ? 1 : 2;
  let pending: { text: string; done?: boolean; problem?: boolean } | undefined;
  if (devices) {
    if (!svc.inForce && notConfirmed) pending = { text: `Not confirmed on ${devices}. Still trying.`, problem: true };
    else if (!svc.inForce) {
      const verb = svc.state === 'allowed' ? 'Starting' : svc.state === 'paused' ? 'Pausing' : 'Blocking';
      pending = { text: `${verb} on ${devices}. Takes up to a minute.` };
    } else if (done || (watching && svc.inForce)) {
      pending = { text: svc.state === 'allowed' ? `Working on ${devices} now.` : svc.state === 'paused' ? `Paused on ${devices} now.` : `Blocked on ${devices} now.`, done: true };
    }
  }
  return (
    <li className="svc" data-state={svc.state}>
      <span className="svc-icon">
        <Icon name={serviceIcon(svc.icon)} />
      </span>
      <div>
        <h3 className="svc-name">{svc.name}</h3>
        <p className="svc-line tnum">{serviceLine(svc)}</p>
        <p className="svc-reason">{svc.reason}</p>
        {pending ? (
          <p className="svc-pending" data-done={Boolean(pending.done)} data-problem={Boolean(pending.problem)} role="status">
            <Icon name={pending.done ? 'check' : 'clock'} />
            <span>{pending.text}</span>
          </p>
        ) : null}
        {canChange ? (
          <div className="segc" role="group" aria-label={svc.name} data-disabled={paused} style={{ ['--i' as string]: index }}>
            <span className="segc-thumb" aria-hidden="true" />
            <button type="button" aria-pressed={index === 0} disabled={paused} onClick={(e) => onAllow(e.currentTarget)}>
              Allow
            </button>
            <button type="button" aria-pressed={index === 1} disabled={paused} onClick={(e) => onBlock(e.currentTarget)}>
              Block
            </button>
            <button type="button" aria-pressed={index === 2} disabled={paused} onClick={onNormal}>
              Normal
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
