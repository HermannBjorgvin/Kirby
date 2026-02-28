/**
 * Git worktree and branch operations.
 *
 * Manages .tui/worktrees/ directory for per-branch worktrees
 * used by the TUI to give each Claude session its own checkout.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WorktreeInfo {
  path: string;
  branch: string; // short branch name (no refs/heads/)
  bare: boolean;
}

/** Convert a branch name to its .tui/worktrees/ relative directory */
function worktreeDir(branch: string): string {
  return '.tui/worktrees/' + branch.replace(/\//g, '-');
}

/**
 * Create a git worktree for a branch.
 * If the branch exists, checks it out. If not, creates a new branch from HEAD.
 * Returns the worktree path on success, null on failure.
 */
export function createWorktree(branch: string): string | null {
  const relativeDir = worktreeDir(branch);
  const absoluteDir = resolve(process.cwd(), relativeDir);

  // Worktree already exists — just return the path
  if (existsSync(relativeDir)) {
    return absoluteDir;
  }

  try {
    // Try existing branch first
    execSync(`git worktree add "${relativeDir}" "${branch}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return absoluteDir;
  } catch {
    try {
      // Branch doesn't exist — create new branch from HEAD
      execSync(`git worktree add -b "${branch}" "${relativeDir}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
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
export function removeWorktree(branch: string): boolean {
  const relativeDir = worktreeDir(branch);
  try {
    execSync(`git worktree remove "${relativeDir}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
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
export function canRemoveBranch(
  branch: string
): { safe: true } | { safe: false; reason: string } {
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
    const status = execSync(`git -C "${dir}" status --porcelain`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (status.trim().length > 0) {
      return { safe: false, reason: 'uncommitted changes' };
    }
  } catch {
    // Worktree may not exist — skip this check
  }

  // Not pushed to upstream
  try {
    const unpushed = execSync(`git log "${branch}" --not --remotes -1`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (unpushed.trim().length > 0) {
      return { safe: false, reason: 'not pushed to upstream' };
    }
  } catch {
    // Branch may not have remote tracking — skip
  }

  return { safe: true };
}

/** List local git branches */
export function listBranches(): string[] {
  try {
    const output = execSync("git branch --format='%(refname:short)'", {
      encoding: 'utf8',
    });
    return output
      .trim()
      .split('\n')
      .filter((b) => b.length > 0);
  } catch {
    return [];
  }
}

/** Fetch from all remotes and prune stale tracking branches */
export function fetchRemote(): boolean {
  try {
    execSync('git fetch --all --prune', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** List local + remote git branches (remote branches stripped of origin/ prefix, deduplicated) */
export function listAllBranches(): string[] {
  try {
    const output = execSync("git branch -a --format='%(refname:short)'", {
      encoding: 'utf8',
    });
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
 * List git worktrees under .tui/worktrees/ for the current repo.
 * Skips the main worktree and bare entries.
 */
export function listWorktrees(): WorktreeInfo[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
    });
    return parseWorktrees(output).filter(
      (w) => !w.bare && w.path.includes('.tui/worktrees/')
    );
  } catch {
    return [];
  }
}

/**
 * Fetch origin/master and rebase the worktree's branch onto it.
 * If conflicts arise, the rebase is automatically aborted.
 */
export function rebaseOntoMaster(
  worktreePath: string
): 'success' | 'conflict' | 'error' {
  try {
    execSync(`git -C "${worktreePath}" fetch origin master`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    return 'error';
  }
  try {
    execSync(`git -C "${worktreePath}" rebase origin/master`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return 'success';
  } catch {
    try {
      execSync(`git -C "${worktreePath}" rebase --abort`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch {
      /* abort failed — nothing more to do */
    }
    return 'conflict';
  }
}
