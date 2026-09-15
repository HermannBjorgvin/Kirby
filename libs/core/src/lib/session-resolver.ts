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

/**
 * One of our sessions with exactly this name, or `null` — any type, any
 * repository, because a tmux name is unique on the server. This is how
 * a caller that holds a tmux name reaches its session: a terminal tab,
 * which belongs to its directory rather than to the open repository
 * and outlives a repository switch; or an orphaned worktree session
 * that a terminal tab has adopted, which keeps its `worktree` tag. The
 * tags still decide "ours": an untagged session of that name is not
 * found. A caller holding a registry *key* must not use this — see
 * {@link resolveRegistrySession}.
 */
export function resolveSessionByName(
  name: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return sessions.find((s) => s.name === name) ?? null;
}

/**
 * The session a PTY-registry key names in this repository: a worktree
 * session whose branch keys to it, else a terminal tab called exactly
 * that. This is how a caller that holds only a registry key — the
 * merged-branch sweep, the worktree removal — reaches the resolver
 * without composing a name. The fallback is terminal tabs only: a
 * worktree session's own name is never a registry key, and matching
 * one by name would let repository `feature`'s agent on branch `x`
 * (labelled `feature-x`) answer for the branch `feature/x`.
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
  return (
    worktree ??
    sessions.find((s) => isTerminalSession(s) && s.name === registryName) ??
    null
  );
}
