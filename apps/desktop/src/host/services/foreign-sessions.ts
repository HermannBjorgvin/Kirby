import { realpathSync } from 'node:fs';
import { listLiveWorktreeSessions } from '@kirby/core';
import { readConfig } from '@kirby/vcs-core';
import type { ForeignSessionSummary } from '../contract.js';
import { ensureRecent } from './recent-repos.js';
import { requireRepo } from './repo.js';

/**
 * Agents alive in repositories other than the open one.
 *
 * The host attaches only the open repository's sessions — it is
 * single-repo by construction — but tmux holds every repository's, and
 * a tab strip that spans repositories wants each of them back in its
 * own group after a relaunch. So this lists the rest as strip entries
 * only: repository, branch, session name, nothing attached. Activating
 * one opens its repository, and that repository's own discovery
 * attaches the agent through the normal path.
 *
 * The open repository's own agents are left out: the sidebar describes
 * those, and listing them here as well would open each twice.
 */
export function listForeignSessions(): ForeignSessionSummary[] {
  const open = requireRepo();
  // Identity is the real path — the same string git reports as the
  // toplevel, which is what the core derives a session's repository
  // from — so a repository opened through a symlink still recognises
  // its own agents as its own.
  let openRoot: string;
  try {
    openRoot = realpathSync(open);
  } catch {
    openRoot = open;
  }
  const out: ForeignSessionSummary[] = [];
  for (const live of listLiveWorktreeSessions(readConfig(open))) {
    if (live.repoRoot === openRoot) continue;
    // On the repo list, so the tab's repository can be opened like any
    // other — the same courtesy a restored terminal's repository gets.
    ensureRecent(live.repoRoot);
    out.push({
      repo: live.repoRoot,
      branch: live.branch,
      sessionName: live.sessionName,
    });
  }
  return out;
}
