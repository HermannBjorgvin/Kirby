import { randomBytes } from 'node:crypto';
import { KIRBY_TMUX_PREFIX } from '../tmux-namespace.js';

/**
 * Naming for terminal-tab sessions.
 *
 * A terminal tab is a session that belongs to a *directory* rather than
 * to a worktree, and it has no state file: everything Kirby needs to
 * put it back on screen after a restart comes from tmux itself — the
 * kind is parsed from the name, and the directory is `#{session_path}`,
 * which tmux remembers from the `-c` the backend passed to
 * `new-session`. So the name has to carry the kind and a per-terminal
 * id (several terminals in one directory are fine), and nothing else.
 *
 * The shape is chosen to pass through `sanitizeTmuxSessionName`
 * unchanged — no `.`, no `:`, far under the length cap — because a
 * name tmux rewrote would not parse back, and the terminal would be
 * invisible on the next launch.
 */

export type TerminalKind = 'shell' | 'agent';

export interface TerminalIdentity {
  kind: TerminalKind;
  id: string;
}

const TERM_PREFIX = `${KIRBY_TMUX_PREFIX}term-`;
const TERM_NAME = new RegExp(`^${TERM_PREFIX}(shell|agent)-([0-9a-f]+)$`);
/** A composed worktree session: the namespace, a 16-hex project key,
 *  and the registry name. */
const WORKTREE_NAME = new RegExp(`^${KIRBY_TMUX_PREFIX}[0-9a-f]{16}-.`);

/** `kirby-term-<kind>-<id>`, with a fresh id unless one is given. */
export function newTerminalSessionName(
  kind: TerminalKind,
  id: string = randomBytes(3).toString('hex')
): string {
  return `${TERM_PREFIX}${kind}-${id}`;
}

/** The kind and id a terminal session name carries, or `null` for any
 *  other session — a worktree session, or one the user runs for their
 *  own reasons. */
export function parseTerminalSessionName(
  name: string
): TerminalIdentity | null {
  const m = TERM_NAME.exec(name);
  if (!m) return null;
  return { kind: m[1] as TerminalKind, id: m[2] };
}

/**
 * Whether a registry name is already a complete tmux name, so the
 * backend must use it as-is rather than composing the repository
 * prefix in front of it.
 *
 * Exactly two shapes qualify: a terminal name, and a fully composed
 * worktree name (which is how an orphaned session — its worktree has
 * moved to another branch — is re-attached under the name tmux holds
 * it by). Anything else, including a branch that merely starts with
 * `kirby-`, is a bare registry name and gets the prefix.
 */
export function isQualifiedTmuxName(name: string): boolean {
  return TERM_NAME.test(name) || WORKTREE_NAME.test(name);
}
