import {
  branchToSessionName,
  canRemoveBranch,
  countConflicts,
  fastForwardMainBranch,
  fetchRemote,
} from '@kirby/worktree-manager';
import { logError } from '@kirby/logger';
import type { AppConfig, VcsProvider } from '@kirby/vcs-core';

// ── Remote sync core ─────────────────────────────────────────────
//
// The shell-agnostic heart of the remote sync loop: fetch + fast-
// forward, the merged-branch sweep (with auto-delete-on-merge), and
// batch conflict counting. The TUI drives these from its hooks
// (useRemoteSync / useMergedBranches / useConflictCounts); the desktop
// host drives them from a timer. Behavior lives here exactly once —
// the shells only own scheduling and how results are displayed.

export const REMOTE_SYNC_DEFAULT_MS = 3_600_000; // 1 hour
export const REMOTE_SYNC_MIN_MS = 300_000; // 5 minutes

export function remoteSyncIntervalMs(
  mergePollInterval: number | undefined
): number {
  return Math.max(
    REMOTE_SYNC_MIN_MS,
    mergePollInterval ?? REMOTE_SYNC_DEFAULT_MS
  );
}

/** One sync pass: fetch all remotes (pruning) and fast-forward the
 *  main branch. Never throws; returns the completion timestamp. */
export async function syncRemote(): Promise<number> {
  try {
    await fetchRemote();
    await fastForwardMainBranch();
  } catch (err: unknown) {
    logError('remote-sync', err);
  }
  return Date.now();
}

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

export interface MergedSweepResult {
  /** Branches (of those given) whose PRs have been merged. */
  merged: Set<string>;
  /** Carry this into the next sweep's `warnedRebase`. */
  nextWarned: Set<string>;
}

/**
 * Fetch which of `branches` have merged PRs and, when
 * `config.autoDeleteOnMerge` is on, auto-delete the ones that are safe
 * to remove (`canRemoveBranch(branch, true)`), warning once per rebase
 * episode about branches blocked by an in-progress rebase.
 */
export async function sweepMergedBranches(opts: {
  provider: VcsProvider | null;
  vcsConfigured: boolean;
  config: AppConfig;
  branches: string[];
  /** Branches already warned about an in-progress rebase. */
  warnedRebase: ReadonlySet<string>;
  onAutoDelete: (sessionName: string, branch: string) => void | Promise<void>;
  onRebaseInProgress: (branch: string) => void;
  /** Abort between async steps (the TUI passes its effect-cancel flag). */
  isCancelled?: () => boolean;
}): Promise<MergedSweepResult> {
  const {
    provider,
    vcsConfigured,
    config,
    branches,
    warnedRebase,
    onAutoDelete,
    onRebaseInProgress,
    isCancelled = () => false,
  } = opts;
  const keepWarned = new Set(warnedRebase);
  const fetchMerged = provider?.fetchMergedBranches;
  if (!fetchMerged || !vcsConfigured || branches.length === 0) {
    return { merged: new Set(), nextWarned: keepWarned };
  }

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
  if (isCancelled() || !config.autoDeleteOnMerge) {
    return { merged, nextWarned: keepWarned };
  }

  const rebasingNow: string[] = [];
  for (const branch of merged) {
    const check = await canRemoveBranch(branch, true);
    if (isCancelled()) return { merged, nextWarned: keepWarned };
    if (check.safe) {
      await onAutoDelete(branchToSessionName(branch), branch);
    } else {
      if (check.reason === 'rebase in progress') rebasingNow.push(branch);
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: ${check.reason}`
      );
    }
  }

  const { toWarn, nextWarned } = diffRebaseWarnings(rebasingNow, warnedRebase);
  for (const branch of toWarn) onRebaseInProgress(branch);
  return { merged, nextWarned };
}

/** Batch conflict counting; a branch that fails to check counts 0. */
export async function computeConflictCounts(
  branches: string[]
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    branches.map(async (branch) => {
      try {
        return [branch, await countConflicts(branch)] as const;
      } catch {
        return [branch, 0] as const;
      }
    })
  );
  return new Map(entries);
}
