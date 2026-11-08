// The kiosk (brief Part 11): pair once, pick who is here when there are several children, then
// the child's home. Fresh every 15 seconds and whenever the screen comes back on.
import type { KioskHome, KioskMe } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, ApiError, stored } from './api';
import { kioskBridge } from './bridge';
import { Home } from './screens/Home';
import { Night } from './screens/Night';
import { Pair } from './screens/Pair';
import { PinEntry } from './screens/PinEntry';
import { ParentsSee } from './screens/ParentsSee';
import { Plan } from './screens/Plan';
import { Reflection } from './screens/Reflection';
import { Icon } from './icons';

export type Screen = { name: 'home' } | { name: 'plan'; ask?: boolean } | { name: 'reflection' } | { name: 'parents' };

const POLL_MS = 15_000;

export function App() {
  const [paired, setPaired] = useState(Boolean(stored.token()));
  const [me, setMe] = useState<KioskMe>();
  const [childId, setChildId] = useState<string | null>(stored.child());
  const [home, setHome] = useState<KioskHome>();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [problem, setProblem] = useState<string>();
  /** A child picked who has a PIN, waiting for it to be typed. */
  const [locked, setLocked] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!stored.token()) return setPaired(false);
    try {
      const who = await api<KioskMe>('GET', '/me');
      setMe(who);
      // The one child, or the one chosen before, if they are still in the family.
      const pick = who.children.length === 1 ? who.children[0]!.id : who.children.some((c) => c.id === stored.child()) ? stored.child() : null;
      // A child with a PIN needs it typed on this tablet first.
      const kid = who.children.find((c) => c.id === pick);
      if (kid?.pin && !stored.ticket(kid.id)) {
        setLocked({ id: kid.id, name: kid.name });
        setChildId(null);
        setHome(undefined);
        return;
      }
      setChildId(pick);
      if (pick) setHome(await api<KioskHome>('GET', `/children/${pick}/home`));
      setProblem(undefined);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPaired(false);
      else if (err instanceof ApiError && err.status === 423) {
        setHome(undefined);
        setChildId(null);
        void load();
      }
      else setProblem((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!paired) return;
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    kioskBridge.setUp(() => location.reload());
    // A tablet put down locks again: the screen going off, or five minutes untouched, forgets the
    // child's unlock, so a brother or sister picking it up needs their own numbers.
    const forget = () => {
      const c = stored.child();
      if (c && stored.ticket(c)) {
        stored.setTicket(c, null);
        setHome(undefined);
        setChildId(null);
      }
    };
    let idle = setTimeout(forget, 5 * 60_000);
    const touched = () => {
      clearTimeout(idle);
      idle = setTimeout(forget, 5 * 60_000);
    };
    addEventListener('pointerdown', touched);
    addEventListener('keydown', touched);
    const visible = () => (document.visibilityState === 'visible' ? void load() : forget());
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(t);
      clearTimeout(idle);
      removeEventListener('pointerdown', touched);
      removeEventListener('keydown', touched);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [paired, load]);

  if (!paired) return <Pair onPaired={() => setPaired(true)} />;

  if (locked) {
    return (
      <PinEntry
        child={locked}
        onUnlocked={() => {
          stored.setChild(locked.id);
          setLocked(null);
          void load();
        }}
        onBack={() => {
          stored.setChild(null);
          setLocked(null);
          setChildId(null);
          void load();
        }}
      />
    );
  }

  if (me && !childId) {
    return (
      <main class="pick" aria-label="Who is here?">
        <h1>Who's here?</h1>
        <div class="pick-row">
          {me.children.map((c) => (
            <button
              key={c.id}
              type="button"
              class="pick-btn"
              onClick={() => {
                stored.setChild(c.id);
                setChildId(c.id);
                void load();
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (!home) {
    return (
      <main class="loading" aria-live="polite">
        <h1 class="sr">Family time</h1>
        <p>{problem ?? 'Hello! Getting things ready.'}</p>
        {problem ? (
          <button type="button" class="btn" onClick={() => void load()}>
            Try again
          </button>
        ) : null}
      </main>
    );
  }

  const back = () => {
    setScreen({ name: 'home' });
    void load();
  };
  // Switching child forgets this child's unlock, so a brother or sister needs their own PIN.
  const switchChild = me && me.children.length > 1 ? () => (childId && stored.setTicket(childId, null), stored.setChild(null), setChildId(null), setHome(undefined)) : undefined;

  if (home.night && screen.name === 'home') return <Night home={home} />;
  return (
    <>
      {problem ? (
        <p class="offline" role="status">
          <Icon name="clock" />
          {problem}
        </p>
      ) : null}
      {screen.name === 'plan' ? <Plan home={home} ask={Boolean(screen.ask)} onDone={back} /> : null}
      {screen.name === 'reflection' ? <Reflection home={home} onDone={back} /> : null}
      {screen.name === 'parents' ? <ParentsSee home={home} onDone={back} /> : null}
      {screen.name === 'home' ? <Home home={home} go={setScreen} reload={load} {...(switchChild ? { switchChild } : {})} /> : null}
    </>
  );
}
