// Bedtime (brief Part 11): a calm screen with the time and a good-night line. In Fully Kiosk the
// screen goes off after two minutes, and moving in front of it wakes it.
import type { KioskHome } from '@family-time/schemas';
import { useEffect } from 'preact/hooks';
import { kioskBridge } from '../bridge';
import { Icon } from '../icons';

const OFF_AFTER_MS = 2 * 60_000;

export function Night({ home }: { home: KioskHome }) {
  useEffect(() => kioskBridge.screenOffAfter(OFF_AFTER_MS), []);
  const time = home.clock.replace(/^\S+ /, '');
  return (
    <main class="night" aria-label="Bedtime">
      <Icon name="moon" class="ic moon" />
      <h1 class="sr">Bedtime</h1>
      <p class="night-time">{time}</p>
      <p class="night-line">{home.nightLine}</p>
    </main>
  );
}
