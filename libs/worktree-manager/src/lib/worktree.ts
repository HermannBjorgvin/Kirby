/**
 * Git worktree and branch operations.
 *
 * Manages .claude/worktrees/ directory for per-branch worktrees
 * used by the TUI to give each Claude session its own checkout.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec } from './exec.js';

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
  } catch {
    // Fallback: check which remote branch exists
    try {
      await exec('git rev-parse --verify --quiet origin/master', {
        encoding: 'utf8',
      });
      cachedMainBranch = 'master';
      return cachedMainBranch;
    } catch {
      cachedMainBranch = 'main';
      return cachedMainBranch;
    }
  }
}

/** Reset the cached main branch name (for testing). */
export function resetMainBranchCache(): void {
  cachedMainBranch = null;
}

export interface WorktreeInfo {
  path: string;
  branch: string; // short branch name (no refs/heads/)
  bare: boolean;
}

/** Convert a git branch name to a safe session identifier (replace / with -) */
export function branchToSessionName(branch: string): string {
  return branch.replace(/\//g, '-');
}

/** Convert a branch name to its .claude/worktrees/ relative directory */
function worktreeDir(branch: string): string {
  return '.claude/worktrees/' + branchToSessionName(branch);
}

/**
 * Create a git worktree for a branch.
 * If the branch exists, checks it out. If not, creates a new branch from HEAD.
 * Returns the worktree path on success, null on failure.
 */
export async function createWorktree(branch: string): Promise<string | null> {
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
  } catch {
    try {
      // Branch doesn't exist — create new branch from HEAD
      await exec(`git worktree add -b "${branch}" "${relativeDir}"`, {
        encoding: 'utf8',
      });
      return absoluteDir;
    } catch {
      return null;
    }
  }
}

/**
 * Remove a git worktree for a branch.
 * Returns true on success, false on failure.
 */
export async function removeWorktree(branch: string): Promise<boolean> {
  const relativeDir = worktreeDir(branch);
  try {
    await exec(`git worktree remove "${relativeDir}"`, {
      encoding: 'utf8',
    });
    return true;
  } catch {
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
  // Protected branch guard
  if (
    branch === 'main' ||
    branch === 'master' ||
    branch.startsWith('gitbutler')
  ) {
    return { safe: false, reason: 'protected branch' };
  }

  const dir = worktreeDir(branch);

  // Uncommitted changes
  try {
    const { stdout: status } = await exec(
      `git -C "${dir}" status --porcelain`,
      { encoding: 'utf8' }
    );
    if (status.trim().length > 0) {
      return { safe: false, reason: 'uncommitted changes' };
    }
  } catch {
    // Worktree may not exist — skip this check
  }

  // Not pushed to upstream — skip when the VCS provider already confirmed merge
  if (!confirmedMerged) {
    try {
      const { stdout: unpushed } = await exec(
        `git log "${branch}" --not --remotes -1`,
        { encoding: 'utf8' }
      );
      if (unpushed.trim().length > 0) {
        return { safe: false, reason: 'not pushed to upstream' };
      }
    } catch {
      // Branch may not have remote tracking — skip
    }
  }

  return { safe: true };
}

/** List local git branches */
export async function listBranches(): Promise<string[]> {
  try {
    const { stdout } = await exec("git branch --format='%(refname:short)'", {
      encoding: 'utf8',
    });
    return stdout
      .trim()
      .split('\n')
      .filter((b) => b.length > 0);
  } catch {
    return [];
  }
}

/** Fetch from all remotes and prune stale tracking branches */
export async function fetchRemote(): Promise<boolean> {
  try {
    await exec('git fetch --all --prune', { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** List local + remote git branches (remote branches stripped of origin/ prefix, deduplicated) */
export async function listAllBranches(): Promise<string[]> {
  try {
    const { stdout } = await exec("git branch -a --format='%(refname:short)'", {
      encoding: 'utf8',
    });
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of stdout.trim().split('\n')) {
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
  } catch {
    return [];
  }
}

/** Parse `git worktree list --porcelain` output into WorktreeInfo[] */
export function parseWorktrees(output: string): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  const blocks = output.split('\n\n').filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let path = '';
    let branch = '';
    let bare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        bare = true;
      }
    }

    if (path) {
      results.push({ path, branch, bare });
    }
  }

  return results;
}

/**
 * List git worktrees under .claude/worktrees/ for the current repo.
 * Skips the main worktree and bare entries.
 */
export async function listWorktrees(): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await exec('git worktree list --porcelain', {
      encoding: 'utf8',
    });
    return parseWorktrees(stdout).filter(
      (w) => !w.bare && w.path.includes('.claude/worktrees/')
    );
  } catch {
    return [];
  }
}

/** Fast-forward local main branch to match origin. Returns true on success. */
export async function fastForwardMainBranch(): Promise<boolean> {
  const main = await getMainBranch();
  try {
    await exec(`git fetch origin ${main}`, { encoding: 'utf8' });
  } catch {
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
  } catch {
    return false;
  }
}

/**
 * Count conflicting files between a branch and origin's main branch.
 * Uses `git merge-tree --write-tree` (Git 2.38+).
 * Returns 0 if no conflicts.
 */
export async function countConflicts(branch: string): Promise<number> {
  const main = await getMainBranch();
  try {
    await exec(`git merge-tree --write-tree origin/${main} "${branch}"`, {
      encoding: 'utf8',
    });
    return 0; // clean merge — no conflicts
  } catch (err: unknown) {
    // Exit code 1 = conflicts; stdout lists conflicted files
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1 && typeof e.stdout === 'string') {
      // Each "CONFLICT" line in stdout represents a conflicting file
      const lines = e.stdout.split('\n');
      return lines.filter((l) => l.startsWith('CONFLICT')).length;
    }
    return 0;
  }
}

/** Delete a local git branch. Returns true on success, false on failure. */
export async function deleteBranch(
  branch: string,
  force = false
): Promise<boolean> {
  const flag = force ? '-D' : '-d';
  try {
    await exec(`git branch ${flag} "${branch}"`, { encoding: 'utf8' });
    return true;
  } catch {
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
  const main = await getMainBranch();
  try {
    await exec(`git -C "${worktreePath}" fetch origin ${main}`, {
      encoding: 'utf8',
    });
  } catch {
    return 'error';
  }
  try {
    await exec(`git -C "${worktreePath}" rebase origin/${main}`, {
      encoding: 'utf8',
    });
    return 'success';
  } catch {
    try {
      await exec(`git -C "${worktreePath}" rebase --abort`, {
        encoding: 'utf8',
      });
    } catch {
      /* abort failed — nothing more to do */
    }
    return 'conflict';
  }
}
