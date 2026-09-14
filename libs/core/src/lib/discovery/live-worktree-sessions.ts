import { existsSync } from 'node:fs';
import {
  sanitizeTmuxSessionName,
  tmuxListSessionsDetailed,
  type TmuxSessionInfo,
} from '@kirby/terminal-tmux';
import type { AppConfig } from '@kirby/vcs-core';
import { projectKey } from '@kirby/vcs-core';
import { branchToSessionName } from '@kirby/worktree-manager';
import { resolveTerminalBackend } from '../session-backend.js';
import { parseTerminalSessionName } from '../terminal/terminal-name.js';
import { KIRBY_TMUX_PREFIX, ORCHESTRA_TAG } from '../tmux-namespace.js';
import {
  describeWorktreePath,
  readWorktreeHead,
  type WorktreeHead,
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
  /** The main checkout the worktree belongs to — real path, as `git
   *  rev-parse --show-toplevel` prints it: from the session's
   *  `@orchestra-repo` tag, or from git for a session without one. */
  repoRoot: string;
  /** The branch checked out in the worktree *now*, from its HEAD, not
   *  the one the session was spawned under. */
  branch: string;
  /** `branch` is the directory's name because no branch is checked
   *  out — see `WorktreeOrigin.detached`. */
  detached: boolean;
  /** The registry name the session runs under in its repository
   *  (`branchToSessionName`), the key its tab's auto-open history uses. */
  sessionName: string;
  /** Orchestra's tags, when the session carries them — see
   *  `ORCHESTRA_TAG`. The harness running in the pane. */
  agent?: string;
  /** The player's reporting target, `codex:<id>` or `tmux:<session>`. */
  orchestrator?: string;
  /** `<KIND> <ISO-8601 UTC>` of the last report the player delivered. */
  lastReport?: string;
}

/** Every tag the listing asks tmux for, in the one fork. */
const LISTED_TAGS = [
  ORCHESTRA_TAG.repo,
  ORCHESTRA_TAG.branch,
  ORCHESTRA_TAG.agent,
  ORCHESTRA_TAG.orchestrator,
  ORCHESTRA_TAG.lastReport,
];

/**
 * What was last learned about each listed directory — from its
 * session's tags, or from git.
 *
 * Describing a directory through git is three blocking forks on the
 * main process, and this listing is polled. An origin is trusted for as long
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
  readHead?: (path: string) => WorktreeHead | null;
}

/**
 * The origin of a session that carries its provenance, or `null` when
 * it does not and git has to be asked: a session from before the
 * convention has neither tag, and half a provenance is treated as
 * none. The tags settle the repository and spare the git forks; the
 * branch is read from the worktree's HEAD file, which is not a fork.
 * `@orchestra-branch` says what the session was *spawned* under, and
 * a worktree that has since checked out another branch is the orphan
 * case — the name composed from HEAD's answer no longer matches, and
 * the session is left out exactly as it would be with git. A HEAD that
 * cannot be read is left to git, which answers `null` for a directory
 * that is gone.
 */
function taggedOrigin(
  { path, options }: TmuxSessionInfo,
  deps: Required<LiveWorktreeSessionDeps>
): WorktreeOrigin | null {
  const repoRoot = options?.[ORCHESTRA_TAG.repo];
  if (!repoRoot || !options?.[ORCHESTRA_TAG.branch] || !deps.exists(path)) {
    return null;
  }
  const head = deps.readHead(path);
  return head ? { repoRoot, ...head } : null;
}

/**
 * The origin of `session.path` if the session is that worktree's —
 * from the cache when the directory is still there and the name still
 * composes from what was cached, from the session's tags or git
 * otherwise.
 */
function matchingOrigin(
  session: TmuxSessionInfo,
  deps: Required<LiveWorktreeSessionDeps>
): WorktreeOrigin | null {
  const { name, path } = session;
  const cached = origins.get(path);
  if (cached && deps.exists(path) && composedName(cached) === name) {
    return cached;
  }
  const origin = taggedOrigin(session, deps) ?? deps.describe(path);
  if (!origin) {
    origins.delete(path);
    return null;
  }
  origins.set(path, origin);
  return composedName(origin) === name ? origin : null;
}

/** Orchestra's own tags, carried along when set. */
function orchestraFields(
  options: Record<string, string> | undefined
): Pick<LiveWorktreeSession, 'agent' | 'orchestrator' | 'lastReport'> {
  const agent = options?.[ORCHESTRA_TAG.agent];
  const orchestrator = options?.[ORCHESTRA_TAG.orchestrator];
  const lastReport = options?.[ORCHESTRA_TAG.lastReport];
  return {
    ...(agent ? { agent } : {}),
    ...(orchestrator ? { orchestrator } : {}),
    ...(lastReport ? { lastReport } : {}),
  };
}

/**
 * List them. Empty when tmux is not the backend in force — the same
 * gate the scanner uses, read from the config handed in — or there is
 * no server.
 *
 * A session counts only when everything agrees: its name is not a
 * terminal tab's, its directory still exists and is a worktree, and the
 * name is exactly what Kirby composes for that worktree's repository
 * and the branch its HEAD is on now — the repository from the
 * session's `@orchestra-repo` tag, or from git for a session that
 * carries no provenance. A name that no longer matches its directory's
 * branch is an agent that checked out something else mid-session — the
 * orphan case, left to the scanner of its own repository, which
 * surfaces it as a terminal tab there — whichever way the origin was
 * learned. Never throws.
 */
export function listLiveWorktreeSessions(
  config: Pick<AppConfig, 'terminalBackend'>,
  deps: LiveWorktreeSessionDeps = {}
): LiveWorktreeSession[] {
  if (resolveTerminalBackend(config) !== 'tmux') return [];
  let live: TmuxSessionInfo[];
  try {
    live = tmuxListSessionsDetailed(LISTED_TAGS);
  } catch {
    return [];
  }
  const resolved = {
    describe: deps.describe ?? describeWorktreePath,
    exists: deps.exists ?? existsSync,
    readHead: deps.readHead ?? readWorktreeHead,
  };
  const candidates = live.filter(isWorktreeCandidate);
  evictUnlisted(new Set(candidates.map((c) => c.path)));
  const found: LiveWorktreeSession[] = [];
  for (const session of candidates) {
    const origin = matchingOrigin(session, resolved);
    if (!origin) continue;
    found.push({
      tmuxName: session.name,
      path: session.path,
      repoRoot: origin.repoRoot,
      branch: origin.branch,
      detached: origin.detached,
      sessionName: branchToSessionName(origin.branch),
      ...orchestraFields(session.options),
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
