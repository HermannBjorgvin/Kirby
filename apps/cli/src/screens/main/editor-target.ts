import {
  branchToSessionName,
  type WorktreeInfo,
} from '@kirby/worktree-manager';
import type { SidebarItem } from '../../types.js';

export interface EditorTargetDeps {
  listWorktrees: () => Promise<WorktreeInfo[]>;
  /** Idempotent: returns the existing worktree path if the branch is
   *  already checked out, otherwise creates one. */
  createWorktree: (branch: string) => Promise<string | null>;
}

/**
 * Resolve the filesystem path to open in an external editor for the
 * given sidebar item. For session rows the worktree always exists; for
 * PR rows (orphan or review) the worktree is created on demand so
 * `Shift+E` works even before the user has explicitly checked it out.
 *
 * Returns null when no path can be resolved (e.g. createWorktree
 * failed, or a session item has no matching worktree — which only
 * happens in stale UI state).
 */
export async function resolveEditorTarget(
  item: SidebarItem,
  deps: EditorTargetDeps
): Promise<string | null> {
  const sessionName =
    item.kind === 'session'
      ? item.session.name
      : branchToSessionName(item.pr.sourceBranch);

  const worktrees = await deps.listWorktrees();
  const existing = worktrees.find(
    (w) => branchToSessionName(w.branch) === sessionName
  );
  if (existing) return existing.path;

  if (item.kind !== 'session') {
    return deps.createWorktree(item.pr.sourceBranch);
  }
  return null;
}
