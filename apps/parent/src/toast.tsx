// One toast at a time, with an optional Undo. It stays for 10 seconds, the window for Undo, and
// waits while a finger or VoiceOver is on it. Once hidden it is inert: nothing can press a stale Undo.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const SHOW_MS = 10_000;

interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
}

const ToastContext = createContext<(message: string, undo?: () => void) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>();
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((message: string, undo?: () => void) => {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, message, ...(undo ? { undo } : {}) }));
    setShown(true);
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!shown || held) return;
    timer.current = setTimeout(() => setShown(false), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [shown, held, toast?.id]);

  // After the fade, forget the Undo, so it can never run late.
  useEffect(() => {
    if (shown) return;
    const t = setTimeout(() => setToast((x) => (x ? { id: x.id, message: x.message } : x)), 300);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Spoken once, from a region that is always there. */}
      <p className="sr" role="status" aria-live="polite">
        {shown ? toast?.message : ''}
      </p>
      <div
        className="toast"
        data-show={String(shown)}
        inert={!shown}
        aria-hidden={!shown}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <span aria-hidden="true">{toast?.message}</span>
        {toast?.undo ? (
          <button
            type="button"
            onClick={() => {
              const undo = toast.undo;
              setShown(false);
              setHeld(false);
              setToast({ id: toast.id, message: toast.message });
              undo?.();
            }}
          >
            Undo
          </button>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
