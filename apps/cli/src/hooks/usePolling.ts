import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  value: T | undefined;
  error: Error | null;
  loading: boolean;
  /** Fire the fetch immediately, outside the interval. */
  refresh: () => Promise<void>;
}

// Small ~30-line polling primitive. Picked over TanStack Query because:
// - TanStack Query adds ~18KB gzipped for what 4 hooks need to do.
// - Its cache+retry machinery is irrelevant in a single-user CLI.
// - Its React dev warnings under Ink are an unknown we don't need to
//   find out about in production.
// See Step 23 of the React refactor plan for the full trade-off.
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  enabled = true
): PollingState<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const v = await fnRef.current();
      if (mountedRef.current) {
        setValue(v);
        setError(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError(err as Error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }
    void refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, refresh]);

  return { value, error, loading, refresh };
}
