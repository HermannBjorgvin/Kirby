/**
 * The pure half of external-session discovery: what one scan saw, and
 * what changed since the last one.
 *
 * Kept apart from the scanner so the interesting decisions — what
 * counts as newly appeared, what is safe to attach to, what has gone
 * away — are testable without git, tmux, timers or a filesystem.
 */

/** One Kirby-owned worktree, as a scan saw it. */
export interface DiscoveredWorktree {
  /** Registry session name — `worktreeSessionName(wt)`. */
  name: string;
  /** Short branch name, or `''` for a detached-HEAD orphan. */
  branch: string;
  /** Absolute path of the checkout. */
  path: string;
}

/** Everything one scan observed about the world outside this process. */
export interface DiscoveryScan {
  /** Every worktree git reports under the resolver's directory. */
  worktrees: DiscoveredWorktree[];
  /** The subset of those names that have a live tmux session belonging
   *  to this repository. Always empty on the PTY backend, which has no
   *  session that outlives the process. */
  persisted: ReadonlySet<string>;
}

/** What changed between two scans. */
export interface DiscoveryDelta {
  /** Worktrees this scan reports that the previous one did not. */
  appeared: DiscoveredWorktree[];
  /** Session names whose worktree is no longer there. */
  disappeared: string[];
  /** External sessions to attach to: a live tmux session this process
   *  holds no live PTY for. */
  adoptable: DiscoveredWorktree[];
  /** Names whose tmux session was there last scan and is not now —
   *  an agent killed from outside, so anything showing it as running
   *  is stale. */
  ended: string[];
  /** True when any of the above is non-empty: the shell's view of
   *  sessions is out of date and should be re-read. */
  changed: boolean;
}

const EMPTY_SCAN: DiscoveryScan = { worktrees: [], persisted: new Set() };

/**
 * Diff two scans.
 *
 * `previous` is `null` for the very first scan of a repository, and
 * that case is deliberately not "everything appeared": both shells load
 * their own worktree list at startup, so announcing the initial set
 * would only buy a redundant refresh. `adoptable` is still computed —
 * it reads absolute state, not the diff — which is what makes the first
 * scan reattach to sessions that survived a previous run.
 *
 * `adoptable` otherwise reads absolute state rather than the diff, so an
 * attach that failed is simply offered again next scan. `suppressed`
 * is how the scanner retires one that has failed too often — and it is
 * taken here, rather than filtered by the caller afterwards, so that
 * `changed` cannot claim there is work to do when every offer has been
 * retired. Announcing on a suppressed name meant a permanently
 * unattachable session refreshed both shells on every tick, forever.
 *
 * `ended` is a set difference over `persisted` rather than a test
 * against the registry, so it stays empty on the PTY backend instead of
 * reporting every live session as ended.
 */
export function diffScans(
  previous: DiscoveryScan | null,
  next: DiscoveryScan,
  isAlive: (name: string) => boolean,
  suppressed: ReadonlySet<string> = new Set()
): DiscoveryDelta {
  const base = previous ?? EMPTY_SCAN;
  const before = new Set(base.worktrees.map((wt) => wt.name));
  const now = new Set(next.worktrees.map((wt) => wt.name));

  const appeared =
    previous === null ? [] : next.worktrees.filter((wt) => !before.has(wt.name));
  const disappeared = [...before].filter((name) => !now.has(name));
  const adoptable = next.worktrees.filter(
    (wt) =>
      next.persisted.has(wt.name) &&
      !isAlive(wt.name) &&
      !suppressed.has(wt.name)
  );
  const ended = [...base.persisted].filter((name) => !next.persisted.has(name));

  return {
    appeared,
    disappeared,
    adoptable,
    ended,
    changed:
      appeared.length > 0 ||
      disappeared.length > 0 ||
      adoptable.length > 0 ||
      ended.length > 0,
  };
}
