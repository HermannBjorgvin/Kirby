import { useState, useEffect, useRef } from 'react';
import { countConflicts } from '@kirby/tmux-manager';

/**
 * Batch conflict checking for all branches at once.
 * Returns a Map<branch, conflictCount> and a loading flag.
 */
export function useConflictCounts(branches: string[], lastSynced: number) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!lastSynced || branches.length === 0) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      const results = new Map<string, number>();
      // Run all conflict checks concurrently
      const entries = await Promise.all(
        branches.map(async (branch) => {
          try {
            const c = await countConflicts(branch);
            return [branch, c] as const;
          } catch {
            return [branch, 0] as const;
          }
        })
      );
      for (const [branch, count] of entries) {
        results.set(branch, count);
      }
      if (!cancelled && mountedRef.current) {
        setCounts(results);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [branches, lastSynced]);

  return { counts, loading };
}
