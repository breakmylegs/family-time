// Plan my time, and Ask a grown-up (brief Part 11): choose what to play, 30 or 60 minutes, and a
// time. Times that won't fit have a dashed edge and say so to a screen reader, and tapping one says why. Asking sends any time to a
// grown-up instead, for them to say yes or not this time.
import type { KioskHome, KioskSlots, KioskTargets } from '@family-time/schemas';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Icon } from '../icons';

type Target = KioskTargets[number];

export function Plan({ home, ask, onDone }: { home: KioskHome; ask: boolean; onDone: () => void }) {
  const base = `/children/${home.child.id}`;
  const [targets, setTargets] = useState<KioskTargets>();
  const [target, setTarget] = useState<Target>();
  const [mins, setMins] = useState<30 | 60>(30);
  const [slots, setSlots] = useState<KioskSlots>();
  const [chosen, setChosen] = useState<KioskSlots['slots'][number]>();
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<KioskTargets>('GET', `${base}/targets`).then(setTargets, (err: Error) => setError(err.message));
  }, [base]);

  useEffect(() => {
    if (!target) return;
    setSlots(undefined);
    setChosen(undefined);
    setWhy(null);
    api<KioskSlots>('GET', `${base}/slots?kind=${target.kind}&id=${target.id}&minutes=${mins}`).then(setSlots, (err: Error) => setError(err.message));
  }, [base, target, mins]);

  const send = async (asking: boolean) => {
    if (!target || !chosen) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('POST', `${base}/${asking ? 'ask' : 'plan'}`, { target: { kind: target.kind, id: target.id }, start: chosen.start, minutes: mins });
      setDone(asking ? `Asked! A grown-up will say yes or not this time.` : `Planned: ${target.name}, ${chosen.label === 'Now' ? 'starting now' : `at ${chosen.label}`}.`);
      setTimeout(onDone, 1800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Asking a grown-up can pick any time; planning only one that fits.
  const canPlan = Boolean(chosen?.ok) && !ask;
  const asking = ask || Boolean(chosen && chosen.askOnly);

  return (
    <main class="page" aria-label={ask ? 'Ask a grown-up' : 'Plan my time'}>
      <header class="page-top">
        <button type="button" class="back" onClick={onDone}>
          <Icon name="left" />
          Back
        </button>
        <h1>{ask ? 'Ask a grown-up' : 'Plan my time'}</h1>
        {home.week && !ask ? <p class="left">{home.week.headline}</p> : null}
      </header>

      {done ? (
        <p class="sent big" role="status">
          <Icon name="check" />
          {done}
        </p>
      ) : (
        <div class="plan">
          <section aria-labelledby="what">
            <h2 id="what">What would you like?</h2>
            <div class="tiles">
              {(targets ?? []).map((t) => (
                <button key={t.id} type="button" class="tile" aria-pressed={target?.id === t.id} onClick={() => setTarget(t)}>
                  <Icon name={t.icon ?? (t.kind === 'group' ? 'pad' : 'apps')} />
                  {t.name}
                </button>
              ))}
            </div>
          </section>

          {target ? (
            <section aria-labelledby="how-long">
              <h2 id="how-long">How long?</h2>
              <div class="seg" role="group" aria-labelledby="how-long">
                {([30, 60] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mins === m} onClick={() => setMins(m)}>
                    {m} minutes
                  </button>
                ))}
              </div>
              {slots && !ask ? <p class="caption">{slots.cost}</p> : null}
            </section>
          ) : null}

          {slots ? (
            <section aria-labelledby="when">
              <h2 id="when">When?</h2>
              <div class="slots">
                {slots.slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    class={`slot${s.ok || ask ? '' : ' grey'}`}
                    aria-pressed={chosen?.start === s.start}
                    aria-label={s.ok || ask ? s.label : `${s.label}, won't fit`}
                    onClick={() => {
                      setChosen(s);
                      setWhy(s.ok || ask ? null : s.reason);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {why ? (
                <p class="why" role="status">
                  {why}
                </p>
              ) : null}
            </section>
          ) : null}

          {error ? (
            <p class="error" role="alert">
              {error}
            </p>
          ) : null}

          <div class="actions">
            {canPlan ? (
              <button type="button" class="btn primary big" disabled={busy} onClick={() => void send(false)}>
                <Icon name="check" />
                {busy ? 'Planning' : 'Plan it'}
              </button>
            ) : null}
            {chosen && asking ? (
              <button type="button" class="btn primary big" disabled={busy} onClick={() => void send(true)}>
                <Icon name="hand" />
                {busy ? 'Asking' : 'Ask a grown-up'}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
