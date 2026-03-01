import { useState, useEffect, useRef } from 'react';
import { countConflicts } from '@kirby/tmux-manager';

export function useConflictCount(branch: string, lastSynced: number) {
  const [count, setCount] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!lastSynced || !branch) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const c = await countConflicts(branch);
        if (!cancelled && mountedRef.current) {
          setCount(c);
        }
      } catch {
        // ignore errors
      } finally {
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [branch, lastSynced]);

  return { count, loading };
}
