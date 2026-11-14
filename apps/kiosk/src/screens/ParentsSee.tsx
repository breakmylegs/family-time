// What Mum and Dad can see (brief Part 11), in plain words. It must stay true: change it whenever
// what the parents' app shows changes.
import type { KioskHome } from '@family-time/schemas';
import { Icon } from '../icons';

export function ParentsSee({ home, onDone }: { home: KioskHome; onDone: () => void }) {
  return (
    <main class="page" aria-label="What Mum and Dad can see">
      <header class="page-top">
        <button type="button" class="back" onClick={onDone}>
          <Icon name="left" />
          Back
        </button>
        <h1>What Mum and Dad can see</h1>
      </header>
      <div class="see">
        <section class="card">
          <h2>They can see</h2>
          <ul>
            <li>Which apps and games are on or off for you, and when.</li>
            {home.features.economy ? <li>The time you plan, and how much you have left to plan this week.</li> : null}
            {home.features.economy ? <li>The jobs you say you did, and any photo you take of one.</li> : null}
            {home.features.economy ? <li>When you ask a grown-up: what you asked for, and when.</li> : null}
            <li>Roughly how long each app was used today. The home Wi-Fi notices when an app is busy, so it's a guess, not exact.</li>
            {home.features.goal ? <li>Your savings goal, and your answers to How was your week?</li> : null}
            <li>What you add under Me: things you did, things you're learning, and your questions about rules.</li>
            <li>Once a month, how Mum and Dad think your month has been, to help plan together.</li>
          </ul>
        </section>
        <section class="card">
          <h2>They can't see</h2>
          <ul>
            <li>What you watch, write or say in an app or game.</li>
            <li>Your messages, or who you talk to.</li>
            <li>Your screen.</li>
          </ul>
        </section>
        <p class="caption">Other grown-ups who look after you, like a grandparent, can see your jobs and any photos too, and the things you did and can do. Only Mum and Dad see your questions about rules. If something here doesn't seem right, talk to Mum or Dad about it.</p>
      </div>
    </main>
  );
}
