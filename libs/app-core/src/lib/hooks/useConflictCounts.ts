import { useEffect, useEffectEvent, useState } from 'react';
import type { BranchPrMap } from '@kirby/vcs-core';
import { computeConflictCounts } from '@kirby/core';

/**
 * Batch conflict checking for all branches at once — TUI state shell
 * around the shared {@link computeConflictCounts}. A branch with a
 * pull request in `prMap` is judged against that request's target on
 * the remote refs, like the babysitter judges it.
 * Returns a Map<branch, conflictCount> and a loading flag.
 */
export function useConflictCounts(
  branches: string[],
  lastSynced: number,
  prMap: BranchPrMap
) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  // Read when the pass runs, not a dependency of it: the list is
  // re-fetched every minute and a fresh identity would re-run a
  // merge-tree per branch each time, where the pass is meant to
  // follow the hourly sync. A pull request opened between two syncs
  // is judged locally until the next one, as it is in the desktop.
  const currentPrMap = useEffectEvent(() => prMap);

  useEffect(() => {
    if (!lastSynced || branches.length === 0) return;

    let cancelled = false;

    (async () => {
      // Inside the async body: a synchronous setState in an effect
      // re-renders before the effect has done anything, and the work
      // this flags is about to start on the next line.
      setLoading(true);
      const results = await computeConflictCounts(branches, currentPrMap());
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
