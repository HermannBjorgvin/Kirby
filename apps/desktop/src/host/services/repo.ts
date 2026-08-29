import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  readConfig,
  isVcsConfigured,
  autoDetectProjectConfig,
  type AppConfig,
} from '@kirby/vcs-core';
import {
  createTemplateResolver,
  resetWorktreeResolver,
  setWorktreeResolver,
} from '@kirby/worktree-manager';
import {
  applySessionBackend,
  getRepoRoot,
  getTmuxAvailability,
  resetRepoRoot,
} from '@kirby/core';
import { githubProvider } from '@kirby/vcs-github';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import type { VcsProvider } from '@kirby/vcs-core';
import { NoActiveRepoError, type RepoInfo } from '../contract.js';
import {
  loadRecents,
  forgetRecent,
  recordOpen,
  saveRecents,
  type RecentRepo,
} from './recent-repos.js';

export const PROVIDERS: VcsProvider[] = [githubProvider, azureDevOpsProvider];

let activeCwd: string | null = null;

// Installed by main.ts; runs after a repo is (re)opened. Lets the
// shell start per-repo background work (the remote sync loop) without
// a service-level import cycle.
let repoOpenedListener: ((cwd: string) => void) | null = null;

export function setRepoOpenedListener(fn: (cwd: string) => void): void {
  repoOpenedListener = fn;
}

/** True when the directory exists and looks like a git repo. */
export function isGitRepo(cwd: string): boolean {
  try {
    // A worktree or submodule has a .git *file* pointing at the real
    // git dir, so both shapes count. Checking `isDirectory()` first and
    // handling the file in a catch never worked: statSync succeeds on a
    // file, so it simply returned false and the fallback was
    // unreachable — which refused to open a worktree, in the app whose
    // subject is worktrees.
    const entry = statSync(join(cwd, '.git'));
    return entry.isDirectory() || entry.isFile();
  } catch {
    return false;
  }
}

export function requireRepo(): string {
  if (activeCwd === null) throw new NoActiveRepoError();
  return activeCwd;
}

/** Whether `cwd` is still the open repository. Long, awaiting host work
 *  checks this between steps: opening another repo mid-flight would
 *  otherwise let it finish against the wrong checkout. */
export function activeRepoIs(cwd: string): boolean {
  return activeCwd === cwd;
}

export function openRepo(cwd: string): RepoInfo {
  if (!isGitRepo(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  activeCwd = cwd;
  process.chdir(cwd);
  // The repo root is memoized for the TUI's one-repo-per-process life.
  // Opening another repo in place must invalidate it *before* anything
  // derived from it is rebuilt below, or every tmux session name stays
  // keyed to the first repo — which is how a worktree removal here ends
  // up killing an agent running over there.
  resetRepoRoot();
  try {
    saveRecents(recordOpen(loadRecents(), cwd));
  } catch {
    // Recent-repos bookkeeping must never block opening a repo.
  }
  // Same startup wiring as the TUI's useSessionManager mount:
  // auto-detect provider fields on first open, honor a custom
  // worktreePath template (without it, listWorktrees would only own
  // the default .claude/worktrees dir), and point the session
  // registry at the configured terminal backend.
  try {
    autoDetectProjectConfig(cwd, PROVIDERS);
  } catch {
    // Detection is best-effort; a failing provider probe must not
    // block opening the repo.
  }
  const config = readConfig(cwd);
  if (config.worktreePath) {
    setWorktreeResolver(createTemplateResolver(config.worktreePath, cwd));
  } else {
    resetWorktreeResolver();
  }
  applySessionBackend(config);
  if (config.terminalBackend === 'tmux') {
    // The factory silently degrades to PTY in two cases; make both
    // visible in the dev log so a "why isn't this tmux?" report is
    // diagnosable from the console alone.
    const root = getRepoRoot();
    const tmux = getTmuxAvailability();
    console.log(
      `[desktop] session backend: tmux (repo root: ${
        root ?? 'UNRESOLVED — falling back to pty'
      }; tmux probe: ${
        tmux == null
          ? 'pending'
          : tmux.available
          ? 'available'
          : 'UNAVAILABLE — falling back to pty'
      })`
    );
  } else {
    console.log(
      `[desktop] session backend: ${config.terminalBackend ?? 'pty'}`
    );
  }
  repoOpenedListener?.(cwd);
  const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
  return {
    cwd,
    providerId: provider?.id ?? null,
    vcsConfigured: provider ? isVcsConfigured(config, provider) : false,
  };
}

export function getRepo(): RepoInfo | null {
  if (activeCwd === null) return null;
  const config: AppConfig = readConfig(activeCwd);
  const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
  return {
    cwd: activeCwd,
    providerId: provider?.id ?? null,
    vcsConfigured: provider ? isVcsConfigured(config, provider) : false,
  };
}

/**
 * Startup repo resolution, in priority order:
 *   1. KIRBY_START_DIR (launcher/dev pass the invoking shell's cwd)
 *   2. the most recently opened repo that still exists on disk
 * Falls back to null (repo-open screen) when neither applies.
 */
export function openStartupRepo(
  env: Record<string, string | undefined> = process.env,
  recents: RecentRepo[] = loadRecents()
): RepoInfo | null {
  const startDir = env.KIRBY_START_DIR;
  if (startDir) {
    if (!isGitRepo(startDir)) {
      console.warn(`[desktop] KIRBY_START_DIR is not a git repo: ${startDir}`);
    } else {
      try {
        return openRepo(startDir);
      } catch (err: unknown) {
        console.warn(
          `[desktop] failed to open start dir ${startDir}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  // Restore the last session: newest recent that still validates.
  for (const r of recents) {
    if (!isGitRepo(r.cwd)) continue;
    try {
      console.log(`[desktop] restoring last repo: ${r.cwd}`);
      return openRepo(r.cwd);
    } catch (err: unknown) {
      console.warn(
        `[desktop] failed to restore ${r.cwd}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
}

/**
 * Recently opened repositories, newest first. Each entry is
 * re-validated against the filesystem so dead checkouts render as
 * invalid instead of failing on click.
 */
export function listRecentRepos(): (RecentRepo & { valid: boolean })[] {
  return loadRecents()
    .slice(0, 10)
    .map((r) => ({ ...r, valid: isGitRepo(r.cwd) }));
}

export function forgetRecentRepo(cwd: string): void {
  forgetRecent(cwd);
}
