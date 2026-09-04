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

/** How long a path's description is trusted before git is asked again.
 *  A worktree's repository never changes and its branch rarely does;
 *  three forks per session per listing would otherwise be paid every
 *  poll. */
const ORIGIN_TTL_MS = 30_000;

const origins = new Map<
  string,
  { at: number; origin: WorktreeOrigin | null }
>();

function originOf(
  path: string,
  describe: (path: string) => WorktreeOrigin | null,
  now: number
): WorktreeOrigin | null {
  const cached = origins.get(path);
  if (cached && now - cached.at < ORIGIN_TTL_MS) return cached.origin;
  const origin = describe(path);
  origins.set(path, { at: now, origin });
  return origin;
}

/** Drop what was learned about every path. Tests only. */
export function __resetLiveWorktreeSessionsForTests(): void {
  origins.clear();
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
  describe: (path: string) => WorktreeOrigin | null = describeWorktreePath,
  now: number = Date.now()
): LiveWorktreeSession[] {
  if (resolveTerminalBackend(config) !== 'tmux') return [];
  let live: { name: string; path: string }[];
  try {
    live = tmuxListSessionsDetailed();
  } catch {
    return [];
  }
  const found: LiveWorktreeSession[] = [];
  for (const { name, path } of live) {
    if (!name.startsWith(KIRBY_TMUX_PREFIX) || parseTerminalSessionName(name)) {
      continue;
    }
    if (!path) continue;
    const origin = originOf(path, describe, now);
    if (!origin) continue;
    const sessionName = branchToSessionName(origin.branch);
    const composed = sanitizeTmuxSessionName(
      `${KIRBY_TMUX_PREFIX}${projectKey(origin.repoRoot)}-${sessionName}`
    );
    if (composed !== name) continue;
    found.push({
      tmuxName: name,
      path,
      repoRoot: origin.repoRoot,
      branch: origin.branch,
      sessionName,
    });
  }
  return found;
}
