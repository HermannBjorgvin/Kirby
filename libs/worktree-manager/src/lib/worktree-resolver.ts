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
  /**
   * True if this absolute worktree path belongs to this resolver.
   *
   * `cwd` names the repository to judge membership of. Omitting it
   * means the process's directory, which is the open repository and
   * what every long-standing caller wants. A caller acting on a
   * repository it was handed — one that must survive the desktop
   * `chdir`-ing elsewhere between its awaits — passes it explicitly.
   */
  owns(absolutePath: string, cwd?: string): boolean;
  /**
   * The absolute directory every owned worktree sits under — the root
   * `owns()` is testing membership of.
   *
   * Exposed because a caller that wants to be told when a worktree
   * appears needs somewhere to point a watcher, and the alternative is
   * recursing a checkout. It may not exist on disk yet: nothing
   * creates it until the first worktree is made.
   *
   * `cwd` is resolved against as in {@link owns}. An absolute template
   * ignores it, which is correct: that base is the same directory
   * whichever repository is asking.
   */
  base(cwd?: string): string;
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
  owns: (p, cwd) => isUnder(p, defaultResolver.base(cwd)),
  // Resolved per call, not captured: the default resolver is the one
  // in force before anything has told Kirby which repo it is in, and
  // the desktop chdir()s into a repo after that point.
  base: (cwd = process.cwd()) => resolve(cwd, '.claude/worktrees'),
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
  // The template is kept, not just the directory it resolved to at
  // creation: a relative one names a different directory in each
  // repository (`../{session}` is a sibling of whichever checkout is
  // asking), so a caller naming its own repository has to re-resolve.
  // An absolute template resolves to itself whatever `cwd` is.
  const baseFor = (at?: string) => resolve(at ?? cwd, baseTemplate);

  return {
    dir: (branch) =>
      template
        .replace('{branch}', branch)
        .replace('{session}', branchToSessionName(branch)),
    owns: (p, at) => isUnder(p, baseFor(at)),
    base: (at) => baseFor(at),
  };
}

/** Convert a branch name to its worktree relative directory */
export function worktreeDir(branch: string): string {
  return activeResolver.dir(branch);
}

/**
 * True if this absolute worktree path is one Kirby manages, judged
 * against `cwd`'s repository (the process's directory when omitted).
 */
export function ownsWorktreePath(absolutePath: string, cwd?: string): boolean {
  return activeResolver.owns(absolutePath, cwd);
}

/** The absolute directory Kirby's worktrees live under, per the
 *  resolver in force. May not exist yet. */
export function worktreesBasePath(cwd?: string): string {
  return activeResolver.base(cwd);
}
