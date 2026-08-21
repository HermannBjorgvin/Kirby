import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, isVcsConfigured, type AppConfig } from '@kirby/vcs-core';
import { githubProvider } from '@kirby/vcs-github';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import type { VcsProvider } from '@kirby/vcs-core';
import { NoActiveRepoError, type RepoInfo } from '../contract.js';
import {
  loadRecents,
  forgetRecent as forgetRecentOnDisk,
  recordOpen,
  saveRecents,
  type RecentRepo,
} from './recent-repos.js';

export const PROVIDERS: VcsProvider[] = [githubProvider, azureDevOpsProvider];

let activeCwd: string | null = null;

/** True when the directory exists and looks like a git repo. */
export function isGitRepo(cwd: string): boolean {
  try {
    return statSync(join(cwd, '.git')).isDirectory();
  } catch {
    // Worktrees/submodules have a .git *file* pointing at the real dir.
    try {
      return statSync(join(cwd, '.git')).isFile();
    } catch {
      return false;
    }
  }
}

export function requireRepo(): string {
  if (activeCwd === null) throw new NoActiveRepoError();
  return activeCwd;
}

export function openRepo(cwd: string): RepoInfo {
  if (!isGitRepo(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  activeCwd = cwd;
  process.chdir(cwd);
  try {
    saveRecents(recordOpen(loadRecents(), cwd));
  } catch {
    // Recent-repos bookkeeping must never block opening a repo.
  }
  const config = readConfig(cwd);
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
 * Launching `kirby-desktop` inside a repository should open that
 * repository immediately. Reads KIRBY_START_DIR (set by the launcher
 * and dev script from the invoking shell's cwd) and opens it when it
 * is a valid repo; any failure silently leaves the app on the
 * repo-open screen.
 */
export function autoOpenStartDir(
  env: Record<string, string | undefined> = process.env
): RepoInfo | null {
  const startDir = env.KIRBY_START_DIR;
  if (!startDir) return null;
  if (!isGitRepo(startDir)) {
    console.warn(`[desktop] KIRBY_START_DIR is not a git repo: ${startDir}`);
    return null;
  }
  try {
    return openRepo(startDir);
  } catch (err: unknown) {
    console.warn(
      `[desktop] failed to open start dir ${startDir}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
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
  forgetRecentOnDisk(cwd);
}
