/**
 * Where a terminal belongs, and how its directory reads on a tab.
 *
 * Pure, so the rules can be pinned without a filesystem: the caller
 * supplies the "is this a repository root" test (the host's
 * `isGitRepo`, the same check opening a repository makes).
 */

/** `cwd` without a trailing separator, so a picker's `/repo/` and the
 *  workspace's `/repo` name the same repository. The root keeps its
 *  one slash. */
function normalized(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  return trimmed === '' ? cwd : trimmed;
}

/**
 * Canonicalize a folder the native picker returned, so a symlink into
 * an already-open repository resolves to the same path `getRepoRoot()`
 * (which follows symlinks via `git rev-parse`) would give it. Without
 * this, `terminalRepo` compares the picked path against the open
 * repository's root as plain strings, and a symlink reads as a second
 * repository rather than the one already open.
 *
 * `realpath` is injected so this is testable without touching the
 * filesystem, and the raw path is kept when it throws — a permission
 * error, or the directory vanishing between the pick and this call —
 * since a terminal opening on the path the user actually picked beats
 * refusing the launch.
 */
export function resolvePickedFolder(
  path: string,
  realpath: (p: string) => string
): string {
  try {
    return realpath(path);
  } catch {
    return path;
  }
}

/**
 * The repository a terminal in `cwd` belongs to: `cwd` itself when it
 * is a repository root, `null` otherwise.
 *
 * Only `cwd` is asked about. A folder inside a checkout is a plain
 * folder — nothing walks up to find the root — so a terminal opened
 * in `repo/apps/x` sits in the repo-less group rather than being
 * quietly filed under `repo`.
 */
export function terminalRepo(
  cwd: string,
  isRepoRoot: (path: string) => boolean
): string | null {
  const dir = normalized(cwd);
  return isRepoRoot(dir) ? dir : null;
}

/** `cwd` with the home directory written as `~`, at a path boundary
 *  only — `/home/developer` is not inside `/home/dev`. */
export function displayPath(cwd: string, home: string): string {
  if (!home) return cwd;
  const base = normalized(home);
  if (cwd === base) return '~';
  return cwd.startsWith(base + '/') ? `~${cwd.slice(base.length)}` : cwd;
}
