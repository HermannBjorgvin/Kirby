import { useEffect, useRef, useState } from 'react';
import { useConfig } from '../context/ConfigContext.js';
import { sweepMergedBranches } from '@kirby/core';

/** TUI state shell around the shared {@link sweepMergedBranches}. */
export function useMergedBranches(
  branches: string[],
  lastSynced: number,
  onAutoDelete: (sessionName: string, branch: string) => void,
  onRebaseInProgress: (branch: string) => void
) {
  const { config, provider, vcsConfigured } = useConfig();
  // Depend on the three fields the sweep uses, not the whole config
  // object — otherwise every unrelated settings edit re-runs the
  // merged fetch + auto-delete pass.
  const { vendorAuth, vendorProject, autoDeleteOnMerge, terminalBackend } =
    config;
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
    if (
      !lastSynced ||
      !provider?.fetchMergedBranches ||
      !vcsConfigured ||
      branches.length === 0
    )
      return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { nextWarned } = await sweepMergedBranches({
        provider,
        vcsConfigured,
        config: {
          vendorAuth,
          vendorProject,
          autoDeleteOnMerge,
          terminalBackend,
        },
        branches,
        warnedRebase: warnedRebaseRef.current,
        // Badges appear as soon as the merged set is known, without
        // waiting for the (git-heavy) auto-delete pass.
        onMerged: (merged) => {
          if (cancelled) return;
          setMergedBranches(merged);
          setLoading(false);
        },
        onAutoDelete: (sessionName, branch) =>
          onAutoDeleteRef.current(sessionName, branch),
        onRebaseInProgress: (branch) => onRebaseInProgressRef.current(branch),
        isCancelled: () => cancelled,
      });
      if (cancelled) return;
      warnedRebaseRef.current = nextWarned;
      setLoading(false);
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
    terminalBackend,
    branches,
  ]);

  return { mergedBranches, loading };
}
