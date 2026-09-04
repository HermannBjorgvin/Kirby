/**
 * Branch-level git operations: the main-branch name and its cache,
 * listing, fetching, fast-forwarding, conflict counting and deletion.
 *
 * Nothing here knows about worktrees.
 */
import { log } from '@kirby/logger';
import { exec, gitOptions } from './exec.js';
import { assertShellSafeRef } from './refs.js';

let cachedMainBranch: string | null = null;

/** Auto-detect the main branch name (master or main) and cache it. */
export async function getMainBranch(): Promise<string> {
  if (cachedMainBranch) return cachedMainBranch;
  try {
    // git symbolic-ref refs/remotes/origin/HEAD → "refs/remotes/origin/master"
    const { stdout } = await exec('git symbolic-ref refs/remotes/origin/HEAD', {
      encoding: 'utf8',
    });
    cachedMainBranch = stdout.trim().split('/').pop()!;
    return cachedMainBranch;
  } catch (e) {
    log('warn', 'getMainBranch', 'symbolic-ref failed, trying fallback', e);
    // Fallback: check which remote branch exists
    try {
      await exec('git rev-parse --verify --quiet origin/master', {
        encoding: 'utf8',
      });
      cachedMainBranch = 'master';
      return cachedMainBranch;
    } catch (e2) {
      log(
        'warn',
        'getMainBranch',
        'origin/master not found, defaulting to main',
        e2
      );
      cachedMainBranch = 'main';
      return cachedMainBranch;
    }
  }
}

/** Reset the cached main branch name (for testing). */
export function resetMainBranchCache(): void {
  cachedMainBranch = null;
}

/** List local git branches.
 *
 * No `-z` here: `git branch` has no such flag, and needs none — git
 * rejects a ref name containing a control character, so a branch name
 * can never contain the newline this splits on. */
export async function listBranches(): Promise<string[]> {
  try {
    const { stdout } = await exec("git branch --format='%(refname:short)'", {
      encoding: 'utf8',
    });
    return stdout
      .trim()
      .split('\n')
      .filter((b) => b.length > 0);
  } catch (e) {
    log('error', 'listBranches', 'git branch failed', e);
    return [];
  }
}

/** Fetch from all remotes and prune stale tracking branches. `cwd`
 *  names the repository; without it, the process's directory. */
export async function fetchRemote(cwd?: string): Promise<boolean> {
  try {
    await exec('git fetch --all --prune', gitOptions(cwd));
    return true;
  } catch (e) {
    log('error', 'fetchRemote', 'git fetch failed', e);
    return false;
  }
}

/**
 * Fold `git branch -a` output into the branch names a picker offers:
 * remote branches lose their `origin/` prefix, the `origin/HEAD`
 * pointer is dropped, and a branch that exists both locally and on the
 * remote appears once, in local-first order.
 */
export function dedupeBranchNames(output: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of output.trim().split('\n')) {
    if (!raw) continue;
    // Strip "origin/" prefix from remote branches, skip HEAD pointer
    const branch = raw.startsWith('origin/')
      ? raw.slice('origin/'.length)
      : raw;
    if (branch === 'HEAD' || seen.has(branch)) continue;
    seen.add(branch);
    result.push(branch);
  }
  return result;
}

/** List local + remote git branches (remote branches stripped of origin/ prefix, deduplicated) */
export async function listAllBranches(): Promise<string[]> {
  try {
    const { stdout } = await exec("git branch -a --format='%(refname:short)'", {
      encoding: 'utf8',
    });
    return dedupeBranchNames(stdout);
  } catch (e) {
    log('error', 'listAllBranches', 'git branch -a failed', e);
    return [];
  }
}

/** Fast-forward local main branch to match origin. Returns true on success. */
export async function fastForwardMainBranch(): Promise<boolean> {
  const main = await getMainBranch();
  try {
    await exec(`git fetch origin ${main}`, { encoding: 'utf8' });
  } catch (e) {
    log('error', 'fastForwardMainBranch', `git fetch origin ${main} failed`, e);
    return false;
  }
  try {
    const { stdout } = await exec('git symbolic-ref --short HEAD', {
      encoding: 'utf8',
    });
    if (stdout.trim() === main) {
      // HEAD is on the main branch — use merge --ff-only instead
      await exec(`git merge --ff-only origin/${main}`, { encoding: 'utf8' });
    } else {
      await exec(`git branch -f ${main} origin/${main}`, { encoding: 'utf8' });
    }
    return true;
  } catch (e) {
    log('error', 'fastForwardMainBranch', 'fast-forward failed', e);
    return false;
  }
}

/**
 * Files that `git merge-tree --write-tree base head` reports as
 * conflicting: zero on a clean merge, null when git failed for some
 * other reason than a conflict — "could not check" and "no conflicts"
 * are different answers. Git 2.38+.
 */
export async function countConflictsBetween(
  base: string,
  head: string,
  cwd?: string
): Promise<number | null> {
  assertShellSafeRef(base, 'base ref');
  assertShellSafeRef(head, 'head ref');
  try {
    await exec(
      `git merge-tree --write-tree ${base} "${head}"`,
      gitOptions(cwd)
    );
    return 0; // clean merge — no conflicts
  } catch (err: unknown) {
    // Exit code 1 with a merge result on stdout (the tree, then a
    // CONFLICT line per file) is a conflicting merge. Exit code 1 with
    // nothing on stdout is a ref that is "not something we can merge"
    // — a tracking branch never fetched, a source on a fork — which is
    // "could not check", not "no conflicts".
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1 && typeof e.stdout === 'string' && e.stdout.trim()) {
      const lines = e.stdout.split('\n');
      return lines.filter((l) => l.startsWith('CONFLICT')).length;
    }
    return null;
  }
}

/**
 * Count conflicting files between a branch and origin's main branch.
 * Returns 0 if no conflicts.
 */
export async function countConflicts(
  branch: string,
  cwd?: string
): Promise<number> {
  const main = await getMainBranch();
  return (await countConflictsBetween(`origin/${main}`, branch, cwd)) ?? 0;
}

/** Fetch these branches from origin, so their tracking refs are what
 *  the remote has now. False when the fetch failed — a branch that
 *  lives on a fork, or a remote whose refspec excludes it. `cwd` names
 *  the repository; without it, the process's directory. */
export async function fetchBranches(
  branches: string[],
  cwd?: string
): Promise<boolean> {
  for (const branch of branches) assertShellSafeRef(branch);
  try {
    await exec(`git fetch origin ${branches.join(' ')}`, gitOptions(cwd));
    return true;
  } catch (e) {
    log('error', 'fetchBranches', 'git fetch failed', e);
    return false;
  }
}

/** Whether `ref` names something git can resolve in the repository at
 *  `cwd` (the process's directory when not given). */
export async function refExists(ref: string, cwd?: string): Promise<boolean> {
  assertShellSafeRef(ref, 'ref');
  try {
    await exec(
      `git rev-parse --verify --quiet "${ref}^{commit}"`,
      gitOptions(cwd)
    );
    return true;
  } catch {
    return false;
  }
}

/** Delete a local git branch. Returns true on success, false on failure. */
export async function deleteBranch(
  branch: string,
  force = false
): Promise<boolean> {
  assertShellSafeRef(branch);
  const flag = force ? '-D' : '-d';
  try {
    await exec(`git branch ${flag} "${branch}"`, { encoding: 'utf8' });
    return true;
  } catch (e) {
    log('error', 'deleteBranch', `git branch ${flag} failed for ${branch}`, e);
    return false;
  }
}
