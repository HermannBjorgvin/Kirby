import { randomUUID } from 'node:crypto';
import { terminalSessionKey } from '../session-key.js';

export type TerminalKind = 'shell' | 'agent';

/** A new terminal's provisional identity. PTY keeps it for its lifetime;
 * tmux allocation replaces it with the identity of the actual target. */
export function newTerminalSessionName(): string {
  return terminalSessionKey(randomUUID());
}
