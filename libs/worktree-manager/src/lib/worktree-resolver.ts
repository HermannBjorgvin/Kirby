/**
 * Where a worktree for a branch lives on disk.
 *
 * The resolver is process-wide state because it is a property of the
 * open repository, not of any one call: Kirby detects the project's
 * worktree template once at open and every later `createWorktree` /
 * `listWorktrees` has to agree about which directories are Kirby's.
 */
import { resolve } from 'node:path';
import { branchToSessionName } from './refs.js';

export interface WorktreeResolver {
  /** Relative path for a new worktree for this branch */
  dir(branch: string): string;
  /** True if this absolute worktree path belongs to this resolver */
  owns(absolutePath: string): boolean;
}

const defaultResolver: WorktreeResolver = {
  dir: (branch) => '.claude/worktrees/' + branchToSessionName(branch),
  owns: (p) => {
    const base = resolve(process.cwd(), '.claude/worktrees');
    return p === base || p.startsWith(base + '/');
  },
};

let activeResolver: WorktreeResolver = defaultResolver;

export function setWorktreeResolver(r: WorktreeResolver): void {
  activeResolver = r;
}

export function resetWorktreeResolver(): void {
  activeResolver = defaultResolver;
}

export function createTemplateResolver(
  template: string,
  cwd = process.cwd()
): WorktreeResolver {
  const baseTemplate =
    template.replace(/\/?\{(?:branch|session)\}.*$/, '') || '.';
  const baseDir = resolve(cwd, baseTemplate);

  return {
    dir: (branch) =>
      template
        .replace('{branch}', branch)
        .replace('{session}', branchToSessionName(branch)),
    owns: (p) => p === baseDir || p.startsWith(baseDir + '/'),
  };
}

/** Convert a branch name to its worktree relative directory */
export function worktreeDir(branch: string): string {
  return activeResolver.dir(branch);
}

/** True if this absolute worktree path is one Kirby manages. */
export function ownsWorktreePath(absolutePath: string): boolean {
  return activeResolver.owns(absolutePath);
}
