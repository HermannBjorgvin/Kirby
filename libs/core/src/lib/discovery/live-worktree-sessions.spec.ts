import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeHead, WorktreeOrigin } from './worktree-origin.js';

/**
 * Which live tmux sessions are worktree agents, and whose: the tmux
 * listing is the only record, and every session has to be tied back to
 * a repository through its directory before it can be a tab there.
 */

const state = vi.hoisted(() => ({
  backend: 'tmux' as string,
  sessions: [] as {
    name: string;
    path: string;
    options?: Record<string, string>;
  }[],
  listThrows: false,
  askedFor: [] as (readonly string[])[],
}));

vi.mock('@kirby/terminal-tmux', () => ({
  sanitizeTmuxSessionName: (raw: string) => raw.replace(/[.:]/g, '-'),
  tmuxListSessionsDetailed: (options: readonly string[] = []) => {
    state.askedFor.push(options);
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
    detached: false,
  },
  '/repos/beta/.claude/worktrees/feat-b': {
    repoRoot: '/repos/beta',
    branch: 'feat-b',
    detached: false,
  },
  '/repos/beta/.claude/worktrees/hotfix': {
    repoRoot: '/repos/beta',
    branch: 'hotfix',
    detached: true,
  },
};
/** Which directories exist: every known worktree, unless a test says
 *  otherwise. */
const gone = new Set<string>();
const existsMock = (path: string) => path in ORIGINS && !gone.has(path);
const describeMock = vi.fn((path: string) =>
  existsMock(path) ? ORIGINS[path] : null
);
/** What each directory's HEAD file says: on the branch git knows, or
 *  detached, as the origin table records. */
const headMock = vi.fn((path: string): WorktreeHead | null => {
  const origin = existsMock(path) ? ORIGINS[path] : undefined;
  return origin ? { branch: origin.branch, detached: origin.detached } : null;
});
const list = () =>
  listLiveWorktreeSessions(
    {},
    { describe: describeMock, exists: existsMock, readHead: headMock }
  );

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
  state.askedFor = [];
  describeMock.mockClear();
  headMock.mockClear();
  gone.clear();
  __resetLiveWorktreeSessionsForTests();
});

describe('listLiveWorktreeSessions', () => {
  it('ties every worktree agent to its repository and branch', () => {
    state.sessions = [ALPHA, BETA];
    expect(list()).toEqual([
      {
        tmuxName: ALPHA.name,
        path: ALPHA.path,
        repoRoot: '/repos/alpha',
        branch: 'feat/a',
        detached: false,
        sessionName: 'feat-a',
      },
      {
        tmuxName: BETA.name,
        path: BETA.path,
        repoRoot: '/repos/beta',
        branch: 'feat-b',
        detached: false,
        sessionName: 'feat-b',
      },
    ]);
  });

  // A detached-HEAD worktree is named after its directory, and the
  // listing says so: which shells can attach to one is their rule.
  it('reports a detached HEAD as such, under the directory name', () => {
    state.sessions = [
      {
        name: 'kirby-key(/repos/beta)-hotfix',
        path: '/repos/beta/.claude/worktrees/hotfix',
      },
    ];
    expect(list()).toEqual([
      expect.objectContaining({ branch: 'hotfix', detached: true }),
    ]);
  });

  it('leaves out terminal tabs, sessions that are not Kirby’s, and ones with no path', () => {
    state.sessions = [
      { name: 'kirby-term-shell-1a2b3c', path: '/home/dev/notes' },
      { name: 'my-own-session', path: '/repos/alpha/.claude/worktrees/feat-a' },
      { name: ALPHA.name, path: '' },
    ];
    expect(list()).toEqual([]);
  });

  it('leaves out a session whose directory is gone or no worktree', () => {
    state.sessions = [{ name: 'kirby-key(/repos/alpha)-old', path: '/gone' }];
    expect(list()).toEqual([]);
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
    expect(list()).toEqual([]);
  });

  it('is empty off the tmux backend, and when tmux cannot be asked', () => {
    state.sessions = [ALPHA];
    state.backend = 'pty';
    expect(list()).toEqual([]);
    state.backend = 'tmux';
    state.listThrows = true;
    expect(list()).toEqual([]);
  });

  /**
   * A session created by a program that follows the shared convention
   * — Kirby itself, or Orchestra — carries its repository and branch
   * as session user options, and those are the answer: no git at all.
   * The options come back from the same `list-sessions` fork; the only
   * thing they cannot say is whether the branch is really a detached
   * HEAD's directory name, which the worktree's HEAD file can.
   */
  describe('sessions that carry their provenance', () => {
    const TAGGED = {
      ...ALPHA,
      options: {
        '@orchestra-repo': '/repos/alpha',
        '@orchestra-branch': 'feat/a',
      },
    };

    it('asks tmux for every convention tag in the one listing', () => {
      list();
      expect(state.askedFor).toEqual([
        [
          '@orchestra-repo',
          '@orchestra-branch',
          '@orchestra-agent',
          '@orchestra-orchestrator',
          '@orchestra-last-report',
        ],
      ]);
    });

    it('describes a tagged session from its tags without asking git', () => {
      state.sessions = [TAGGED];
      expect(list()).toEqual([
        {
          tmuxName: ALPHA.name,
          path: ALPHA.path,
          repoRoot: '/repos/alpha',
          branch: 'feat/a',
          detached: false,
          sessionName: 'feat-a',
        },
      ]);
      expect(describeMock).not.toHaveBeenCalled();
    });

    it('reports a tagged detached worktree as such', () => {
      state.sessions = [
        {
          name: 'kirby-key(/repos/beta)-hotfix',
          path: '/repos/beta/.claude/worktrees/hotfix',
          options: {
            '@orchestra-repo': '/repos/beta',
            '@orchestra-branch': 'hotfix',
          },
        },
      ];
      expect(list()).toEqual([
        expect.objectContaining({ branch: 'hotfix', detached: true }),
      ]);
      expect(describeMock).not.toHaveBeenCalled();
    });

    it('passes the agent, orchestrator and last report along when set', () => {
      state.sessions = [
        {
          ...TAGGED,
          options: {
            ...TAGGED.options,
            '@orchestra-agent': 'codex',
            '@orchestra-orchestrator': 'tmux:kirby-key(/repos/alpha)-main',
            '@orchestra-last-report': 'DONE 2026-09-14T10:22:03Z',
          },
        },
      ];
      expect(list()).toEqual([
        expect.objectContaining({
          agent: 'codex',
          orchestrator: 'tmux:kirby-key(/repos/alpha)-main',
          lastReport: 'DONE 2026-09-14T10:22:03Z',
        }),
      ]);
    });

    it('carries the orchestra tags even when the origin came from git', () => {
      state.sessions = [
        { ...ALPHA, options: { '@orchestra-agent': 'claude' } },
      ];
      expect(list()).toEqual([expect.objectContaining({ agent: 'claude' })]);
      expect(list()[0]).not.toHaveProperty('orchestrator');
    });

    // Half a provenance is none: a session from before the convention,
    // or one whose tags were only partly written, is described by git
    // exactly as before.
    it.each([
      ['no tags', {}],
      ['only the repo', { '@orchestra-repo': '/repos/alpha' }],
      ['only the branch', { '@orchestra-branch': 'feat/a' }],
    ])('asks git about a session with %s', (_label, options) => {
      state.sessions = [{ ...ALPHA, options }];
      expect(list()).toEqual([expect.objectContaining({ branch: 'feat/a' })]);
      expect(describeMock).toHaveBeenCalledWith(ALPHA.path);
    });

    it('asks git when the directory has no HEAD to read', () => {
      state.sessions = [TAGGED];
      headMock.mockReturnValueOnce(null);
      expect(list()).toHaveLength(1);
      expect(describeMock).toHaveBeenCalledWith(ALPHA.path);
    });

    it('leaves out a tagged session whose tags do not compose to its name', () => {
      state.sessions = [
        {
          ...TAGGED,
          options: { ...TAGGED.options, '@orchestra-branch': 'feat/b' },
        },
      ];
      expect(list()).toEqual([]);
    });

    it('leaves out a tagged session whose directory is gone', () => {
      state.sessions = [TAGGED];
      gone.add(ALPHA.path);
      expect(list()).toEqual([]);
    });

    it('remembers a tagged origin like any other', () => {
      state.sessions = [TAGGED];
      for (let i = 0; i < 20; i++) expect(list()).toHaveLength(1);
      expect(headMock).toHaveBeenCalledTimes(1);
      expect(describeMock).not.toHaveBeenCalled();
    });
  });

  // Describing a directory is three blocking git forks on the main
  // process, and the listing is polled. A worktree's repository never
  // changes and its branch changes only when something checks another
  // one out — which the composed name shows, since it stops matching.
  // So an origin is kept for as long as the directory exists and the
  // name still composes from it, however many listings go by.
  describe('the origin cache', () => {
    it('never asks git again while the directory exists and the name still matches', () => {
      state.sessions = [ALPHA, BETA];
      for (let i = 0; i < 20; i++) expect(list()).toHaveLength(2);
      expect(describeMock).toHaveBeenCalledTimes(2);
    });

    it('asks again when the name stops matching — the worktree checked out another branch', () => {
      state.sessions = [ALPHA];
      list();
      const alpha = ORIGINS[ALPHA.path];
      ORIGINS[ALPHA.path] = { ...alpha, branch: 'feat/other' };
      try {
        // Still cached as feat/a, still matching: no fork.
        expect(list()).toHaveLength(1);
        expect(describeMock).toHaveBeenCalledTimes(1);
        // A session named for the *other* branch at the same path is
        // the mismatch: git is asked, and now answers for that branch.
        state.sessions = [
          { name: 'kirby-key(/repos/alpha)-feat-other', path: ALPHA.path },
        ];
        expect(list()).toEqual([
          expect.objectContaining({
            branch: 'feat/other',
            sessionName: 'feat-other',
          }),
        ]);
        expect(describeMock).toHaveBeenCalledTimes(2);
      } finally {
        ORIGINS[ALPHA.path] = alpha;
      }
    });

    // A transient failure — an index.lock, a busy repository — must not
    // hide a session for the life of the cache.
    it('retries a directory git could not describe on the next listing', () => {
      state.sessions = [ALPHA];
      describeMock.mockImplementationOnce(() => null);
      expect(list()).toEqual([]);
      expect(list()).toHaveLength(1);
      expect(describeMock).toHaveBeenCalledTimes(2);
    });

    it('asks again about a directory that went away and came back', () => {
      state.sessions = [ALPHA];
      list();
      gone.add(ALPHA.path);
      expect(list()).toEqual([]);
      gone.delete(ALPHA.path);
      expect(list()).toHaveLength(1);
      expect(describeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Bounded by the listing: what tmux no longer holds is forgotten,
    // so the cache cannot grow with every session that ever existed.
    it('forgets a directory tmux no longer lists', () => {
      state.sessions = [ALPHA];
      list();
      state.sessions = [BETA];
      list();
      state.sessions = [ALPHA];
      list();
      expect(describeMock.mock.calls.map(([p]) => p)).toEqual([
        ALPHA.path,
        BETA.path,
        ALPHA.path,
      ]);
    });
  });
});
