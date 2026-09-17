import { removeWorktree, deleteBranch } from '@n10/worktree-manager';
import { stopSession } from './stop-session.js';
import { getRepoRoot } from '../repo-root.js';
import { worktreeSessionKey } from '../session-key.js';

/** Stop only this repository's branch agent before deleting its checkout. */
export async function removeWorktreeSession(
  branch: string,
  force: boolean,
  repo?: string
): Promise<boolean> {
  const cwd = repo ?? getRepoRoot() ?? process.cwd();
  const key = worktreeSessionKey(branch, cwd);
  stopSession(key);
  const removed = await removeWorktree(branch, { force, cwd });
  if (removed) await deleteBranch(branch, true, cwd);
  return removed;
}
