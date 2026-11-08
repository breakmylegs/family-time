// The Allow, Block and Pause sheets: four choices with their real end times from the server, a
// button that names the exact action, and the note that it takes up to a minute.
import { forChild, type ChildWords } from '@family-time/help-content';
import type { ChildStatus, DurationOption, ServiceStatus } from '@family-time/schemas';
import { useEffect, useState } from 'react';
import { useHelp } from '../help/HelpContext';
import { Icon } from '../icons';
import { Sheet } from './Sheet';
import { radioKeys } from '../ui';

export type Choice = DurationOption['choice'] | 'until-resume';
export type SheetKind = 'allow' | 'block' | 'pause';

export const PHRASE: Record<Choice, string> = {
  '30m': 'for 30 minutes',
  '1h': 'for 1 hour',
  'until-bedtime': 'until bedtime',
  'until-tomorrow': 'until tomorrow',
  'until-resume': 'until you resume',
};

interface Option {
  choice: Choice;
  label: string;
  until: string;
  /** The instant it ends, from the server. Empty for Until I resume. */
  end: string;
  note?: string;
}

/** "Ollie's iPad", or "Ollie's devices" when there are several. */
export function devicesOf(status: ChildStatus): string {
  if (status.devices.length === 1) return status.devices[0]!.label;
  return `${status.child.name}'s devices`;
}

/** "YouTube, Roblox and Minecraft". */
export function listOf(names: string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Allowed until Tue 07:00" to "allowed until Tue 07:00": only the first letter. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function serviceLine(s: Pick<ServiceStatus, 'state' | 'untilLabel'>): string {
  const word = s.state === 'allowed' ? 'Allowed' : s.state === 'paused' ? 'Paused' : 'Blocked';
  return s.untilLabel ? `${word} until ${s.untilLabel}` : word;
}

interface Props {
  kind: SheetKind | undefined;
  service: ServiceStatus | undefined;
  status: ChildStatus;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
  onConfirm: (choice: Choice, countsAgainstAllowance: boolean, option: Option) => void;
}

export function DurationSheet({ kind, service, status, returnFocus, onClose, onConfirm }: Props) {
  const [choice, setChoice] = useState<Choice>('30m');
  const [counts, setCounts] = useState(true);
  const help = useHelp();
  const child: ChildWords = { name: status.child.name, pronouns: status.child.pronouns };

  useEffect(() => {
    if (kind) {
      setChoice('30m');
      setCounts(true);
    }
  }, [kind, service?.id]);

  // Keep the last content while the sheet animates out.
  const [shown, setShown] = useState<{ kind: SheetKind; service: ServiceStatus | undefined }>();
  useEffect(() => {
    if (kind) setShown({ kind, service });
  }, [kind, service]);
  const k = kind ?? shown?.kind;
  const s = kind ? service : shown?.service;
  if (!k) return null;

  const options: Option[] = status.durations[k].map((o) => ({ choice: o.choice, label: o.label, until: o.until, end: o.end, ...(o.note ? { note: o.note } : {}) }));
  if (k === 'pause') options.push({ choice: 'until-resume', label: 'Until I resume', until: '', end: '' });
  const picked = options.find((o) => o.choice === choice) ?? options[0]!;
  const name = s?.name ?? '';
  const devices = devicesOf(status);

  const title = k === 'allow' ? `Allow ${name}` : k === 'block' ? `Block ${name}` : 'Pause everything';
  const sub =
    k === 'pause'
      ? status.services.length
        ? `Pauses ${listOf(status.services.map((x) => x.name))} on ${devices}. Takes up to a minute, and a video that's already playing may finish first.`
        : `Pauses every app Family time looks after on ${devices}. Takes up to a minute.`
      : k === 'allow'
        ? s?.layer === 'default'
          ? `${status.child.name} hasn't planned any ${name} time today.`
          : s?.reason
        : s?.inPlannedTime
          ? `It's in ${status.child.name}'s planned time right now.`
          : `It's ${lowerFirst(serviceLine(s!))} at the moment.`;
  const go = k === 'pause' ? `Pause everything ${PHRASE[picked.choice]}` : `${k === 'allow' ? 'Allow' : 'Block'} ${name} ${PHRASE[picked.choice]}`;

  return (
    <Sheet open={Boolean(kind)} onClose={onClose} title={title} sub={sub} returnFocus={returnFocus ?? null}>
      <div className="opts" role="radiogroup" aria-label={title} onKeyDown={radioKeys}>
        {options.map((o) => (
          <button key={o.choice} type="button" role="radio" className="opt" aria-checked={o.choice === picked.choice} onClick={() => setChoice(o.choice)}>
            <span className="radio" aria-hidden="true" />
            <span className="opt-text">
              <span className="opt-label">{o.label}</span>
              {o.note ? <span className="opt-note">{o.note}</span> : null}
            </span>
            <span className="opt-time tnum">{o.until}</span>
          </button>
        ))}
      </div>

      {k === 'allow' ? (
        <div className="toggle-row">
          <span>
            Count it in {status.child.name}&apos;s weekly time
            <small>{forChild("Off means it's extra, on top of {their} plan.", child)}</small>
          </span>
          <button type="button" className="switch" role="switch" aria-checked={counts} aria-label={`Count it in ${status.child.name}'s weekly time`} onClick={() => setCounts((c) => !c)} />
        </div>
      ) : null}

      <p className="sh-note">
        {k === 'pause' ? (
          <>
            <Icon name="heart" />
            <span>
              Best for meals and family time, rather than as a punishment.{' '}
              <button type="button" aria-label="Why? Help: Pause everything" onClick={(e) => help.open('pause-everything', e.currentTarget)}>
                Why?
              </button>
            </span>
          </>
        ) : (
          <>
            <Icon name="clock" />
            <span>
              {k === 'block' && s?.inPlannedTime
                ? forChild("{Their} planned time pauses, and the minutes not used go back to {them}. Takes up to a minute.", child)
                : k === 'block'
                  ? `Takes up to a minute on ${devices}. A video that's already playing may finish first.`
                  : `Takes up to a minute to start on ${devices}.`}
            </span>
          </>
        )}
      </p>

      <button type="button" className="btn btn-primary" onClick={() => onConfirm(picked.choice, counts, picked)}>
        {go}
      </button>
    </Sheet>
  );
}
