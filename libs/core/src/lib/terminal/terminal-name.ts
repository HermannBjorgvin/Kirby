import { tmuxFreeSessionName, tmuxHasSession } from '@kirby/terminal-tmux';
import { hasSession } from '../pty-registry.js';
import { getRepoRoot, getTmuxAvailability } from '../session-backend.js';
import { terminalSessionLabel } from '../session-identity.js';

/**
 * Naming for terminal-tab sessions.
 *
 * A terminal tab is a session that belongs to a *directory* rather
 * than to a worktree, and it has no state file: what identifies it is
 * its tags (`@orchestra-session-type` of `shell` or `agent`) and its
 * name, which is also its PTY-registry key; its directory is tmux's own
 * `session_path`. The name is a label — `<repo>-shell`, `<repo>-agent`
 * — chosen once here and never parsed: nothing reconstructs the
 * `-2`, `-3` a collision appends.
 */

export type TerminalKind = 'shell' | 'agent';

/** The name a terminal about to be opened gets — and the registry key
 *  it will be found under — free on both counts: not held by this
 *  process, and (where tmux is installed, so the tmux backend may be
 *  in force) not a session on the server, whoever made it. With no
 *  repository to label after, the kind alone is the label. */
export function newTerminalSessionName(
  kind: TerminalKind,
  deps: {
    repoRoot?: string | null;
    tmuxAvailable?: boolean;
    tmuxHolds?: (name: string) => boolean;
  } = {}
): string {
  const root = deps.repoRoot === undefined ? getRepoRoot() : deps.repoRoot;
  const probeTmux =
    deps.tmuxAvailable ?? getTmuxAvailability()?.available ?? false;
  const tmuxHolds = deps.tmuxHolds ?? tmuxHasSession;
  const preferred = root ? terminalSessionLabel(root, kind) : kind;
  return tmuxFreeSessionName(
    preferred,
    (name) => hasSession(name) || (probeTmux && tmuxHolds(name))
  );
}
