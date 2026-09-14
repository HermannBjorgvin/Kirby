import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

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

/** What a checkout's HEAD says: the branch checked out, or the
 *  directory's name when none is — the same fallback as
 *  {@link WorktreeOrigin.branch}. */
export interface WorktreeHead {
  branch: string;
  detached: boolean;
}

/** The git dir of the checkout at `path`: `.git` itself in a main
 *  checkout, or the directory a linked worktree's `.git` *file* names
 *  (`gitdir: …`, relative to the worktree when it is not absolute).
 *  `null` when there is neither. */
function gitDirOf(path: string): string | null {
  const dotGit = join(path, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
    return m ? resolve(path, m[1]!) : null;
  } catch {
    return null;
  }
}

/**
 * Read HEAD at `path` from the checkout's own files, without a fork.
 *
 * Two callers want exactly this and nothing more: tagging a session
 * with its branch at spawn time, on a synchronous path, and telling
 * whether a tag-described session's branch is really a detached HEAD's
 * directory name. A symbolic HEAD under `refs/heads/` is a branch, and
 * the name is exact — where `rev-parse --abbrev-ref` would say
 * `heads/x` when a tag `x` exists too, this says `x`, the same string
 * `git worktree list` reports. Anything else HEAD holds — a commit, or
 * a ref outside `refs/heads/` — is detached. `null` when `path` is not
 * a checkout or its HEAD cannot be read; never throws.
 */
export function readWorktreeHead(path: string): WorktreeHead | null {
  const gitDir = gitDirOf(path);
  if (!gitDir) return null;
  let head: string;
  try {
    head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = /^ref: refs\/heads\/(.+)$/.exec(head);
  return ref
    ? { branch: ref[1]!, detached: false }
    : { branch: basename(path), detached: true };
}
