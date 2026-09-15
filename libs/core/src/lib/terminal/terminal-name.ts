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
 * — suggested here and allocated by the backend; nothing parses the
 * `-2`, `-3` a collision appends.
 */

export type TerminalKind = 'shell' | 'agent';

/** Suggest a name for a terminal about to open, free on both counts: not held by this
 *  process, and not a session on the server, whoever made it. The backend
 *  returns the final name used as the registry key after allocation. The
 *  server is asked unless the availability probe has said tmux is not
 *  installed: before it answers, tmux may still be the backend in
 *  force (an explicit `terminalBackend: 'tmux'`), and a missing tmux
 *  simply answers "not held". With no repository to label after, the
 *  kind alone is the label. */
export function newTerminalSessionName(
  kind: TerminalKind,
  deps: {
    repoRoot?: string | null;
    /** `null` stands for a probe that has not answered. */
    tmuxAvailable?: boolean | null;
    tmuxHolds?: (name: string) => boolean;
  } = {}
): string {
  const root = deps.repoRoot === undefined ? getRepoRoot() : deps.repoRoot;
  const available =
    deps.tmuxAvailable === undefined
      ? getTmuxAvailability()?.available ?? null
      : deps.tmuxAvailable;
  const probeTmux = available !== false;
  const tmuxHolds = deps.tmuxHolds ?? tmuxHasSession;
  const preferred = root ? terminalSessionLabel(root, kind) : kind;
  return tmuxFreeSessionName(
    preferred,
    (name) => hasSession(name) || (probeTmux && tmuxHolds(name))
  );
}
