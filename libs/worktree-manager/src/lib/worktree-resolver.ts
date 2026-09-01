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
  /**
   * The absolute directory every owned worktree sits under — the root
   * `owns()` is testing membership of.
   *
   * Exposed because a caller that wants to be told when a worktree
   * appears needs somewhere to point a watcher, and the alternative is
   * recursing a checkout. It may not exist on disk yet: nothing
   * creates it until the first worktree is made.
   */
  base(): string;
}

const defaultResolver: WorktreeResolver = {
  dir: (branch) => '.claude/worktrees/' + branchToSessionName(branch),
  owns: (p) => {
    const base = defaultResolver.base();
    return p === base || p.startsWith(base + '/');
  },
  // Resolved per call, not captured: the default resolver is the one
  // in force before anything has told Kirby which repo it is in, and
  // the desktop chdir()s into a repo after that point.
  base: () => resolve(process.cwd(), '.claude/worktrees'),
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
    base: () => baseDir,
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

/** The absolute directory Kirby's worktrees live under, per the
 *  resolver in force. May not exist yet. */
export function worktreesBasePath(): string {
  return activeResolver.base();
}
