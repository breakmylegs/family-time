// One toast at a time, with an optional Undo. It stays for 10 seconds, the window for Undo.
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
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((message: string, undo?: () => void) => {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, message, ...(undo ? { undo } : {}) }));
    setShown(true);
  }, []);

  useEffect(() => {
    if (!shown) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [shown, toast?.id]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast" data-show={String(shown)} role="status" aria-live="polite">
        <span>{toast?.message}</span>
        {toast?.undo ? (
          <button
            type="button"
            tabIndex={shown ? 0 : -1}
            onClick={() => {
              setShown(false);
              toast.undo?.();
            }}
          >
            Undo
          </button>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
