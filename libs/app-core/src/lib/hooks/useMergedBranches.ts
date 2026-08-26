import { useEffect, useRef, useState } from 'react';
import { useConfig } from '../context/ConfigContext.js';
import { sweepMergedBranches } from '../sync/remote-sync.js';

// Re-exported from its original home so existing importers keep working;
// the logic lives in the shared sync module now.
export { diffRebaseWarnings } from '../sync/remote-sync.js';

/** TUI state shell around the shared {@link sweepMergedBranches}. */
export function useMergedBranches(
  branches: string[],
  lastSynced: number,
  onAutoDelete: (sessionName: string, branch: string) => void,
  onRebaseInProgress: (branch: string) => void
) {
  const { config, provider, vcsConfigured } = useConfig();
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
      const { merged, nextWarned } = await sweepMergedBranches({
        provider,
        vcsConfigured,
        config,
        branches,
        warnedRebase: warnedRebaseRef.current,
        onAutoDelete: (sessionName, branch) =>
          onAutoDeleteRef.current(sessionName, branch),
        onRebaseInProgress: (branch) => onRebaseInProgressRef.current(branch),
        isCancelled: () => cancelled,
      });
      if (cancelled) return;
      warnedRebaseRef.current = nextWarned;
      setMergedBranches(merged);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [lastSynced, provider, vcsConfigured, config, branches]);

  return { mergedBranches, loading };
}
