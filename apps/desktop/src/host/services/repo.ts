import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, isVcsConfigured, type AppConfig } from '@kirby/vcs-core';
import { githubProvider } from '@kirby/vcs-github';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import type { VcsProvider } from '@kirby/vcs-core';
import { NoActiveRepoError, type RepoInfo } from '../contract.js';

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
