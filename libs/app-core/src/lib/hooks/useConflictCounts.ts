import { useEffect, useState } from 'react';
import { computeConflictCounts } from '../sync/remote-sync.js';

/**
 * Batch conflict checking for all branches at once — TUI state shell
 * around the shared {@link computeConflictCounts}.
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
      const results = await computeConflictCounts(branches);
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
