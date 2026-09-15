import { tmuxListSessionsDetailed } from '@kirby/terminal-tmux';
import {
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
 * The worktree session a PTY-registry key names in this repository:
 * the one whose branch keys to it. This is how a caller that holds
 * only a registry key — the merged-branch sweep, the worktree removal
 * — reaches the resolver without composing a name.
 *
 * Nothing is matched by name here. A key is a branch with `/`
 * rewritten, never a tmux name, and the two namespaces overlap: an
 * agent tab is called `<repo>-agent`, which is also the key of a
 * branch named `<repo>-agent`, and repository `feature`'s agent on
 * branch `x` is labelled `feature-x`, which is the key of the branch
 * `feature/x`. Answering either by name would have the worktree
 * removal kill a session that is on no such branch. Callers holding a
 * tmux name — a terminal tab, whose key *is* its name — use
 * {@link resolveSessionByName} instead.
 */
export function resolveRegistrySession(
  repoRoot: string,
  registryName: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return oldest(
    sessions.filter(
      (s) =>
        s.type === 'worktree' &&
        s.repo === repoRoot &&
        registryNameOf(s) === registryName
    )
  );
}
