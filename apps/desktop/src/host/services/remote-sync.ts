import {
  computeConflictCounts,
  remoteSyncIntervalMs,
  sweepMergedBranches,
  syncRemote,
} from '@kirby/app-core';
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
let passRunning = false;

let notifier: ((notice: SyncNoticeEvent) => void) | null = null;

/** Installed by main.ts; forwards sync notices to renderer windows. */
export function setSyncNotifier(fn: (notice: SyncNoticeEvent) => void): void {
  notifier = fn;
}

export function getSyncDecorations(): SyncDecorations {
  return decorations;
}

/** (Re)start the loop for a repo — called on every repo open, and when
 *  mergePollInterval changes. State from a previous repo is dropped. */
export function startRemoteSyncLoop(cwd: string): void {
  stopRemoteSyncLoop();
  decorations = {
    merged: new Set(),
    conflicts: new Map(),
    lastGitSyncAt: null,
  };
  warnedRebase = new Set();
  const interval = remoteSyncIntervalMs(readConfig(cwd).mergePollInterval);
  const tick = () => void runSyncPass(cwd);
  timer = setInterval(tick, interval);
  timer.unref?.();
  tick();
}

export function stopRemoteSyncLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function runSyncPass(cwd: string): Promise<void> {
  if (passRunning) return;
  passRunning = true;
  try {
    const config = readConfig(cwd);
    const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
    const vcsConfigured =
      provider != null &&
      provider.isConfigured(config.vendorAuth, config.vendorProject);
    // The TUI's polling is gated on vcsConfigured too.
    if (!vcsConfigured) return;

    const ts = await syncRemote();
    const branches = (await listWorktrees())
      .map((w) => w.branch)
      .filter(Boolean);

    const { merged, nextWarned } = await sweepMergedBranches({
      provider,
      vcsConfigured,
      config,
      branches,
      warnedRebase,
      onAutoDelete: async (_sessionName, branch) => {
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
    warnedRebase = nextWarned;

    const conflicts = await computeConflictCounts(
      branches.filter((b) => !merged.has(b))
    );
    decorations = { merged, conflicts, lastGitSyncAt: ts };
  } catch (err: unknown) {
    console.error('[desktop] remote sync pass failed:', err);
  } finally {
    passRunning = false;
  }
}
