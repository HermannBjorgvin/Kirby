import { useState, useEffect, useRef } from 'react';
import { canRemoveBranch, branchToSessionName } from '@kirby/worktree-manager';
import { useConfig } from '../context/ConfigContext.js';
import { logError } from '../log.js';

export function useMergedBranches(
  branches: string[],
  lastSynced: number,
  onAutoDelete: (sessionName: string, branch: string) => void
) {
  const { config, provider, vcsConfigured } = useConfig();
  const { vendorAuth, vendorProject, autoDeleteOnMerge } = config;
  const [mergedBranches, setMergedBranches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const onAutoDeleteRef = useRef(onAutoDelete);
  onAutoDeleteRef.current = onAutoDelete;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

      if (cancelled || !mountedRef.current) return;
      setMergedBranches(merged);
      setLoading(false);

      // Auto-delete merged branches
      if (autoDeleteOnMerge) {
        for (const branch of merged) {
          const check = await canRemoveBranch(branch);
          if (cancelled || !mountedRef.current) return;
          if (check.safe) {
            onAutoDeleteRef.current(branchToSessionName(branch), branch);
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
