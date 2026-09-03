import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionSpec } from '@kirby/terminal';

const { spawns, MockPtySession } = vi.hoisted(() => {
  const spawns: { cmd: string; args: string[] }[] = [];
  class MockPtySession {
    readonly pid = 1;
    constructor(cmd: string, args: string[]) {
      spawns.push({ cmd, args });
    }
  }
  return { spawns, MockPtySession };
});

vi.mock('./pty-session.js', () => ({ PtySession: MockPtySession }));

import { createPtyBackendFactory } from './pty-backend.js';

function spec(overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    name: 'term',
    cmd: 'claude',
    args: [],
    cwd: '/tmp/work',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

const savedShell = process.env.SHELL;

beforeEach(() => {
  spawns.length = 0;
});

afterEach(() => {
  if (savedShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = savedShell;
});

describe('createPtyBackendFactory', () => {
  it('spawns the command it is given', () => {
    createPtyBackendFactory()(spec({ cmd: 'claude', args: ['--continue'] }));
    expect(spawns).toEqual([{ cmd: 'claude', args: ['--continue'] }]);
  });

  // There is no tmux to pick a default shell here, so the backend does
  // what a terminal emulator does: the user's `$SHELL`.
  it('runs $SHELL when cmd is empty', () => {
    process.env.SHELL = '/usr/bin/fish';
    createPtyBackendFactory()(spec({ cmd: '', args: [] }));
    expect(spawns).toEqual([{ cmd: '/usr/bin/fish', args: [] }]);
  });

  it('falls back to /bin/sh when $SHELL is unset', () => {
    delete process.env.SHELL;
    createPtyBackendFactory()(spec({ cmd: '', args: [] }));
    expect(spawns).toEqual([{ cmd: '/bin/sh', args: [] }]);
  });

  // An explicit env wins over the process's — a caller that pinned a
  // shell for the session is asking for that one.
  it('reads $SHELL from the spec\'s env when one is given', () => {
    process.env.SHELL = '/bin/bash';
    createPtyBackendFactory()(
      spec({ cmd: '', args: [], env: { SHELL: '/bin/zsh' } })
    );
    expect(spawns).toEqual([{ cmd: '/bin/zsh', args: [] }]);
  });
});
