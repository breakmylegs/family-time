// Live updates: the server says "change" over Server-Sent Events and the screen fetches again. When
// the stream is down, a 30-second poll takes over. Coming back to the app (iOS suspends a Home
// Screen app in the background) always fetches straight away.
import { useEffect, useRef } from 'react';

const POLL_MS = 30_000;

export function useLive(onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let source: EventSource | undefined;
    let open = false;
    let connectedBefore = false;
    const fire = () => latest.current();

    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/events');
      source.addEventListener('ready', () => {
        // A reconnect after a gap: fetch what may have been missed. The first connect needs none.
        if (connectedBefore) fire();
        connectedBefore = true;
        open = true;
      });
      source.addEventListener('change', fire);
      source.onerror = () => {
        open = false;
      };
    }
    const poll = setInterval(() => {
      if (!open && document.visibilityState === 'visible') fire();
    }, POLL_MS);
    const visible = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      source?.close();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
}
