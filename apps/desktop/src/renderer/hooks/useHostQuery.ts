import { useCallback, useEffect, useState } from 'react';

interface HostQueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Minimal async data hook over the host bridge: runs `fn` whenever
 * `deps` change, exposes data/loading/error, and offers manual
 * `reload()` for refresh actions.
 */
export function useHostQuery<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[]
): HostQueryState<T> & { reload: () => void } {
  const [state, setState] = useState<HostQueryState<T>>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fn()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls refetch via deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { ...state, reload };
}
