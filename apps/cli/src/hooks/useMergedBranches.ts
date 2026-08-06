import { useEffect, useRef, useState } from 'react';
import { canRemoveBranch, branchToSessionName } from '@kirby/worktree-manager';
import { logError } from '@kirby/logger';
import { useConfig } from '../context/ConfigContext.js';

/**
 * Decide which mid-rebase branches to warn about this sync without
 * re-warning ones already flagged. Given the branches currently blocked
 * from auto-delete by an in-progress rebase and the set warned on the
 * previous sync, return the branches to warn about now plus the set to
 * carry forward. A branch drops out of the carried set once it stops
 * rebasing, so a later rebase of the same branch warns again instead of
 * staying silent.
 */
export function diffRebaseWarnings(
  rebasingNow: readonly string[],
  alreadyWarned: ReadonlySet<string>
): { toWarn: string[]; nextWarned: Set<string> } {
  return {
    toWarn: rebasingNow.filter((branch) => !alreadyWarned.has(branch)),
    nextWarned: new Set(rebasingNow),
  };
}

export function useMergedBranches(
  branches: string[],
  lastSynced: number,
  onAutoDelete: (sessionName: string, branch: string) => void,
  onRebaseInProgress: (branch: string) => void
) {
  const { config, provider, vcsConfigured } = useConfig();
  const { vendorAuth, vendorProject, autoDeleteOnMerge } = config;
  const [mergedBranches, setMergedBranches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const onAutoDeleteRef = useRef(onAutoDelete);
  // eslint-disable-next-line react-hooks/refs -- keep callback ref in sync without re-running the effect
  onAutoDeleteRef.current = onAutoDelete;
  const onRebaseInProgressRef = useRef(onRebaseInProgress);
  // eslint-disable-next-line react-hooks/refs -- keep callback ref in sync without re-running the effect
  onRebaseInProgressRef.current = onRebaseInProgress;
  // Branches we've already toasted a rebase-in-progress warning for, so a
  // worktree stuck mid-rebase across many syncs isn't re-toasted each time.
  const warnedRebaseRef = useRef<Set<string>>(new Set());

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
        const rebasingNow: string[] = [];
        for (const branch of merged) {
          const check = await canRemoveBranch(branch, true);
          if (cancelled) return;
          if (check.safe) {
            onAutoDeleteRef.current(branchToSessionName(branch), branch);
          } else {
            if (check.reason === 'rebase in progress') rebasingNow.push(branch);
            logError(
              'useMergedBranches',
              `Skipping auto-delete of ${branch}: ${check.reason}`
            );
          }
        }

        // Toast each newly-blocked rebase once (not every sync).
        const { toWarn, nextWarned } = diffRebaseWarnings(
          rebasingNow,
          warnedRebaseRef.current
        );
        warnedRebaseRef.current = nextWarned;
        for (const branch of toWarn) onRebaseInProgressRef.current(branch);
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
