import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

// Transient notifications — stacked in a corner, auto-dismissing.
//
// Lives in its own context so it's reusable anywhere (input handlers,
// async error paths, demo helpers) without taking a session/config
// dependency.
//
// ── Two-context split ──────────────────────────────────────────────
// We expose `useToastState()` and `useToastActions()` separately so
// the dozens of consumers that only push toasts (`flash`) don't get
// re-rendered every time the queue changes. Only the renderer
// (`ToastContainer`) needs the queue itself; everyone else only
// needs stable action references.
//
// ── Timer ownership ────────────────────────────────────────────────
// Every toast owns its own dismissal timeout. Handles are tracked in
// a Map ref and cleared on dismiss, eviction, and provider unmount —
// guaranteeing no stray callbacks fire against unmounted components
// or evicted ids.

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

export interface ToastStateValue {
  toasts: Toast[];
}

export interface ToastActionsValue {
  flash: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
}

const TOAST_DURATION_MS = 3000;
const MAX_VISIBLE_TOASTS = 5;

const ToastStateContext = createContext<ToastStateValue | null>(null);
const ToastActionsContext = createContext<ToastActionsValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic id counter — unique for the provider's lifetime.
  // Combined with timer cleanup below there's no risk of stale
  // setTimeout callbacks dismissing the wrong toast, so we don't need
  // to mix in Date.now() like an earlier draft did.
  const nextIdRef = useRef(0);
  // Active dismissal timers, keyed by toast id. Cleared on dismiss,
  // eviction (when the 5-cap drops the oldest), and provider unmount.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Cleanup all pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const clearTimer = useCallback((id: string) => {
    const handle = timersRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer]
  );

  const flash = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = String(nextIdRef.current++);
      setToasts((prev) => {
        const next = [...prev, { id, message, variant }];
        if (next.length <= MAX_VISIBLE_TOASTS) return next;
        // Overflow — clear timers for the toasts being evicted so they
        // don't later fire dismiss against ids that no longer exist.
        const overflowCount = next.length - MAX_VISIBLE_TOASTS;
        for (let i = 0; i < overflowCount; i++) {
          clearTimer(next[i]!.id);
        }
        return next.slice(overflowCount);
      });
      const handle = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timersRef.current.set(id, handle);
    },
    [clearTimer, dismiss]
  );

  // State context: changes when the queue changes. ToastContainer is
  // the only intended consumer.
  const stateValue = useMemo<ToastStateValue>(() => ({ toasts }), [toasts]);

  // Actions context: object reference is stable across queue updates
  // (flash/dismiss are themselves stable callbacks). Consumers won't
  // re-render on toast add/remove.
  const actionsValue = useMemo<ToastActionsValue>(
    () => ({ flash, dismiss }),
    [flash, dismiss]
  );

  return (
    <ToastStateContext.Provider value={stateValue}>
      <ToastActionsContext.Provider value={actionsValue}>
        {children}
      </ToastActionsContext.Provider>
    </ToastStateContext.Provider>
  );
}

/**
 * Read the toast queue. Use only in components that render toasts
 * (typically just `ToastContainer`). Re-renders on every add/remove.
 */
export function useToastState(): ToastStateValue {
  const ctx = useContext(ToastStateContext);
  if (!ctx)
    throw new Error('useToastState must be used within a ToastProvider');
  return ctx;
}

/**
 * Read the toast actions (`flash`, `dismiss`). Stable across queue
 * updates — pushing a toast won't re-render the caller. Use this from
 * input handlers, async paths, anywhere you need to flash but don't
 * need to render the queue.
 */
export function useToastActions(): ToastActionsValue {
  const ctx = useContext(ToastActionsContext);
  if (!ctx)
    throw new Error('useToastActions must be used within a ToastProvider');
  return ctx;
}
