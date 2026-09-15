import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The name a new terminal tab gets is a label — `<repo>-shell`,
 * `<repo>-agent` — suffixed until free. Free means free on both
 * counts: not a registry entry here, and not a session on the tmux
 * server, whoever made it.
 */

const state = vi.hoisted(() => ({
  registry: new Set<string>(),
  server: new Set<string>(),
  probes: [] as string[],
  /** What the availability probe has said; `null` while unanswered. */
  tmuxStatus: { available: true } as { available: boolean } | null,
}));

vi.mock('../pty-registry.js', () => ({
  hasSession: (name: string) => state.registry.has(name),
}));
vi.mock('../session-backend.js', () => ({
  getRepoRoot: () => '/home/dev/my.repo',
  getTmuxAvailability: () => state.tmuxStatus,
}));

import { newTerminalSessionName } from './terminal-name.js';

const tmuxHolds = (name: string) => {
  state.probes.push(name);
  return state.server.has(name);
};

beforeEach(() => {
  state.registry = new Set();
  state.server = new Set();
  state.probes = [];
  state.tmuxStatus = { available: true };
});

describe('newTerminalSessionName', () => {
  it('labels a terminal after the repository and its kind', () => {
    expect(newTerminalSessionName('shell', { tmuxHolds })).toBe(
      'my-repo-shell'
    );
    expect(newTerminalSessionName('agent', { tmuxHolds })).toBe(
      'my-repo-agent'
    );
  });

  it('skips a name the tmux server holds, whoever made it', () => {
    state.server = new Set(['my-repo-shell', 'my-repo-shell-2']);
    expect(newTerminalSessionName('shell', { tmuxHolds })).toBe(
      'my-repo-shell-3'
    );
    expect(state.probes).toEqual([
      'my-repo-shell',
      'my-repo-shell-2',
      'my-repo-shell-3',
    ]);
  });

  it('skips a name this process already holds, even off the tmux backend', () => {
    state.registry = new Set(['my-repo-agent']);
    expect(
      newTerminalSessionName('agent', { tmuxHolds, tmuxAvailable: false })
    ).toBe('my-repo-agent-2');
    expect(state.probes).toEqual([]);
  });

  it('does not ask tmux when the probe said it is not installed', () => {
    newTerminalSessionName('shell', { tmuxHolds, tmuxAvailable: false });
    expect(state.probes).toEqual([]);
  });

  // Before the availability probe has answered, tmux may still be the
  // backend in force (an explicit `terminalBackend: 'tmux'`), so the
  // server is asked; a missing tmux simply answers "not held".
  it('asks tmux while the probe has not answered', () => {
    state.tmuxStatus = null;
    state.server = new Set(['my-repo-shell']);
    expect(newTerminalSessionName('shell', { tmuxHolds })).toBe(
      'my-repo-shell-2'
    );
    expect(state.probes).toEqual(['my-repo-shell', 'my-repo-shell-2']);
  });

  // The cap applies to the preferred label; the collision suffix goes
  // on afterwards and the result is never capped or hashed again, so
  // the registry key is exactly the name the backend will create.
  it('suffixes a capped label after the cap, without re-capping', () => {
    const repoRoot = `/x/${'r'.repeat(194)}`;
    const capped = newTerminalSessionName('shell', { tmuxHolds, repoRoot });
    expect(capped).toHaveLength(200);
    state.server = new Set([capped]);
    const next = newTerminalSessionName('shell', { tmuxHolds, repoRoot });
    expect(next).toBe(`${capped}-2`);
    expect(next).toHaveLength(202);
  });

  it('labels by kind alone outside a repository', () => {
    expect(newTerminalSessionName('shell', { tmuxHolds, repoRoot: null })).toBe(
      'shell'
    );
  });
});
