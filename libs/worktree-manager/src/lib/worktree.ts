/**
 * Git worktree lifecycle: creating a checkout for a branch, removing
 * one, deciding whether removal is safe, and rebasing one onto main.
 *
 * Manages .claude/worktrees/ directory for per-branch worktrees
 * used by the TUI to give each Claude session its own checkout.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '@kirby/logger';
import { exec } from './exec.js';
import { assertShellSafeRef } from './refs.js';
import { worktreeDir } from './worktree-resolver.js';
import { listWorktrees, type WorktreeInfo } from './worktree-list.js';
import { getMainBranch } from './branches.js';

/**
 * Resolve the actual on-disk path of the worktree that has `branch`
 * checked out, by asking git rather than deriving it from the branch
 * name. A worktree's directory is independent of its branch name (git
 * lets you `worktree add <any-dir> <branch>`, and Kirby's resolver only
 * governs the dirs *it* creates), so the resolver-derived path can be
 * wrong for externally-created worktrees.
 *
 * Uses `listWorktrees` rather than the raw porcelain so a mid-rebase
 * worktree — which reports a detached HEAD with no `branch` line — still
 * matches via its recovered branch, and so the result is scoped to
 * Kirby-owned worktrees. Returns `null` if no owned worktree currently
 * has the branch checked out.
 */
async function worktreeForBranch(branch: string): Promise<WorktreeInfo | null> {
  const wt = (await listWorktrees()).find((w) => w.branch === branch);
  return wt ?? null;
}

async function worktreePathForBranch(branch: string): Promise<string | null> {
  return (await worktreeForBranch(branch))?.path ?? null;
}

/**
 * Create a git worktree for a branch.
 * If the branch exists, checks it out. If not, creates a new branch from HEAD.
 * Returns the worktree path on success, null on failure.
 */
export async function createWorktree(branch: string): Promise<string | null> {
  assertShellSafeRef(branch);
  const relativeDir = worktreeDir(branch);
  const absoluteDir = resolve(process.cwd(), relativeDir);

  // Worktree already exists — just return the path
  if (existsSync(relativeDir)) {
    return absoluteDir;
  }

  try {
    // Try existing branch first
    await exec(`git worktree add "${relativeDir}" "${branch}"`, {
      encoding: 'utf8',
    });
    return absoluteDir;
  } catch (e) {
    log(
      'warn',
      'createWorktree',
      `existing branch checkout failed for ${branch}`,
      e
    );
    try {
      // Branch doesn't exist — create new branch from HEAD
      await exec(`git worktree add -b "${branch}" "${relativeDir}"`, {
        encoding: 'utf8',
      });
      return absoluteDir;
    } catch (e2) {
      log(
        'error',
        'createWorktree',
        `new branch creation failed for ${branch}`,
        e2
      );
      return null;
    }
  }
}

/**
 * Remove a git worktree for a branch.
 * Returns true on success, false on failure.
 */
export async function removeWorktree(
  branch: string,
  { force = false }: { force?: boolean } = {}
): Promise<boolean> {
  assertShellSafeRef(branch);
  // Prefer the worktree's real path from git; fall back to the
  // resolver-derived dir only if git doesn't know the branch.
  const target = (await worktreePathForBranch(branch)) ?? worktreeDir(branch);
  assertShellSafeRef(target, 'worktree path');
  try {
    const forceFlag = force ? ' --force' : '';
    await exec(`git worktree remove${forceFlag} "${target}"`, {
      encoding: 'utf8',
    });
    return true;
  } catch (e) {
    log(
      'error',
      'removeWorktree',
      `git worktree remove failed for ${branch}`,
      e
    );
    return false;
  }
}

/**
 * Check whether a branch can be safely deleted.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export async function canRemoveBranch(
  branch: string,
  confirmedMerged = false
): Promise<{ safe: true } | { safe: false; reason: string }> {
  assertShellSafeRef(branch);
  // Protected branch guard
  if (
    branch === 'main' ||
    branch === 'master' ||
    branch.startsWith('gitbutler')
  ) {
    return { safe: false, reason: 'protected branch' };
  }

  const wt = await worktreeForBranch(branch);

  // A mid-rebase worktree carries in-progress rebase state (recovered
  // from rebase-merge/rebase-apply) that force-removing the worktree
  // would silently destroy. Refuse to delete it — auto-delete and manual
  // delete both gate on this — so the user finishes or aborts the rebase
  // first.
  if (wt?.state === 'rebasing') {
    return { safe: false, reason: 'rebase in progress' };
  }

  // Use the worktree's real path from git so the status check runs
  // against the actual checkout, not a resolver-derived guess that may
  // not exist (which would silently skip the uncommitted-changes guard).
  const dir = wt?.path ?? worktreeDir(branch);

  if (await hasUncommittedChanges(dir, branch)) {
    return { safe: false, reason: 'uncommitted changes' };
  }

  // Skip when the VCS provider already confirmed the branch merged.
  if (!confirmedMerged && (await hasUnpushedCommits(branch))) {
    return { safe: false, reason: 'not pushed to upstream' };
  }

  return { safe: true };
}

/**
 * Whether the checkout at `dir` has anything uncommitted. A git call
 * that fails answers "no": the worktree may simply not exist, and this
 * guard is not the place to report that.
 */
async function hasUncommittedChanges(
  dir: string,
  branch: string
): Promise<boolean> {
  try {
    // Deliberately not `-z`: this output is only ever tested for
    // emptiness, so NUL termination would buy nothing. Add it before
    // parsing the entries — the newline form renders a rename as
    // `old -> new` in one field, which is the same trap `--numstat`
    // set with its brace form (see parseNumstat in @kirby/app-core).
    const { stdout } = await exec(`git -C "${dir}" status --porcelain`, {
      encoding: 'utf8',
    });
    return stdout.trim().length > 0;
  } catch (e) {
    log('warn', 'canRemoveBranch', `status check failed for ${branch}`, e);
    return false;
  }
}

/**
 * Whether `branch` holds commits no remote has. As above, a failure
 * answers "no" — the branch may just have no remote tracking.
 */
async function hasUnpushedCommits(branch: string): Promise<boolean> {
  try {
    const { stdout } = await exec(`git log "${branch}" --not --remotes -1`, {
      encoding: 'utf8',
    });
    return stdout.trim().length > 0;
  } catch (e) {
    log('warn', 'canRemoveBranch', `unpushed check failed for ${branch}`, e);
    return false;
  }
}

/**
 * Fetch origin's main branch and rebase the worktree's branch onto it.
 * If conflicts arise, the rebase is automatically aborted.
 */
export async function rebaseOntoMaster(
  worktreePath: string
): Promise<'success' | 'conflict' | 'error'> {
  assertShellSafeRef(worktreePath, 'worktree path');
  const main = await getMainBranch();
  try {
    await exec(`git -C "${worktreePath}" fetch origin ${main}`, {
      encoding: 'utf8',
    });
  } catch (e) {
    log('error', 'rebaseOntoMaster', `fetch origin ${main} failed`, e);
    return 'error';
  }
  try {
    await exec(`git -C "${worktreePath}" rebase origin/${main}`, {
      encoding: 'utf8',
    });
    return 'success';
  } catch (e) {
    log('warn', 'rebaseOntoMaster', 'rebase failed, aborting', e);
    try {
      await exec(`git -C "${worktreePath}" rebase --abort`, {
        encoding: 'utf8',
      });
    } catch (e2) {
      log('error', 'rebaseOntoMaster', 'rebase --abort failed', e2);
    }
    return 'conflict';
  }
}
