// Jobs: what the children can do, and what each earns. The editor starts on pocket money, shows the
// cap on screen time earned from jobs, and explains both with a (?).
import type { ChildSummary, Recurrence, Task, TaskInput } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { JobIdeas } from '../components/JobIdeas';
import { Sheet } from '../components/Sheet';
import { useSheetAction } from '../components/useSheetAction';
import { minutes, pence, useAiFeatures, useTasks, useWeek } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon, type IconName } from '../icons';
import { useToast } from '../toast';

/** The pictures, with the names VoiceOver reads for them. */
const PICTURES: Record<TaskInput['picture'], string> = {
  star: 'Star',
  dishes: 'Plates',
  bed: 'Bed',
  bin: 'Bin',
  plant: 'Plant',
  book: 'Book',
  bike: 'Bike',
  lego: 'Building bricks',
  pencil: 'Pencil',
  ball: 'Ball',
  heart: 'Heart',
  tent: 'Tent',
};
const REWARDS: { type: Task['rewardType']; label: string; step: number; start: number; unit: (n: number) => string }[] = [
  { type: 'money', label: 'Pocket money', step: 10, start: 50, unit: pence },
  { type: 'flex', label: 'Flex points', step: 5, start: 20, unit: (n) => `${n} points` },
  { type: 'time', label: 'Screen time', step: 5, start: 15, unit: (n) => minutes(n) },
  { type: 'praise', label: 'Praise only', step: 0, start: 0, unit: () => '' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHIP_ICON = { money: 'coins', flex: 'star', time: 'clock', praise: 'heart' } as const;

function recurrenceLabel(r: Recurrence): string {
  if (r.kind === 'once') return 'Once';
  if (r.kind === 'daily') return 'Every day';
  return [...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(', ');
}

const picture = (p: string): IconName => (p in PICTURES ? (p as IconName) : 'star');
const blank = (): TaskInput => ({ title: '', picture: 'star', rewardType: 'money', amount: 50, recurrence: { kind: 'daily' }, ageBand: null, needsPhoto: false, childId: null });

export function Tasks({ kids, canEdit }: { kids: ChildSummary[]; canEdit: boolean }) {
  const toast = useToast();
  const { data: tasks, error, reload } = useTasks();
  const ai = useAiFeatures().data;
  const [editing, setEditing] = useState<{ id?: string; task: TaskInput; from: HTMLElement | null }>();

  const open = (from: HTMLElement, t?: Task) =>
    setEditing({
      from,
      ...(t ? { id: t.id } : {}),
      task: t
        ? { title: t.title, picture: t.picture as TaskInput['picture'], rewardType: t.rewardType, amount: t.amount, recurrence: t.recurrence, ageBand: t.ageBand as TaskInput['ageBand'], needsPhoto: t.needsPhoto, childId: t.childId }
        : blank(),
    });

  const removed = (id: string, title: string) => {
    void reload();
    toast(`Removed "${title}".`, async () => {
      try {
        await api('POST', `/api/tasks/${id}/restore`);
        toast(`"${title}" is back on the list.`);
      } catch (err) {
        toast((err as Error).message);
      }
      void reload();
    });
  };

  const kidName = (id: string | null) => (id ? kids.find((k) => k.id === id)?.name : undefined);

  return (
    <main className="screen" aria-label="Jobs">
      <div className="large">
        <h1>Jobs</h1>
        <p>Jobs to help at home, and things to praise.{canEdit ? '' : ' Only a parent can change them.'}</p>
      </div>
      <section className="sec" aria-label="The jobs">
        {error && !tasks ? (
          <>
            <p className="empty" role="alert">
              {error}
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => void reload()}>
              Try again
            </button>
          </>
        ) : (
          <div className="group">
            {(tasks ?? []).map((t) => {
              const meta = `${recurrenceLabel(t.recurrence)}${kidName(t.childId) ? `, ${kidName(t.childId)} only` : ''}`;
              const inner = (
                <>
                  <span className="job-pic">
                    <Icon name={picture(t.picture)} />
                  </span>
                  <span className="job-text">
                    <span className="job-title">{t.title}</span>
                    <span className="job-meta" id={`meta-${t.id}`}>
                      {meta}
                    </span>
                  </span>
                  <span className={`chip ${t.rewardType}`}>
                    <Icon name={CHIP_ICON[t.rewardType]} />
                    {t.rewardLabel}
                  </span>
                </>
              );
              return canEdit ? (
                <button key={t.id} type="button" className="job-row" aria-label={`Change ${t.title}, ${t.rewardLabel}`} aria-describedby={`meta-${t.id}`} onClick={(e) => open(e.currentTarget, t)}>
                  {inner}
                  <Icon name="right" className="ic chev" />
                </button>
              ) : (
                <div key={t.id} className="job-row">
                  {inner}
                </div>
              );
            })}
            {tasks && !tasks.length ? <p className="empty">No jobs yet.{canEdit ? ' Add the first one below.' : ''}</p> : null}
            {!tasks ? <p className="empty">Loading.</p> : null}
          </div>
        )}
        {canEdit ? (
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={(e) => open(e.currentTarget)}>
            <Icon name="plus" />
            Add a job
          </button>
        ) : null}
      </section>
      {canEdit && ai?.suggestions ? (
        <JobIdeas
          onPick={(idea, from) =>
            setEditing({ from, task: { ...blank(), title: idea.title, picture: picture(idea.picture) as TaskInput['picture'], rewardType: idea.rewardType, amount: idea.amount } })
          }
        />
      ) : null}
      {editing ? (
        <TaskSheet
          key={editing.id ?? 'new'}
          id={editing.id}
          initial={editing.task}
          from={editing.from}
          kids={kids}
          onClosed={() => setEditing(undefined)}
          onSaved={(t) => {
            toast(editing.id ? `Saved "${t.title}".` : `Added "${t.title}".`);
            void reload();
          }}
          onRemoved={() => removed(editing.id!, editing.task.title)}
        />
      ) : null}
    </main>
  );
}

interface SheetProps {
  id: string | undefined;
  initial: TaskInput;
  from: HTMLElement | null;
  kids: ChildSummary[];
  onClosed: () => void;
  onSaved: (t: TaskInput) => void;
  onRemoved: () => void;
}

function TaskSheet({ id, initial, from, kids, onClosed, onSaved, onRemoved }: SheetProps) {
  const [t, setT] = useState<TaskInput>(initial);
  const sheet = useSheetAction(onClosed);
  const reward = REWARDS.find((r) => r.type === t.rewardType)!;
  const capChild = kids.find((k) => k.id === (t.childId ?? kids[0]?.id));
  const week = useWeek(t.rewardType === 'time' ? capChild?.id : undefined).data;
  const set = (patch: Partial<TaskInput>) => setT((x) => ({ ...x, ...patch }));
  const days = t.recurrence.kind === 'weekly' ? t.recurrence.weekdays : [];
  const title = t.title.trim();

  const save = () =>
    void sheet.run(
      () => api(id ? 'PUT' : 'POST', id ? `/api/tasks/${id}` : '/api/tasks', { ...t, title }),
      () => onSaved({ ...t, title }),
    );
  const remove = () => void sheet.run(() => api('DELETE', `/api/tasks/${id}`), onRemoved);

  return (
    <Sheet
      open={sheet.open}
      onClose={sheet.close}
      title={id ? 'Change the job' : 'Add a job'}
      returnFocus={from}
      error={sheet.error}
      footer={
        id ? (
          <button type="button" className="text-button" disabled={sheet.busy} onClick={remove}>
            Remove this job
          </button>
        ) : null
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <label htmlFor="job-title">What is it?</label>
          <input id="job-title" className="field" value={t.title} maxLength={80} placeholder="For example: Empty the dishwasher" onChange={(e) => set({ title: e.target.value })} />
        </div>

        <div>
          <span className="label" id="pic-label">
            Picture
          </span>
          <div className="choice" role="group" aria-labelledby="pic-label">
            {(Object.keys(PICTURES) as TaskInput['picture'][]).map((p) => (
              <button key={p} type="button" aria-pressed={t.picture === p} aria-label={PICTURES[p]} onClick={() => set({ picture: p })}>
                <Icon name={p} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="label-row">
            <span className="label" id="reward-label">
              What it earns
            </span>
            <HelpButton topic="earning-screen-time" label="Earning screen time from chores" />
          </div>
          <div className="choice" role="group" aria-labelledby="reward-label">
            {REWARDS.map((r) => (
              // Tapping the reward already chosen keeps the amount.
              <button key={r.type} type="button" aria-pressed={t.rewardType === r.type} onClick={() => (t.rewardType === r.type ? undefined : set({ rewardType: r.type, amount: r.start }))}>
                {r.label}
              </button>
            ))}
          </div>
          {t.rewardType === 'time' ? (
            <p className="hint">
              Screen time from jobs is capped at 15% of the weekly allowance
              {week && capChild
                ? t.childId
                  ? `: ${minutes(week.earnedCapMinutes)} a week for ${capChild.name}. Jobs can add ${minutes(Math.max(0, week.earnedCapMinutes - week.earnedMinutes))} more this week`
                  : `: ${minutes(week.earnedCapMinutes)} a week for a ${minutes(week.allowanceMinutes)} allowance`
                : ''}
              . Pocket money or flex points work better for most jobs.
            </p>
          ) : t.rewardType === 'praise' ? (
            <p className="hint">For things they already love doing. When it&apos;s done, you send a few words of praise instead of money, points or time.</p>
          ) : (
            <p className="hint">Paying in pocket money or flex points keeps screen time the agreed plan, not a prize.</p>
          )}
        </div>

        {reward.step ? (
          <div>
            <span className="label" id="amount-label">
              How much
            </span>
            <div className="stepper" role="group" aria-labelledby="amount-label">
              <button type="button" aria-label={`${reward.unit(reward.step)} less`} disabled={t.amount <= reward.step} onClick={() => set({ amount: Math.max(reward.step, t.amount - reward.step) })}>
                <Icon name="minus" />
              </button>
              <output aria-live="polite" className="tnum">
                {reward.unit(t.amount)}
              </output>
              <button type="button" aria-label={`${reward.unit(reward.step)} more`} disabled={t.amount + reward.step > 10_000} onClick={() => set({ amount: Math.min(10_000, t.amount + reward.step) })}>
                <Icon name="plus" />
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <span className="label" id="when-label">
            How often
          </span>
          <div className="choice" role="group" aria-labelledby="when-label">
            <button type="button" aria-pressed={t.recurrence.kind === 'daily'} onClick={() => set({ recurrence: { kind: 'daily' } })}>
              Every day
            </button>
            <button type="button" aria-pressed={t.recurrence.kind === 'weekly'} onClick={() => set({ recurrence: { kind: 'weekly', weekdays: days.length ? days : [6] } })}>
              Some days
            </button>
            <button type="button" aria-pressed={t.recurrence.kind === 'once'} onClick={() => set({ recurrence: { kind: 'once' } })}>
              Once
            </button>
          </div>
          {t.recurrence.kind === 'weekly' ? (
            <div className="choice" role="group" aria-label="Which days" style={{ marginTop: 8 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days.includes(d)}
                  onClick={() => {
                    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
                    if (next.length) set({ recurrence: { kind: 'weekly', weekdays: next } });
                  }}
                >
                  {DAYS[d]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {kids.length > 1 ? (
          <div>
            <span className="label" id="who-label">
              Who for
            </span>
            <div className="choice" role="group" aria-labelledby="who-label">
              <button type="button" aria-pressed={t.childId === null} onClick={() => set({ childId: null })}>
                Everyone
              </button>
              {kids.map((k) => (
                <button key={k.id} type="button" aria-pressed={t.childId === k.id} onClick={() => set({ childId: k.id })}>
                  {k.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* "Ask for a photo" arrives with the kiosk camera in Phase 6. */}

        <button type="submit" className="btn btn-primary" disabled={!title || sheet.busy}>
          {sheet.busy ? 'Saving' : id ? 'Save' : 'Add the job'}
        </button>
      </form>
    </Sheet>
  );
}
