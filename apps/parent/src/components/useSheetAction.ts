// What a sheet's main button does: one request at a time (a second tap does nothing while the
// first is saving), the error kept inside the sheet if it fails, and on success the sheet slides
// out first and the toast comes after, so nothing is ever said behind the dimmed page.
import { useCallback, useRef, useState } from 'react';

/** The sheets' exit, from app.css. The sheet unmounts after it. */
const EXIT_MS = 240;

export function useSheetAction(onClosed: () => void) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const running = useRef(false);

  const close = useCallback(
    (after?: () => void) => {
      setOpen(false);
      setTimeout(() => {
        onClosed();
        after?.();
      }, EXIT_MS);
    },
    [onClosed],
  );

  /** Runs `fn`; on success closes the sheet, then calls `done` (the toast). */
  const run = useCallback(
    async (fn: () => Promise<unknown>, done?: () => void) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError(undefined);
      try {
        await fn();
        close(done);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [close],
  );

  return { open, busy, error, run, close: () => close() };
}
