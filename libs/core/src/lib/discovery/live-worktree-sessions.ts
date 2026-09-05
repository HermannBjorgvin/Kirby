import { existsSync } from 'node:fs';
import {
  sanitizeTmuxSessionName,
  tmuxListSessionsDetailed,
} from '@kirby/terminal-tmux';
import type { AppConfig } from '@kirby/vcs-core';
import { projectKey } from '@kirby/vcs-core';
import { branchToSessionName } from '@kirby/worktree-manager';
import { resolveTerminalBackend } from '../session-backend.js';
import { parseTerminalSessionName } from '../terminal/terminal-name.js';
import { KIRBY_TMUX_PREFIX } from '../tmux-namespace.js';
import {
  describeWorktreePath,
  type WorktreeOrigin,
} from './worktree-origin.js';

/**
 * Every worktree agent session alive in tmux, whichever repository it
 * belongs to.
 *
 * The scanner in `session-discovery.ts` answers for the open repository
 * only — its prefix is that repo's, and it attaches what it finds. This
 * is the wider question a tab strip that spans repositories asks at
 * launch: which agents are running *anywhere*, so each can have its
 * tab back in its own group without being attached to. The tmux server
 * is the whole record: the name says it is Kirby's, `session_path` is
 * the worktree, and git says which repository and branch that is.
 */
export interface LiveWorktreeSession {
  /** The tmux session name, `kirby-<projectKey>-<branch>`. */
  tmuxName: string;
  /** The worktree directory, from tmux. */
  path: string;
  /** The main checkout the worktree belongs to — real path. */
  repoRoot: string;
  branch: string;
  /** The registry name the session runs under in its repository
   *  (`branchToSessionName`), the key its tab's auto-open history uses. */
  sessionName: string;
}

/**
 * What git last said about each listed directory.
 *
 * Describing a directory is three blocking git forks on the main
 * process, and this listing is polled. An origin is trusted for as long
 * as the directory still exists and the session's name still composes
 * from it: a worktree's repository never changes, and its branch
 * changes only when something checks another one out — which shows as
 * the name no longer matching, the one case git is asked again. A
 * failure is never remembered (a transient `index.lock` would otherwise
 * hide a session until the entry aged out), and the map is bounded to
 * the paths tmux currently lists, so it cannot grow with every session
 * that ever ran. No clock: nothing here expires by time.
 */
const origins = new Map<string, WorktreeOrigin>();

/** Drop what was learned about every path. Tests only. */
export function __resetLiveWorktreeSessionsForTests(): void {
  origins.clear();
}

/** The tmux name Kirby composes for a worktree of this origin. */
function composedName(origin: WorktreeOrigin): string {
  return sanitizeTmuxSessionName(
    `${KIRBY_TMUX_PREFIX}${projectKey(origin.repoRoot)}-${branchToSessionName(
      origin.branch
    )}`
  );
}

/** The seams a listing depends on, injectable for tests. */
export interface LiveWorktreeSessionDeps {
  describe?: (path: string) => WorktreeOrigin | null;
  exists?: (path: string) => boolean;
}

/**
 * The origin of `path` if a session named `name` is that worktree's —
 * from the cache when the directory is still there and the name still
 * composes from what was cached, from git otherwise.
 */
function matchingOrigin(
  name: string,
  path: string,
  deps: Required<LiveWorktreeSessionDeps>
): WorktreeOrigin | null {
  const cached = origins.get(path);
  if (cached && deps.exists(path) && composedName(cached) === name) {
    return cached;
  }
  const origin = deps.describe(path);
  if (!origin) {
    origins.delete(path);
    return null;
  }
  origins.set(path, origin);
  return composedName(origin) === name ? origin : null;
}

/**
 * List them. Empty when tmux is not the backend in force — the same
 * gate the scanner uses, read from the config handed in — or there is
 * no server.
 *
 * A session counts only when everything agrees: its name is not a
 * terminal tab's, its directory still exists and is a worktree, and the
 * name is exactly what Kirby composes for that worktree's repository
 * and branch. A name that no longer matches its directory's branch is
 * an agent that checked out something else mid-session — the orphan
 * case, left to the scanner of its own repository, which surfaces it
 * as a terminal tab there. Never throws.
 */
export function listLiveWorktreeSessions(
  config: Pick<AppConfig, 'terminalBackend'>,
  deps: LiveWorktreeSessionDeps = {}
): LiveWorktreeSession[] {
  if (resolveTerminalBackend(config) !== 'tmux') return [];
  let live: { name: string; path: string }[];
  try {
    live = tmuxListSessionsDetailed();
  } catch {
    return [];
  }
  const resolved = {
    describe: deps.describe ?? describeWorktreePath,
    exists: deps.exists ?? existsSync,
  };
  const candidates = live.filter(isWorktreeCandidate);
  evictUnlisted(new Set(candidates.map((c) => c.path)));
  const found: LiveWorktreeSession[] = [];
  for (const { name, path } of candidates) {
    const origin = matchingOrigin(name, path, resolved);
    if (!origin) continue;
    found.push({
      tmuxName: name,
      path,
      repoRoot: origin.repoRoot,
      branch: origin.branch,
      sessionName: branchToSessionName(origin.branch),
    });
  }
  return found;
}

/** A Kirby session that is not a terminal tab and has a directory to
 *  be asked about. */
function isWorktreeCandidate({
  name,
  path,
}: {
  name: string;
  path: string;
}): boolean {
  return (
    name.startsWith(KIRBY_TMUX_PREFIX) &&
    !parseTerminalSessionName(name) &&
    path !== ''
  );
}

/** Keep the cache to the directories tmux lists right now. */
function evictUnlisted(listed: ReadonlySet<string>): void {
  for (const path of [...origins.keys()]) {
    if (!listed.has(path)) origins.delete(path);
  }
}
