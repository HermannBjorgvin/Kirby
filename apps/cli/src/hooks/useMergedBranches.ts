import { useEffect, useRef, useState } from 'react';
import { canRemoveBranch, branchToSessionName } from '@kirby/worktree-manager';
import { logError } from '@kirby/logger';
import { useConfig } from '../context/ConfigContext.js';

export function useMergedBranches(
  branches: string[],
  lastSynced: number,
  onAutoDelete: (sessionName: string, branch: string) => void
) {
  const { config, provider, vcsConfigured } = useConfig();
  const { vendorAuth, vendorProject, autoDeleteOnMerge } = config;
  const [mergedBranches, setMergedBranches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const onAutoDeleteRef = useRef(onAutoDelete);
  // eslint-disable-next-line react-hooks/refs -- keep callback ref in sync without re-running the effect
  onAutoDeleteRef.current = onAutoDelete;

  useEffect(() => {
    const fetchMerged = provider?.fetchMergedBranches;
    if (!lastSynced || !fetchMerged || !vcsConfigured || branches.length === 0)
      return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      let merged: Set<string>;
      try {
        merged = await fetchMerged(vendorAuth, vendorProject, branches);
      } catch (err: unknown) {
        logError('fetchMergedBranches', err);
        merged = new Set<string>();
      }

      if (cancelled) return;
      setMergedBranches(merged);
      setLoading(false);

      // Auto-delete merged branches
      if (autoDeleteOnMerge) {
        for (const branch of merged) {
          const check = await canRemoveBranch(branch, true);
          if (cancelled) return;
          if (check.safe) {
            onAutoDeleteRef.current(branchToSessionName(branch), branch);
          } else {
            logError(
              'useMergedBranches',
              `Skipping auto-delete of ${branch}: ${check.reason}`
            );
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    lastSynced,
    provider,
    vcsConfigured,
    vendorAuth,
    vendorProject,
    autoDeleteOnMerge,
    branches,
  ]);

  return { mergedBranches, loading };
}
