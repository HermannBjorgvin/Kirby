/**
 * Git worktree and branch operations.
 *
 * Manages .claude/worktrees/ directory for per-branch worktrees
 * used by the TUI to give each Claude session its own checkout.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from './exec.js';

export interface WorktreeInfo {
  path: string;
  branch: string; // short branch name (no refs/heads/)
  bare: boolean;
}

/** Convert a branch name to its .claude/worktrees/ relative directory */
function worktreeDir(branch: string): string {
  return '.claude/worktrees/' + branch.replace(/\//g, '-');
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
    await execFile('git', ['worktree', 'add', relativeDir, branch], {
      encoding: 'utf8',
    });
    return absoluteDir;
  } catch {
    try {
      // Branch doesn't exist — create new branch from HEAD
      await execFile('git', ['worktree', 'add', '-b', branch, relativeDir], {
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
    await execFile('git', ['worktree', 'remove', relativeDir], {
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
  branch: string
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
    const { stdout: status } = await execFile(
      'git',
      ['-C', dir, 'status', '--porcelain'],
      { encoding: 'utf8' }
    );
    if (status.trim().length > 0) {
      return { safe: false, reason: 'uncommitted changes' };
    }
  } catch {
    // Worktree may not exist — skip this check
  }

  // Not pushed to upstream
  try {
    const { stdout: unpushed } = await execFile(
      'git',
      ['log', branch, '--not', '--remotes', '-1'],
      { encoding: 'utf8' }
    );
    if (unpushed.trim().length > 0) {
      return { safe: false, reason: 'not pushed to upstream' };
    }
  } catch {
    // Branch may not have remote tracking — skip
  }

  return { safe: true };
}

/** List local git branches */
export async function listBranches(): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      'git',
      ['branch', '--format=%(refname:short)'],
      { encoding: 'utf8' }
    );
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
    await execFile('git', ['fetch', '--all', '--prune'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** List local + remote git branches (remote branches stripped of origin/ prefix, deduplicated) */
export async function listAllBranches(): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      'git',
      ['branch', '-a', '--format=%(refname:short)'],
      { encoding: 'utf8' }
    );
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
    const { stdout } = await execFile(
      'git',
      ['worktree', 'list', '--porcelain'],
      { encoding: 'utf8' }
    );
    return parseWorktrees(stdout).filter(
      (w) => !w.bare && w.path.includes('.claude/worktrees/')
    );
  } catch {
    return [];
  }
}

/** Fast-forward local master to origin/master. Returns true on success. */
export async function fastForwardMaster(): Promise<boolean> {
  try {
    await execFile('git', ['fetch', 'origin', 'master'], { encoding: 'utf8' });
    await execFile('git', ['branch', '-f', 'master', 'origin/master'], {
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Count conflicting files between a branch and origin/master.
 * Uses `git merge-tree --write-tree` (Git 2.38+).
 * Returns 0 if no conflicts.
 */
export async function countConflicts(branch: string): Promise<number> {
  try {
    await execFile(
      'git',
      ['merge-tree', '--write-tree', 'origin/master', branch],
      { encoding: 'utf8' }
    );
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
    await execFile('git', ['branch', flag, branch], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch origin/master and rebase the worktree's branch onto it.
 * If conflicts arise, the rebase is automatically aborted.
 */
export async function rebaseOntoMaster(
  worktreePath: string
): Promise<'success' | 'conflict' | 'error'> {
  try {
    await execFile('git', ['-C', worktreePath, 'fetch', 'origin', 'master'], {
      encoding: 'utf8',
    });
  } catch {
    return 'error';
  }
  try {
    await execFile('git', ['-C', worktreePath, 'rebase', 'origin/master'], {
      encoding: 'utf8',
    });
    return 'success';
  } catch {
    try {
      await execFile('git', ['-C', worktreePath, 'rebase', '--abort'], {
        encoding: 'utf8',
      });
    } catch {
      /* abort failed — nothing more to do */
    }
    return 'conflict';
  }
}
