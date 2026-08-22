import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, isVcsConfigured, type AppConfig } from '@kirby/vcs-core';
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
