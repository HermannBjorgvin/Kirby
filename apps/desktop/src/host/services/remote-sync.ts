import {
  computeConflictCounts,
  remoteSyncIntervalMs,
  sweepMergedBranches,
  syncRemote,
} from '@kirby/core';
import { listWorktrees } from '@kirby/worktree-manager';
import { readConfig } from '@kirby/vcs-core';
import { PROVIDERS } from './repo.js';
import { removeWorktree } from './worktrees.js';
import type { SyncNoticeEvent } from '../contract.js';

/**
 * The desktop's scheduling shell around the shared remote-sync core
 * (`@kirby/app-core` sync/remote-sync) — the same passes the TUI's
 * useRemoteSync / useMergedBranches / useConflictCounts hooks drive:
 * git fetch + fast-forward main, the merged-branch sweep (with
 * auto-delete-on-merge), and conflict counting. Results decorate the
 * sidebar model; user-facing events reach the renderer as toasts via
 * the sync-notice channel.
 */

interface SyncDecorations {
  merged: Set<string>;
  conflicts: Map<string, number>;
  /** ms-epoch of the last completed git sync pass, null if never. */
  lastGitSyncAt: number | null;
}

let decorations: SyncDecorations = {
  merged: new Set(),
  conflicts: new Map(),
  lastGitSyncAt: null,
};
let warnedRebase: ReadonlySet<string> = new Set();
let timer: ReturnType<typeof setInterval> | null = null;
// Every startRemoteSyncLoop bumps the generation; a pass carries the
// generation it was started under and aborts (via the shared sweep's
// isCancelled hook) as soon as a newer one exists. This matters
// because worktree-manager resolves process.cwd() at call time: after
// a repo switch, a stale pass would otherwise run git operations —
// including auto-delete — against the *new* repo using the old repo's
// branch list.
let generation = 0;
let lastCwd: string | null = null;
// Passes are serialized so a repo switch's kickoff pass isn't skipped
// just because the previous repo's pass is still winding down.
let queue: Promise<void> = Promise.resolve();

let notifier: ((notice: SyncNoticeEvent) => void) | null = null;

/** Installed by main.ts; forwards sync notices to renderer windows. */
export function setSyncNotifier(fn: (notice: SyncNoticeEvent) => void): void {
  notifier = fn;
}

export function getSyncDecorations(): SyncDecorations {
  return decorations;
}

/** (Re)start the loop for a repo — called on every repo open, and when
 *  mergePollInterval changes. Switching repos drops the previous
 *  repo's state; a same-repo restart (interval change) keeps the
 *  current decorations so badges don't blink out until the next pass. */
export function startRemoteSyncLoop(cwd: string): void {
  stopRemoteSyncLoop();
  generation += 1;
  const gen = generation;
  if (cwd !== lastCwd) {
    decorations = {
      merged: new Set(),
      conflicts: new Map(),
      lastGitSyncAt: null,
    };
    warnedRebase = new Set();
  }
  lastCwd = cwd;
  const interval = remoteSyncIntervalMs(readConfig(cwd).mergePollInterval);
  const tick = () => {
    queue = queue.then(() => runSyncPass(cwd, gen)).catch(() => undefined);
  };
  timer = setInterval(tick, interval);
  timer.unref?.();
  tick();
}

export function stopRemoteSyncLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  // Bump the generation too, so a pass already running is cancelled at
  // its next checkpoint. Without this, quitting during the auto-delete
  // step lets `removeWorktree` → `deleteBranch` keep going and the
  // process can exit between them, leaving an orphaned branch.
  generation += 1;
}

async function runSyncPass(cwd: string, gen: number): Promise<void> {
  const cancelled = () => gen !== generation;
  if (cancelled()) return;
  try {
    const config = readConfig(cwd);
    const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
    const vcsConfigured =
      provider != null &&
      provider.isConfigured(config.vendorAuth, config.vendorProject);
    // The TUI's polling is gated on vcsConfigured too.
    if (!vcsConfigured) return;

    const ts = await syncRemote();
    if (cancelled()) return;
    const branches = (await listWorktrees())
      .map((w) => w.branch)
      .filter(Boolean);
    if (cancelled()) return;

    const { merged, nextWarned } = await sweepMergedBranches({
      provider,
      vcsConfigured,
      config,
      branches,
      warnedRebase,
      isCancelled: cancelled,
      onAutoDelete: async (_sessionName, branch) => {
        if (cancelled()) return;
        // Same triple as the TUI's performDelete (kill session, remove
        // worktree, delete branch) — the worktrees service owns it.
        await removeWorktree(branch, true);
        notifier?.({
          message: `Auto-deleted merged branch: ${branch}`,
          kind: 'success',
        });
      },
      onRebaseInProgress: (branch) =>
        notifier?.({
          message: `Auto-delete of ${branch} skipped: rebase in progress`,
          kind: 'warning',
        }),
    });
    if (cancelled()) return;
    warnedRebase = nextWarned;

    const conflicts = await computeConflictCounts(
      branches.filter((b) => !merged.has(b))
    );
    if (cancelled()) return;
    decorations = { merged, conflicts, lastGitSyncAt: ts };
  } catch (err: unknown) {
    console.error('[desktop] remote sync pass failed:', err);
  }
}
