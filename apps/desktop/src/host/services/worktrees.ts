import {
  listWorktrees as listWts,
  listBranches as listBr,
  listAllBranches as listAllBr,
  createWorktree as createWt,
  removeWorktree as removeWt,
  canRemoveBranch as canRemoveBr,
  deleteBranch,
  branchToSessionName,
  worktreeSessionName,
} from '@kirby/worktree-manager';
import { spawn } from 'node:child_process';
import { killPersistedTmuxSession, killSession } from '@kirby/app-core';
import { readConfig } from '@kirby/vcs-core';
import { requireRepo } from './repo.js';

// All worktree-manager functions resolve paths against process.cwd();
// openRepo() chdir'd into the active repo, so these are repo-scoped.

export function listWorktrees() {
  requireRepo();
  return listWts();
}

export function listBranches() {
  requireRepo();
  return listBr();
}

export function listAllBranches() {
  requireRepo();
  return listAllBr();
}

export function createWorktree(branch: string) {
  requireRepo();
  return createWt(branch);
}

export async function removeWorktree(
  branch: string,
  force: boolean
): Promise<boolean> {
  requireRepo();
  // Mirrors the TUI's performDelete (useSessionManager): kill the
  // agent, remove the worktree, then delete the branch — removal
  // without the other two strands a PTY in a deleted directory and
  // leaves the branch behind.
  const wt = (await listWts()).find((w) => w.branch === branch);
  if (wt) killSession(worktreeSessionName(wt));
  killSession(branchToSessionName(branch));
  // A tmux session may be running for this branch even when the
  // registry has never seen it (persisted from a previous run and not
  // reattached). Kill it by name so the worktree is never deleted out
  // from under a live agent.
  const config = readConfig(requireRepo());
  killPersistedTmuxSession(config, branchToSessionName(branch));
  if (wt) killPersistedTmuxSession(config, worktreeSessionName(wt));
  const removed = await removeWt(branch, { force });
  if (removed) await deleteBranch(branch, true);
  return removed;
}

export function canRemoveBranch(branch: string) {
  requireRepo();
  return canRemoveBr(branch);
}

/** Open the branch's worktree in the configured editor — the TUI's
 *  Shift+E: `config.editor || $VISUAL || $EDITOR`, spawned detached.
 *  createWorktree is idempotent, so PR rows without a checkout work. */
export async function openInEditor(branch: string): Promise<{
  editor: string;
}> {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const editor = config.editor || process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    throw new Error('No editor configured — set one in Settings');
  }
  const path = await createWt(branch);
  if (!path) {
    throw new Error(`Failed to resolve a worktree for "${branch}"`);
  }
  spawn(editor, [path], { detached: true, stdio: 'ignore' }).unref();
  return { editor };
}
