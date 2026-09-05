import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/**
 * Where a worktree directory comes from: the repository it is a
 * checkout of, and the branch checked out in it.
 *
 * This is how a tmux session's `session_path` becomes a tab in a
 * repository group without a state file: the path is the worktree,
 * and git knows the rest.
 */
export interface WorktreeOrigin {
  /** The main checkout's root — real path, the same string
   *  `git rev-parse --show-toplevel` answers there, which is what the
   *  tmux prefix (`projectKey`) and the desktop's repo identity are
   *  computed from. */
  repoRoot: string;
  /** The branch checked out in the worktree, or the directory's name
   *  on a detached HEAD — the same fallback `worktreeSessionName` uses
   *  to name such a worktree's session. */
  branch: string;
  /** Whether `branch` is that fallback: no branch is checked out. A
   *  shell that attaches by branch has nothing to attach such a
   *  worktree by. */
  detached: boolean;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Describe a worktree directory, or `null` when it is not one: the
 * directory is gone, is not inside a git working tree, or its
 * repository has no checkout to open (a bare one).
 *
 * The common git dir is what ties a linked worktree back to its main
 * checkout — `.git` of the main worktree, printed relative to the
 * worktree it is asked from or absolute — and the checkout is that
 * directory's parent, confirmed by asking git for the toplevel there
 * rather than assumed from the path, so nothing whose `.git` lives
 * somewhere unusual is filed under the wrong repository. Never throws.
 */
export function describeWorktreePath(path: string): WorktreeOrigin | null {
  if (!existsSync(path)) return null;
  const common = git(path, ['rev-parse', '--git-common-dir']);
  if (!common) return null;
  const checkout = dirname(resolve(path, common));
  const toplevel = git(checkout, ['rev-parse', '--show-toplevel']);
  if (!toplevel) return null;
  let repoRoot: string;
  try {
    repoRoot = realpathSync(toplevel);
    if (repoRoot !== realpathSync(checkout)) return null;
  } catch {
    return null;
  }
  const head = git(path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head === null) return null;
  const detached = head === '' || head === 'HEAD';
  return { repoRoot, branch: detached ? basename(path) : head, detached };
}
