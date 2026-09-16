import { sessionIdentity } from '../session-key.js';

/** Domain intent stays in core; tmux receives an already prepared operation. */
export type SessionRequest =
  | { type: 'worktree'; repo: string; branch: string }
  | {
      type: 'terminal';
      kind: 'shell' | 'agent';
      repo: string;
      target?: string;
    };

export function worktreeRequest(key: string): SessionRequest {
  const id = sessionIdentity(key);
  if (id?.kind !== 'worktree')
    throw new Error('Expected a qualified worktree session key');
  return { type: 'worktree', repo: id.repo, branch: id.branch };
}
