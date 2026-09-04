import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeOrigin } from './worktree-origin.js';

/**
 * Which live tmux sessions are worktree agents, and whose: the tmux
 * listing is the only record, and every session has to be tied back to
 * a repository through its directory before it can be a tab there.
 */

const state = vi.hoisted(() => ({
  backend: 'tmux' as string,
  sessions: [] as { name: string; path: string }[],
  listThrows: false,
}));

vi.mock('@kirby/terminal-tmux', () => ({
  sanitizeTmuxSessionName: (raw: string) => raw.replace(/[.:]/g, '-'),
  tmuxListSessionsDetailed: () => {
    if (state.listThrows) throw new Error('no tmux');
    return state.sessions;
  },
}));
vi.mock('@kirby/vcs-core', () => ({
  projectKey: (cwd: string) => `key(${cwd})`,
}));
vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
}));
vi.mock('../session-backend.js', () => ({
  resolveTerminalBackend: () => state.backend,
}));

import {
  __resetLiveWorktreeSessionsForTests,
  listLiveWorktreeSessions,
} from './live-worktree-sessions.js';

/** A git that knows two repositories, each with one worktree. */
const ORIGINS: Record<string, WorktreeOrigin> = {
  '/repos/alpha/.claude/worktrees/feat-a': {
    repoRoot: '/repos/alpha',
    branch: 'feat/a',
  },
  '/repos/beta/.claude/worktrees/feat-b': {
    repoRoot: '/repos/beta',
    branch: 'feat-b',
  },
};
const describeMock = vi.fn((path: string) => ORIGINS[path] ?? null);

const ALPHA = {
  name: 'kirby-key(/repos/alpha)-feat-a',
  path: '/repos/alpha/.claude/worktrees/feat-a',
};
const BETA = {
  name: 'kirby-key(/repos/beta)-feat-b',
  path: '/repos/beta/.claude/worktrees/feat-b',
};

beforeEach(() => {
  state.backend = 'tmux';
  state.sessions = [];
  state.listThrows = false;
  describeMock.mockClear();
  __resetLiveWorktreeSessionsForTests();
});

describe('listLiveWorktreeSessions', () => {
  it('ties every worktree agent to its repository and branch', () => {
    state.sessions = [ALPHA, BETA];
    expect(listLiveWorktreeSessions({}, describeMock)).toEqual([
      {
        tmuxName: ALPHA.name,
        path: ALPHA.path,
        repoRoot: '/repos/alpha',
        branch: 'feat/a',
        sessionName: 'feat-a',
      },
      {
        tmuxName: BETA.name,
        path: BETA.path,
        repoRoot: '/repos/beta',
        branch: 'feat-b',
        sessionName: 'feat-b',
      },
    ]);
  });

  it('leaves out terminal tabs, sessions that are not Kirby’s, and ones with no path', () => {
    state.sessions = [
      { name: 'kirby-term-shell-1a2b3c', path: '/home/dev/notes' },
      { name: 'my-own-session', path: '/repos/alpha/.claude/worktrees/feat-a' },
      { name: ALPHA.name, path: '' },
    ];
    expect(listLiveWorktreeSessions({}, describeMock)).toEqual([]);
  });

  it('leaves out a session whose directory is gone or no worktree', () => {
    state.sessions = [{ name: 'kirby-key(/repos/alpha)-old', path: '/gone' }];
    expect(listLiveWorktreeSessions({}, describeMock)).toEqual([]);
  });

  // The name is what Kirby composes for the *directory's* repository
  // and branch. A mismatch is a session whose worktree checked out
  // another branch — the orphan the repository's own scanner reports as
  // a terminal — or one filed under a directory that is not its own.
  it('leaves out a session whose name does not match its directory', () => {
    state.sessions = [
      { name: 'kirby-key(/repos/alpha)-feat-a', path: BETA.path },
      { name: 'kirby-key(/repos/alpha)-other', path: ALPHA.path },
    ];
    expect(listLiveWorktreeSessions({}, describeMock)).toEqual([]);
  });

  it('is empty off the tmux backend, and when tmux cannot be asked', () => {
    state.sessions = [ALPHA];
    state.backend = 'pty';
    expect(listLiveWorktreeSessions({}, describeMock)).toEqual([]);
    state.backend = 'tmux';
    state.listThrows = true;
    expect(listLiveWorktreeSessions({}, describeMock)).toEqual([]);
  });

  it('asks git about a directory once per TTL, not once per listing', () => {
    state.sessions = [ALPHA];
    listLiveWorktreeSessions({}, describeMock, 1_000);
    listLiveWorktreeSessions({}, describeMock, 2_000);
    expect(describeMock).toHaveBeenCalledTimes(1);
    listLiveWorktreeSessions({}, describeMock, 60_000);
    expect(describeMock).toHaveBeenCalledTimes(2);
  });
});
