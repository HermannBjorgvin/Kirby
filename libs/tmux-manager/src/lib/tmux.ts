/**
 * Tmux command wrappers.
 *
 * All operations are synchronous for simpler calling code.
 * Hot-path I/O (capturePane, sendKeys, sendLiteral) lives in
 * ControlConnection (tmux-control library) instead.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TmuxSession {
  name: string;
  windows: number;
  created: number;
  attached: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string; // short branch name (no refs/heads/)
  bare: boolean;
}

/** Check if tmux is installed and available */
export function isAvailable(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** List all tmux sessions */
export function listSessions(): TmuxSession[] {
  try {
    const output = execSync(
      "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}'",
      { encoding: "utf8" }
    );
    return parseSessions(output);
  } catch {
    return [];
  }
}

/** Parse tmux list-sessions output */
export function parseSessions(output: string): TmuxSession[] {
  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, windows, created, attached] = line.split("|");
      return {
        name: name!,
        windows: parseInt(windows!, 10),
        created: parseInt(created!, 10),
        attached: attached === "1",
      };
    });
}

/** Check if a session with the given name exists */
export function hasSession(name: string): boolean {
  const safeName = validateSessionName(name);
  try {
    execSync(`tmux has-session -t ${safeName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Create a new detached tmux session */
export function createSession(
  name: string,
  cols?: number,
  rows?: number,
  command?: string,
  cwd?: string
): boolean {
  const safeName = validateSessionName(name);
  let cmd = `tmux new-session -d -s ${safeName}`;
  if (cols !== undefined) cmd += ` -x ${cols}`;
  if (rows !== undefined) cmd += ` -y ${rows}`;
  if (cwd !== undefined) cmd += ` -c "${cwd}"`;
  if (command !== undefined) cmd += ` ${command}`;
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session */
export function killSession(name: string): boolean {
  const safeName = validateSessionName(name);
  try {
    execSync(`tmux kill-session -t ${safeName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Convert a git branch name to a valid tmux session name (replace / with -) */
export function branchToSessionName(branch: string): string {
  return branch.replace(/\//g, "-");
}

/**
 * Create a git worktree for a branch.
 * If the branch exists, checks it out. If not, creates a new branch from HEAD.
 * Returns the worktree path on success, null on failure.
 */
export function createWorktree(branch: string): string | null {
  const relativeDir = ".tui/worktrees/" + branch.replace(/\//g, "-");
  const absoluteDir = resolve(process.cwd(), relativeDir);

  // Worktree already exists — just return the path
  if (existsSync(relativeDir)) {
    return absoluteDir;
  }

  try {
    // Try existing branch first
    execSync(`git worktree add "${relativeDir}" "${branch}"`, {
      encoding: "utf8",
      stdio: "pipe",
    });
    return absoluteDir;
  } catch {
    try {
      // Branch doesn't exist — create new branch from HEAD
      execSync(`git worktree add -b "${branch}" "${relativeDir}"`, {
        encoding: "utf8",
        stdio: "pipe",
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
  const relativeDir = ".tui/worktrees/" + branch.replace(/\//g, "-");
  try {
    execSync(`git worktree remove "${relativeDir}"`, {
      encoding: "utf8",
      stdio: "pipe",
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
    branch === "main" ||
    branch === "master" ||
    branch.startsWith("gitbutler")
  ) {
    return { safe: false, reason: "protected branch" };
  }

  const worktreeDir = ".tui/worktrees/" + branch.replace(/\//g, "-");

  // Uncommitted changes
  try {
    const status = execSync(`git -C "${worktreeDir}" status --porcelain`, {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (status.trim().length > 0) {
      return { safe: false, reason: "uncommitted changes" };
    }
  } catch {
    // Worktree may not exist — skip this check
  }

  // Not pushed to upstream
  try {
    const unpushed = execSync(
      `git log "${branch}" --not --remotes -1`,
      { encoding: "utf8", stdio: "pipe" }
    );
    if (unpushed.trim().length > 0) {
      return { safe: false, reason: "not pushed to upstream" };
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
      encoding: "utf8",
    });
    return output
      .trim()
      .split("\n")
      .filter((b) => b.length > 0);
  } catch {
    return [];
  }
}

/** Parse `git worktree list --porcelain` output into WorktreeInfo[] */
export function parseWorktrees(output: string): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  const blocks = output.split("\n\n").filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let path = "";
    let branch = "";
    let bare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length);
      } else if (line === "bare") {
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
    const output = execSync("git worktree list --porcelain", {
      encoding: "utf8",
    });
    return parseWorktrees(output).filter(
      (w) => !w.bare && w.path.includes(".tui/worktrees/")
    );
  } catch {
    return [];
  }
}

/** Validate a tmux session name (alphanumeric, hyphens, underscores, dots) */
function validateSessionName(name: string): string {
  if (/^[a-zA-Z0-9._-]+$/.test(name)) {
    return name;
  }
  throw new Error(`Invalid tmux session name: ${name}`);
}
