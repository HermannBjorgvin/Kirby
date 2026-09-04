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

/**
 * Put a path into the form `owns()` compares in.
 *
 * On Windows the two sides arrive in different shapes: `path.resolve`
 * produces backslashes (`C:\repo\.claude\worktrees`) while
 * `git worktree list --porcelain` reports forward slashes
 * (`C:/repo/.claude/worktrees/foo`), so a literal comparison never
 * matches and every worktree looks unowned. Case is folded too, since
 * the same checkout can be reported under either drive-letter case.
 *
 * Off Windows this is the identity function, deliberately: `\` is a
 * legal character in a POSIX directory name, so rewriting separators
 * there could make two genuinely distinct paths compare equal, and
 * POSIX paths are case-sensitive.
 */
const normalizePath = (p: string): string =>
  process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p;

/** Shared membership test: is `p` the base directory or inside it? */
const isUnder = (p: string, baseDir: string): boolean => {
  const base = normalizePath(baseDir);
  const target = normalizePath(p);
  return target === base || target.startsWith(base + '/');
};

const defaultResolver: WorktreeResolver = {
  dir: (branch) => '.claude/worktrees/' + branchToSessionName(branch),
  owns: (p) => isUnder(p, defaultResolver.base()),
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
    owns: (p) => isUnder(p, baseDir),
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
