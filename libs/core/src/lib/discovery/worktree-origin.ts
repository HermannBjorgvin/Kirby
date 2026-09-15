import { readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/**
 * Where a worktree directory is, git-wise, read from its own files:
 * the branch checked out in it, or the directory's name on a detached
 * HEAD. No git is forked. The repository a worktree belongs to is not
 * asked here at all — a session carries it as `@orchestra-repo`, and a
 * session without that tag is foreign.
 */

/** What a checkout's HEAD says: the branch checked out, or the
 *  directory's name when none is — the fallback `worktreeSessionName`
 *  uses to name such a worktree's session, and what its session is
 *  tagged with. */
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
 * Three callers want exactly this and nothing more: resolving and
 * tagging a session by its branch at spawn time, on a synchronous
 * path; telling whether a listed session's worktree is still on the
 * branch it was spawned under; and telling whether that branch is
 * really a detached HEAD's directory name. A symbolic HEAD under
 * `refs/heads/` is a branch, and
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
