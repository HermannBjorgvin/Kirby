import { resolve as pathResolve } from 'node:path';
import { exec } from './exec.js';

export function sanitizeBranch(branch: string): string {
  return branch.replace(/\//g, '-');
}

export interface WorktreeResolver {
  pathFor(branch: string): string;
  owns(worktreePath: string): boolean;
}

export async function createResolver(
  configOverride?: string
): Promise<WorktreeResolver> {
  // 1. Config override
  if (configOverride) {
    return templateResolver(configOverride);
  }

  // 2. Bare repo detection
  try {
    const { stdout: isBare } = await exec(
      'git rev-parse --is-bare-repository',
      { encoding: 'utf8' }
    );
    if (isBare.trim() === 'true') {
      const { stdout: gitDir } = await exec('git rev-parse --git-common-dir', {
        encoding: 'utf8',
      });
      const bareRoot = pathResolve(gitDir.trim());
      return {
        pathFor: (branch) => pathResolve(bareRoot, sanitizeBranch(branch)),
        owns: (p) => p.startsWith(bareRoot) && p !== bareRoot,
      };
    }
  } catch {
    // Not a git repo or git not available
  }

  // 3. Default: .kirby/worktrees/
  const base = pathResolve(process.cwd(), '.kirby/worktrees');
  return {
    pathFor: (branch) => pathResolve(base, sanitizeBranch(branch)),
    owns: (p) => p.includes('.kirby/worktrees/'),
  };
}

function templateResolver(template: string): WorktreeResolver {
  const isAbsolute = template.startsWith('/');
  const base = isAbsolute ? '' : process.cwd();
  return {
    pathFor: (branch) => {
      const expanded = template.replace('{branch}', sanitizeBranch(branch));
      return isAbsolute ? expanded : pathResolve(base, expanded);
    },
    owns: () => true,
  };
}
