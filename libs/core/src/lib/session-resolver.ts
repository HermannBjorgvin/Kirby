import { tmuxListSessionsDetailed } from '@kirby/terminal-tmux';
import {
  isTerminalSession,
  isWorktreeSessionFor,
  LISTED_TAGS,
  registryNameOf,
  taggedSession,
  type TaggedSession,
} from './session-identity.js';

/**
 * The one way a tmux session is found: one `tmux -u list-sessions -F`
 * fork, matched client-side on its tags (never `list-sessions -f`,
 * which is tmux 3.1 and the floor is 2.0; never a composed name).
 * Every attach, exists, kill, adopt and listing in core goes through
 * here, so the rule that an untagged session is foreign is enforced in
 * one place. Never throws: no server, or no tmux, is an empty listing.
 */

/** Every session on the server that carries our tags, in tmux's
 *  listing order. */
export function listOurSessions(): TaggedSession[] {
  let listed;
  try {
    listed = tmuxListSessionsDetailed(LISTED_TAGS);
  } catch {
    return [];
  }
  const ours: TaggedSession[] = [];
  for (const info of listed) {
    const session = taggedSession(info);
    if (session) ours.push(session);
  }
  return ours;
}

/** The oldest of several sessions, by tmux's creation time. More than
 *  one session for an identity should not happen; when it does, the
 *  one that was there first is the one everything acts on, and the
 *  others are left where they are — listed, never silently killed. */
function oldest(sessions: TaggedSession[]): TaggedSession | null {
  let best: TaggedSession | null = null;
  for (const session of sessions) {
    if (!best || session.created < best.created) best = session;
  }
  return best;
}

/** The worktree session for (repo, branch), or `null`. */
export function resolveWorktreeSession(
  repoRoot: string,
  branch: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return oldest(
    sessions.filter((s) => isWorktreeSessionFor(s, repoRoot, branch))
  );
}

/** The terminal tab (`shell` or `agent`) with exactly this name, or
 *  `null`. A terminal belongs to its directory, not to the repository
 *  that happens to be open, so the repo tag is not part of the match:
 *  the name alone is unique on the server. */
export function resolveTerminalSession(
  name: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return sessions.find((s) => isTerminalSession(s) && s.name === name) ?? null;
}

/**
 * The session a PTY-registry key names in this repository: a worktree
 * session whose branch keys to it, else a terminal tab called exactly
 * that. This is how a caller that holds only the registry key — the
 * merged-branch sweep, the worktree removal, a terminal's detach check
 * — reaches the resolver without composing a name.
 */
export function resolveRegistrySession(
  repoRoot: string,
  registryName: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  const worktree = oldest(
    sessions.filter(
      (s) =>
        s.type === 'worktree' &&
        s.repo === repoRoot &&
        registryNameOf(s) === registryName
    )
  );
  return worktree ?? resolveTerminalSession(registryName, sessions);
}
