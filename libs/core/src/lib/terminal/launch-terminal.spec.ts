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
  }[],
}));

vi.mock('../pty-registry.js', () => ({
  spawnSession: (
    name: string,
    cmd: string,
    args: string[],
    cols: number,
    rows: number,
    cwd: string
  ) => {
    spawns.push({ name, cmd, args, cwd, cols, rows });
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
      name: 'kirby-term-shell-1a2b3c',
      kind: 'shell',
      cwd: '/home/dev/notes',
      cols: 100,
      rows: 30,
      config,
    });
    expect(spawns).toEqual([
      {
        name: 'kirby-term-shell-1a2b3c',
        cmd: '',
        args: [],
        cwd: '/home/dev/notes',
        cols: 100,
        rows: 30,
      },
    ]);
  });

  // The agent case is exactly the session menu's plain "session" entry:
  // the configured agent, no prompt, no review guidance — resumed where
  // the agent supports it.
  it('opens an agent the way the session menu’s plain entry does', () => {
    launchTerminalSession({
      name: 'kirby-term-agent-4d5e6f',
      kind: 'agent',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      config: { ...config, agentId: 'codex' },
    });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({
      name: 'kirby-term-agent-4d5e6f',
      cwd: '/repo',
      cmd: '/bin/sh',
      args: ['-c', 'claude --continue || claude'],
    });
  });
});
