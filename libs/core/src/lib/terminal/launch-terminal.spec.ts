import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';

const { spawns } = vi.hoisted(() => ({
  spawns: [] as {
    name: string;
    cmd: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    tags?: Record<string, string>;
  }[],
}));

vi.mock('../pty-registry.js', () => ({
  spawnSession: (
    name: string,
    cmd: string,
    args: string[],
    cols: number,
    rows: number,
    cwd: string,
    _env?: unknown,
    tags?: Record<string, string>
  ) => {
    spawns.push({ name, cmd, args, cwd, cols, rows, tags });
    return { spawnedAt: 1 };
  },
  getSession: () => undefined,
}));

vi.mock('../agents/registry.js', () => ({
  resolveAgent: (config: { agentId?: string }) => ({
    id: config.agentId ?? 'claude',
    name: 'Agent',
    supportsAppendSystemPrompt: true,
    blank: () => ({ cmd: config.agentId ?? 'claude', args: [] }),
    seed: (p: string) => ({ cmd: 'claude', args: [p] }),
    continueOrBlank: () => ({
      cmd: '/bin/sh',
      args: ['-c', 'claude --continue || claude'],
    }),
  }),
}));

import { launchTerminalSession } from './launch-terminal.js';

const config = { vendorAuth: {}, vendorProject: {} } as AppConfig;

beforeEach(() => {
  spawns.length = 0;
});

describe('launchTerminalSession', () => {
  // The shell case hands the backend an empty command: tmux then runs
  // its default-shell and the PTY backend runs $SHELL. Naming any shell
  // here would pin one across both backends and need a setting.
  it('opens a shell by asking the backend for its default shell', () => {
    launchTerminalSession({
      name: 'notes-shell',
      kind: 'shell',
      cwd: '/home/dev/notes',
      cols: 100,
      rows: 30,
      config,
    });
    expect(spawns).toEqual([
      {
        name: 'notes-shell',
        cmd: '',
        args: [],
        cwd: '/home/dev/notes',
        cols: 100,
        rows: 30,
        tags: { '@orchestra-session-type': 'shell' },
      },
    ]);
  });

  // The agent case is exactly the session menu's plain "session" entry:
  // the configured agent, no prompt, no review guidance — resumed where
  // the agent supports it.
  it('opens an agent the way the session menu’s plain entry does', () => {
    launchTerminalSession({
      name: 'repo-agent',
      kind: 'agent',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      config: { ...config, agentId: 'codex' },
    });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({
      name: 'repo-agent',
      cwd: '/repo',
      cmd: '/bin/sh',
      args: ['-c', 'claude --continue || claude'],
    });
  });

  // The kind is what tells the tmux composition root this is a
  // terminal tab — identified by its name — and not a worktree session
  // to be identified by the directory's branch; and it is what a later
  // scan finds the tab by. Without it an agent tab would be created,
  // and looked for, as a worktree session of the repository root.
  it('declares the kind as the session-type tag on both paths', () => {
    launchTerminalSession({
      name: 'repo-agent',
      kind: 'agent',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      config,
    });
    expect(spawns[0]?.tags).toEqual({ '@orchestra-session-type': 'agent' });
  });
});
