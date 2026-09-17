import { execFileSync } from 'node:child_process';

/** Resolve the git toplevel of the repo n10 is running in, or `null`
 *  when there isn't one (launched outside a working tree, `git` missing
 *  from PATH). Cached on first call — including the `null` — because
 *  the TUI is anchored to one repo for its whole process.
 *
 *  The desktop is not: it can open another repository in place, and
 *  must call {@link resetRepoRoot} when it does. This value is the
 *  `@orchestra-repo` every tmux session is identified by, so a stale
 *  root makes two repos that share a branch name resolve to the *same*
 *  tmux session — attaching to, and killing, the other repo's live
 *  agent.
 *
 *  git's stderr is swallowed rather than inherited: a bare "fatal: not
 *  a git repository" written straight to the terminal would land in the
 *  middle of Ink's frame and corrupt the render. */
let cachedRepoRoot: string | null = null;
let repoRootResolved = false;

/** Drop the memoized repo root so the next {@link getRepoRoot} re-runs
 *  `git rev-parse` against the current working directory. Call after
 *  changing which repository the process is pointed at. */
export function resetRepoRoot(): void {
  cachedRepoRoot = null;
  repoRootResolved = false;
}

export function getRepoRoot(): string | null {
  if (repoRootResolved) return cachedRepoRoot;
  repoRootResolved = true;
  try {
    cachedRepoRoot =
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null;
  } catch {
    cachedRepoRoot = null;
  }
  return cachedRepoRoot;
}
