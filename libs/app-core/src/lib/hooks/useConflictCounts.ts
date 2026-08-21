import { useEffect, useState } from 'react';
import { countConflicts } from '@kirby/worktree-manager';

/**
 * Batch conflict checking for all branches at once.
 * Returns a Map<branch, conflictCount> and a loading flag.
 */
export function useConflictCounts(branches: string[], lastSynced: number) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lastSynced || branches.length === 0) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state must sync with the async fetch lifecycle
    setLoading(true);

    (async () => {
      const results = new Map<string, number>();
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
      if (cancelled) return;
      setCounts(results);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [branches, lastSynced]);

  return { counts, loading };
}
