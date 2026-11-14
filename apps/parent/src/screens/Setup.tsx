// The owner's Set-up screen (Phase 9, brief Part 9): devices and their AdGuard clients, each
// child's rule for each group of apps, and the schedules. The same commands as the command line;
// every change reaches AdGuard through the control service within a minute.
import { DEVICE_KINDS, SCHEDULE_BLOCK_TYPES, type SetupView } from '@family-time/schemas';
import { useRef, useState } from 'react';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { useSheetAction } from '../components/useSheetAction';
import { useFetched } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { SYNC } from '../help/rightNow';
import { Icon } from '../icons';
import { navigate } from '../router';
import { useToast } from '../toast';

type Device = SetupView['devices'][number];
type Group = SetupView['groups'][number];
type Schedule = SetupView['schedules'][number];
type App = SetupView['ungrouped'][number];
type Block = Schedule['blocks'][number];

const KIND_WORDS: Record<(typeof DEVICE_KINDS)[number], string> = { ipad: 'iPad or tablet', phone: 'Phone', console: 'Games console', laptop: 'Laptop', tv: 'TV', kiosk: 'Kiosk', other: 'Something else' };
/** Each kind of device at a glance in the list. */
const KIND_ICONS = { ipad: 'tablet', phone: 'device', console: 'pad', laptop: 'laptop', tv: 'tv', kiosk: 'tablet', other: 'apps' } as const satisfies Record<(typeof DEVICE_KINDS)[number], string>;
const BLOCK_WORDS: Record<(typeof SCHEDULE_BLOCK_TYPES)[number], string> = { school: 'School', pause: 'Pause', 'wind-down': 'Wind-down', bed: 'Bedtime', free: 'Free time' };
/** Monday first, as a week reads; stored as 0 Sunday to 6 Saturday. */
const DAYS: [number, string, string][] = [
  [1, 'Mon', 'Monday'],
  [2, 'Tue', 'Tuesday'],
  [3, 'Wed', 'Wednesday'],
  [4, 'Thu', 'Thursday'],
  [5, 'Fri', 'Friday'],
  [6, 'Sat', 'Saturday'],
  [0, 'Sun', 'Sunday'],
];

function days(weekdays: number[]): string {
  const set = new Set(weekdays);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Monday to Friday';
  return DAYS.filter(([d]) => set.has(d))
    .map(([, short]) => short)
    .join(', ');
}

type SheetState = { kind: 'device'; device: Device | null } | { kind: 'rule'; group: Group; childId: string } | { kind: 'app'; app: App } | { kind: 'schedule'; schedule: Schedule | null };

export function Setup() {
  const toast = useToast();
  const { data: v, error, reload } = useFetched<SetupView>('/api/setup');
  const [childId, setChildId] = useState<string>();
  const [sheet, setSheet] = useState<{ state: SheetState; from: HTMLElement | null }>();
  const open = (state: SheetState) => (e: { currentTarget: HTMLElement }) => setSheet({ state, from: e.currentTarget });

  const kid = v?.children.find((c) => c.id === childId) ?? v?.children[0];
  const childName = (id: string | null) => v?.children.find((c) => c.id === id)?.name ?? 'Everyone';
  const apps = v ? [...v.groups.flatMap((g) => g.services.map((s) => ({ ...s, group: g.name }))), ...v.ungrouped.map((s) => ({ ...s, group: null }))].sort((a, b) => a.name.localeCompare(b.name)) : [];

  return (
    <main className="screen" aria-label="Set-up">
      <div className="large">
        <button type="button" className="back" onClick={() => navigate('/settings')}>
          <Icon name="left" />
          Settings
        </button>
        <h1>Set-up</h1>
        <p>Devices, the rule for each group of apps, and the family&apos;s schedules. Changes reach devices on home Wi-Fi within a minute.</p>
      </div>

      {error && !v ? (
        <div className="sec">
          <p className="empty-large" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : null}
      {!v && !error ? <p className="empty-large">Loading.</p> : null}

      {v ? (
        <>
          <section className="sec" aria-labelledby="setup-devices">
            <div className="sec-head">
              <h2 id="setup-devices">Devices</h2>
              <HelpButton topic="device-status" label="Is it working yet?" />
            </div>
            <div className="group">
              {v.devices.map((d) => (
                <div key={d.id} className="row">
                  <span className="row-icon">
                    <Icon name={KIND_ICONS[d.type as keyof typeof KIND_ICONS] ?? 'device'} />
                  </span>
                  <span className="row-text">
                    {d.label}
                    <small>
                      {childName(d.childId)}, {d.identifiers.join(', ')}. {SYNC[d.sync]}.
                    </small>
                  </span>
                  <span className="row-end">
                    <button type="button" className="btn btn-quiet row-btn" aria-label={`Change ${d.label}`} onClick={open({ kind: 'device', device: d })}>
                      Change
                    </button>
                  </span>
                </div>
              ))}
              {!v.devices.length ? <p className="empty">No devices yet. Add each device your child uses at home.</p> : null}
            </div>
            <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} disabled={!v.children.length} onClick={open({ kind: 'device', device: null })}>
              <Icon name="plus" />
              Add a device
            </button>
          </section>

          <section className="sec" aria-labelledby="setup-rules">
            <div className="sec-head">
              <h2 id="setup-rules">Rules for each group</h2>
              <HelpButton topic="allow-block-normal" label="Allow, Block and Normal" />
            </div>
            {v.children.length > 1 ? (
              <div className="choice choice-above" role="group" aria-label="Whose rules">
                {v.children.map((c) => (
                  <button key={c.id} type="button" aria-pressed={c.id === kid?.id} onClick={() => setChildId(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="group">
              {kid
                ? v.groups.map((g) => {
                    const p = v.policies.find((x) => x.childId === kid.id && x.groupId === g.id);
                    const rule = !p ? 'No rule yet: blocked unless planned' : p.alwaysAllowed ? 'Always allowed, outside the allowance' : p.defaultState === 'allowed' ? 'Allowed' : 'Blocked unless planned or allowed';
                    return (
                      <div key={g.id} className="row">
                        <span className="row-text">
                          {g.name}
                          <small>
                            {rule}
                            {p?.allowedDuringWindDown ? '. Fine in wind-down' : ''}. {g.services.length ? g.services.map((s) => s.name).join(', ') : 'No apps in it yet'}.
                          </small>
                        </span>
                        <span className="row-end">
                          <button type="button" className="btn btn-quiet row-btn" aria-label={`Change the rule for ${g.name}, ${kid.name}`} onClick={open({ kind: 'rule', group: g, childId: kid.id })}>
                            Change
                          </button>
                        </span>
                      </div>
                    );
                  })
                : null}
              {!v.groups.length ? <p className="empty">No groups yet. Run ./scripts/ft.sh setup-defaults on the server to add the usual ones.</p> : null}
            </div>
            {apps.length ? (
              <>
                <h3 className="sub-head">Apps and their group</h3>
                <div className="group">
                  {apps.map((a) => (
                    <div key={a.id} className="row">
                      <span className="row-text">
                        {a.name}
                        <small>{a.group ?? 'In no group'}</small>
                      </span>
                      <span className="row-end">
                        <button type="button" className="btn btn-quiet row-btn" aria-label={`Change the group for ${a.name}`} onClick={open({ kind: 'app', app: a })}>
                          Change
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section>

          <section className="sec" aria-labelledby="setup-schedules">
            <div className="sec-head">
              <h2 id="setup-schedules">Schedules</h2>
              <HelpButton topic="todays-rhythm" label="Today's rhythm" />
            </div>
            <div className="group">
              {v.schedules.map((s) => (
                <div key={s.id} className="row">
                  <span className="row-text">
                    {s.name}
                    <small>
                      {days(s.weekdays)}. {s.childId ? `Just for ${childName(s.childId)}` : 'Everyone'}. {s.blocks.map((b) => `${b.label ?? BLOCK_WORDS[b.type]} ${b.start} to ${b.end}`).join(', ')}.
                    </small>
                  </span>
                  <span className="row-end">
                    <button type="button" className="btn btn-quiet row-btn" aria-label={`Change ${s.name}`} onClick={open({ kind: 'schedule', schedule: s })}>
                      Change
                    </button>
                  </span>
                </div>
              ))}
              {!v.schedules.length ? <p className="empty">No schedules yet. Add the family&apos;s school days and weekends.</p> : null}
            </div>
            <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={open({ kind: 'schedule', schedule: null })}>
              <Icon name="plus" />
              Add a schedule
            </button>
          </section>

          {sheet ? (
            <Sheets
              key={JSON.stringify(sheet.state).slice(0, 80)}
              state={sheet.state}
              from={sheet.from}
              view={v}
              onClosed={() => setSheet(undefined)}
              onDone={(text) => {
                toast(text);
                void reload();
              }}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}

interface SheetsProps {
  state: SheetState;
  from: HTMLElement | null;
  view: SetupView;
  onClosed: () => void;
  onDone: (toast: string) => void;
}

function Sheets({ state, from, view, onClosed, onDone }: SheetsProps) {
  const sheet = useSheetAction(onClosed);
  const common = { open: sheet.open, onClose: sheet.close, returnFocus: from, error: sheet.error };
  const send = (method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, done: string) => void sheet.run(() => api(method, path, body), () => onDone(done));

  if (state.kind === 'device') return <DeviceSheet device={state.device} view={view} common={common} busy={sheet.busy} send={send} />;
  if (state.kind === 'rule') return <RuleSheet group={state.group} childId={state.childId} view={view} common={common} busy={sheet.busy} send={send} />;
  if (state.kind === 'app') return <AppSheet app={state.app} view={view} common={common} busy={sheet.busy} send={send} />;
  return <ScheduleSheet schedule={state.schedule} view={view} common={common} busy={sheet.busy} send={send} />;
}

interface Common {
  open: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
  error: string | undefined;
}
type Send = (method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, done: string) => void;

function DeviceSheet({ device, view, common, busy, send }: { device: Device | null; view: SetupView; common: Common; busy: boolean; send: Send }) {
  const [label, setLabel] = useState(device?.label ?? '');
  const [type, setType] = useState<(typeof DEVICE_KINDS)[number]>((device?.type as (typeof DEVICE_KINDS)[number] | undefined) ?? 'ipad');
  const [childId, setChildId] = useState(device?.childId ?? view.children[0]?.id ?? '');
  const [ids, setIds] = useState(device?.identifiers.join(', ') ?? '');
  const list = ids
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const body = { label: label.trim(), type, childId, identifiers: list };
  const ready = label.trim() && list.length && childId;
  return (
    <Sheet
      {...common}
      title={device ? `Change ${device.label}` : 'Add a device'}
      sub="Family time knows a device by its address on your home Wi-Fi. Turn off private Wi-Fi address on the device first, or the address will change."
      footer={
        device ? (
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send('DELETE', `/api/setup/devices/${device.id}`, undefined, `Removed ${device.label}. Family time stops managing it within a minute.`)}>
            Remove this device
          </button>
        ) : undefined
      }
    >
      <div className="form">
        <div>
          <label htmlFor="device-label">Name</label>
          <input id="device-label" className="field" value={label} maxLength={40} placeholder="For example: Ollie's iPad" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <span className="label" id="device-child">
            Whose is it?
          </span>
          <div className="choice" role="group" aria-labelledby="device-child">
            {view.children.map((c) => (
              <button key={c.id} type="button" aria-pressed={childId === c.id} onClick={() => setChildId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label" id="device-type">
            What is it?
          </span>
          <div className="choice wrap" role="group" aria-labelledby="device-type">
            {DEVICE_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}>
                {KIND_WORDS[k]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="device-ids">Its addresses</label>
          <input id="device-ids" className="field" aria-describedby="device-ids-hint" value={ids} placeholder="192.168.1.50" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setIds(e.target.value)} />
          <p id="device-ids-hint" className="hint">The IP address or MAC address. Your router's list of connected devices shows them. Separate more than one with commas.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || busy}
          onClick={() => (device ? send('PUT', `/api/setup/devices/${device.id}`, body, `Saved ${body.label}.`) : send('POST', '/api/setup/devices', body, `Added ${body.label}. Its rules start within a minute, on home Wi-Fi.`))}
        >
          {busy ? 'Saving' : ready ? (device ? 'Save the device' : 'Add the device') : 'Give it a name and an address first'}
        </button>
      </div>
    </Sheet>
  );
}

function RuleSheet({ group, childId, view, common, busy, send }: { group: Group; childId: string; view: SetupView; common: Common; busy: boolean; send: Send }) {
  const kid = view.children.find((c) => c.id === childId)!;
  const p = view.policies.find((x) => x.childId === childId && x.groupId === group.id);
  const [state, setState] = useState<'blocked' | 'allowed'>(p?.defaultState ?? 'blocked');
  const [windDown, setWindDown] = useState(p?.allowedDuringWindDown ?? false);
  const [always, setAlways] = useState(p?.alwaysAllowed ?? false);
  const toggle = (label: string, on: boolean, set: (v: boolean) => void, hint: string) => (
    <div className="row">
      <span className="row-text">
        {label}
        <small>{hint}</small>
      </span>
      <span className="row-end">
        <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} />
      </span>
    </div>
  );
  return (
    <Sheet {...common} title={`${group.name} for ${kid.name}`} sub="The usual rule. Allow, Block and Pause on Control come first until they end, then bedtime and wind-down, then this rule.">
      <div className="form">
        <div>
          <span className="label" id="rule-default">
            Usually
          </span>
          <div className="choice" role="group" aria-labelledby="rule-default">
            <button type="button" aria-pressed={state === 'blocked'} onClick={() => setState('blocked')}>
              Blocked unless planned or allowed
            </button>
            <button type="button" aria-pressed={state === 'allowed'} onClick={() => setState('allowed')}>
              Allowed
            </button>
          </div>
        </div>
        <div className="group">
          {toggle('Fine in wind-down', windDown, setWindDown, 'For calm things, like audiobooks.')}
          {toggle('Always allowed', always, setAlways, 'Outside the allowance, like homework tools or calls with grandparents. Bedtime still wins.')}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => send('PUT', '/api/setup/policies', { childId, groupId: group.id, defaultState: state, allowedDuringWindDown: windDown, alwaysAllowed: always }, `Saved the rule for ${group.name}.`)}
        >
          {busy ? 'Saving' : 'Save the rule'}
        </button>
      </div>
    </Sheet>
  );
}

function AppSheet({ app, view, common, busy, send }: { app: App; view: SetupView; common: Common; busy: boolean; send: Send }) {
  const current = view.groups.find((g) => g.services.some((s) => s.id === app.id))?.id ?? null;
  const [groupId, setGroupId] = useState<string | null>(current);
  const name = view.groups.find((g) => g.id === groupId)?.name;
  return (
    <Sheet {...common} title={`${app.name}'s group`} sub="An app follows its group's rule, and Allow or Block on a group reaches every app in it.">
      <div className="form">
        <div className="choice wrap" role="group" aria-label="Group">
          {view.groups.map((g) => (
            <button key={g.id} type="button" aria-pressed={groupId === g.id} onClick={() => setGroupId(g.id)}>
              {g.name}
            </button>
          ))}
          <button type="button" aria-pressed={groupId === null} onClick={() => setGroupId(null)}>
            No group
          </button>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send('PUT', `/api/setup/services/${app.id}/group`, { groupId }, name ? `${app.name} is in ${name} now.` : `${app.name} is in no group now.`)}>
          {busy ? 'Saving' : 'Save the group'}
        </button>
      </div>
    </Sheet>
  );
}

function ScheduleSheet({ schedule, view, common, busy, send }: { schedule: Schedule | null; view: SetupView; common: Common; busy: boolean; send: Send }) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [childId, setChildId] = useState<string | null>(schedule?.childId ?? null);
  const [weekdays, setWeekdays] = useState<number[]>(schedule?.weekdays ?? []);
  const [blocks, setBlocks] = useState<Block[]>(schedule?.blocks ?? [{ type: 'free', start: '15:30', end: '19:30' }, { type: 'wind-down', start: '19:30', end: '20:30' }, { type: 'bed', start: '20:30', end: '07:00' }]);
  const setBlock = (i: number, patch: Partial<Block>) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  // Removing a part takes its button away: focus goes to Add a part of the day, never to the page.
  const addPart = useRef<HTMLButtonElement>(null);
  const removeBlock = (i: number) => {
    setBlocks((bs) => bs.filter((_, j) => j !== i));
    requestAnimationFrame(() => addPart.current?.focus());
  };
  const ready = name.trim() && weekdays.length && blocks.length;
  const body = { name: name.trim(), childId, weekdays, blocks: blocks.map((b) => ({ type: b.type, start: b.start, end: b.end, ...(b.type === 'pause' && b.label?.trim() ? { label: b.label.trim() } : {}) })) };
  return (
    <Sheet
      {...common}
      title={schedule ? `Change ${schedule.name}` : 'Add a schedule'}
      sub="The parts of the day for some days of the week. A child's own schedule replaces the family's on its days."
      footer={
        schedule ? (
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send('DELETE', `/api/setup/schedules/${schedule.id}`, undefined, `Removed ${schedule.name}.`)}>
            Remove this schedule
          </button>
        ) : undefined
      }
    >
      <div className="form">
        <div>
          <label htmlFor="schedule-name">Name</label>
          <input id="schedule-name" className="field" value={name} maxLength={40} placeholder="For example: School night" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <span className="label" id="schedule-days">
            Days
          </span>
          <div className="choice wrap" role="group" aria-labelledby="schedule-days">
            {DAYS.map(([d, short, long]) => (
              <button key={d} type="button" aria-label={long} aria-pressed={weekdays.includes(d)} onClick={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))}>
                {short}
              </button>
            ))}
          </div>
        </div>
        {view.children.length ? (
          <div>
            <span className="label" id="schedule-who">
              For
            </span>
            <div className="choice wrap" role="group" aria-labelledby="schedule-who">
              <button type="button" aria-pressed={childId === null} onClick={() => setChildId(null)}>
                Everyone
              </button>
              {view.children.map((c) => (
                <button key={c.id} type="button" aria-pressed={childId === c.id} onClick={() => setChildId(c.id)}>
                  Just {c.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <fieldset className="blocks-edit" aria-describedby="blocks-hint">
          <legend className="label">Parts of the day</legend>
          {blocks.map((b, i) => (
            <div key={i} className="block-edit" role="group" aria-label={`Part ${i + 1}: ${BLOCK_WORDS[b.type]}`}>
              <select className="field" aria-label={`Part ${i + 1}: what`} value={b.type} onChange={(e) => setBlock(i, { type: e.target.value as Block['type'] })}>
                {SCHEDULE_BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BLOCK_WORDS[t]}
                  </option>
                ))}
              </select>
              <span className="block-times">
                <input className="field tnum" type="time" aria-label={`Part ${i + 1}: from`} value={b.start} onChange={(e) => setBlock(i, { start: e.target.value })} />
                <input className="field tnum" type="time" aria-label={`Part ${i + 1}: to`} value={b.end} onChange={(e) => setBlock(i, { end: e.target.value })} />
              </span>
              <button type="button" className="btn btn-quiet icon-btn" aria-label={`Remove part ${i + 1}: ${BLOCK_WORDS[b.type]}`} onClick={() => removeBlock(i)}>
                <Icon name="minus" />
              </button>
              {b.type === 'pause' ? (
                <label className="block-name">
                  <span aria-hidden="true">Called</span>
                  <input className="field" aria-label={`Part ${i + 1}: called`} value={b.label ?? ''} maxLength={20} placeholder="For example: Tea" onChange={(e) => setBlock(i, { label: e.target.value })} />
                </label>
              ) : null}
            </div>
          ))}
          <button ref={addPart} type="button" className="btn btn-quiet" disabled={blocks.length >= 12} onClick={() => setBlocks((bs) => [...bs, { type: 'free', start: '16:00', end: '17:00' }])}>
            <Icon name="plus" />
            Add a part of the day
          </button>
          <p id="blocks-hint" className="hint">Bedtime can run past midnight, like 20:30 to 07:00. Times are UK time, 24-hour.</p>
        </fieldset>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || busy}
          onClick={() => (schedule ? send('PUT', `/api/setup/schedules/${schedule.id}`, body, `Saved ${body.name}.`) : send('POST', '/api/setup/schedules', body, `Added ${body.name}.`))}
        >
          {busy ? 'Saving' : ready ? 'Save the schedule' : 'Give it a name and pick its days first'}
        </button>
      </div>
    </Sheet>
  );
}
