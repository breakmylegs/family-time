// kioskBridge (brief Part 11): Fully Kiosk Browser's JavaScript interface, wrapped. In Fully it
// turns the screen off at bedtime, lets motion wake it, and reloads the page when the screen
// comes back on. In any other browser every call does nothing.

interface Fully {
  turnScreenOn(): void;
  turnScreenOff(keepAlive?: boolean): void;
  getScreenOn(): boolean;
  setBooleanSetting(key: string, value: boolean): void;
  bind(event: string, code: string): void;
}

declare global {
  interface Window {
    fully?: Fully;
    __ftScreenOn?: () => void;
  }
}

const fully = (): Fully | null => (typeof window !== 'undefined' && window.fully ? window.fully : null);

export const kioskBridge = {
  /** True inside Fully Kiosk. */
  present: (): boolean => fully() !== null,

  /** Set once at start: motion wakes the screen, and screen-on reloads the page. */
  setUp(onScreenOn: () => void): void {
    const f = fully();
    if (!f) return;
    try {
      f.setBooleanSetting('motionDetection', true);
      f.setBooleanSetting('screenOnOnMotion', true);
      window.__ftScreenOn = onScreenOn;
      f.bind('screenOn', 'window.__ftScreenOn && window.__ftScreenOn()');
    } catch {
      // An older Fully without these: the kiosk still works, the screen just stays on.
    }
  },

  /** Bedtime: the screen goes off after `afterMs`, unless something wakes it first. */
  screenOffAfter(afterMs: number): () => void {
    const f = fully();
    if (!f) return () => undefined;
    const t = setTimeout(() => {
      try {
        f.turnScreenOff(true);
      } catch {
        // Nothing to do: the screen stays on.
      }
    }, afterMs);
    return () => clearTimeout(t);
  },
};
