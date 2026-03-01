import { useState, useEffect, useRef } from 'react';
import type { AppConfig, VcsProvider } from '@kirby/vcs-core';
import { isVcsConfigured } from '@kirby/vcs-core';
import { canRemoveBranch, branchToSessionName } from '@kirby/tmux-manager';
import { logError } from '../log.js';

export function useMergedBranches(
  provider: VcsProvider | null,
  config: AppConfig,
  branches: string[],
  lastSynced: number,
  onAutoDelete: (sessionName: string, branch: string) => void
) {
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
    if (
      !lastSynced ||
      !fetchMerged ||
      !provider ||
      !isVcsConfigured(config, provider) ||
      branches.length === 0
    )
      return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      let merged: Set<string>;
      try {
        merged = await fetchMerged(
          config.vendorAuth,
          config.vendorProject,
          branches
        );
      } catch (err: unknown) {
        logError('fetchMergedBranches', err);
        merged = new Set<string>();
      }

      if (cancelled || !mountedRef.current) return;
      setMergedBranches(merged);
      setLoading(false);

      // Auto-delete merged branches
      if (config.autoDeleteOnMerge) {
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
  }, [lastSynced, provider, config, branches]);

  return { mergedBranches, loading };
}
