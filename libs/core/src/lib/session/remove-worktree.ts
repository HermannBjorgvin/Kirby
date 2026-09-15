import { removeWorktree, deleteBranch } from '@kirby/worktree-manager';
import { killSession } from '../pty-registry.js';
import { killPersistedTmuxSession } from '../session-backend.js';
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
  killSession(key);
  killPersistedTmuxSession(key);
  const removed = await removeWorktree(branch, { force, cwd });
  if (removed) await deleteBranch(branch, true, cwd);
  return removed;
}
