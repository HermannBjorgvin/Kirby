import { describe, expect, it } from 'vitest';
import { newTerminalSessionName } from './terminal-name.js';
import { sessionIdentity, worktreeSessionKey } from '../session-key.js';

describe('new terminal identities', () => {
  it('allocates distinct terminal identities without needing tmux or a repository', () => {
    const first = newTerminalSessionName();
    const second = newTerminalSessionName();
    expect(first).not.toBe(second);
    expect(sessionIdentity(first)?.kind).toBe('terminal');
    expect(first).not.toBe(worktreeSessionKey(first, '/repo'));
  });
});
