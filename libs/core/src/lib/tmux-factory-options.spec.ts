import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSpec } from '@kirby/terminal';
import type { WorktreeHead } from './discovery/worktree-origin.js';
import type { TaggedSession } from './session-identity.js';
import type * as Resolver from './session-resolver.js';

/**
 * Kirby's answers to the tmux backend's three questions. The resolver
 * is a mock here — what it returns is a fixed set of tagged sessions,
 * and the point is which of them each spec is matched against, and
 * with what identity.
 */

const state = vi.hoisted(() => ({
  sessions: [] as TaggedSession[],
}));

vi.mock('./session-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Resolver>();
  return {
    ...actual,
    listOurSessions: () => state.sessions,
    resolveWorktreeSession: (repo: string, branch: string) =>
      actual.resolveWorktreeSession(repo, branch, state.sessions),
    resolveTerminalSession: (name: string) =>
      actual.resolveTerminalSession(name, state.sessions),
  };
});

import { kirbyTmuxFactoryOptions } from './tmux-factory-options.js';

function tagged(
  name: string,
  type: TaggedSession['type'],
  repo: string,
  branch = ''
): TaggedSession {
  return {
    name,
    created: 1,
    path: '/p',
    spawner: 'kirby',
    repo,
    type,
    branch,
  };
}

function spec(overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    name: 'feature-x',
    cmd: '/bin/sh',
    args: ['-c', 'claude'],
    cwd: '/repo/.claude/worktrees/feature-x',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

/** HEAD as a linked worktree named after its branch would read. */
const onBranch = (path: string): WorktreeHead => ({
  branch: `feature/${path.split('/').pop()!.slice(8)}`,
  detached: false,
});

const terminal = (kind: 'shell' | 'agent', name: string) =>
  spec({
    name,
    cwd: '/repo',
    cmd: '',
    args: [],
    tags: { '@orchestra-session-type': kind },
  });

beforeEach(() => {
  state.sessions = [];
});

describe('kirbyTmuxFactoryOptions', () => {
  describe('a worktree session', () => {
    it('resolves by the repo root and the branch in the directory HEAD, not by name', () => {
      state.sessions = [
        tagged('some-label', 'worktree', '/repo', 'feature/x'),
        tagged('feature-x', 'worktree', '/other', 'feature/x'),
      ];
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead: onBranch });
      expect(opts.resolve(spec())).toBe('some-label');
      expect(
        opts.resolve(spec({ cwd: '/repo/.claude/worktrees/feature-y' }))
      ).toBeNull();
    });

    it('never resolves to a terminal tab, whatever it is called', () => {
      state.sessions = [tagged('feature-x', 'agent', '/repo')];
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead: onBranch });
      expect(opts.resolve(spec())).toBeNull();
    });

    it('labels it <repo>-<branch> and tags it with the unsanitized branch', () => {
      const opts = kirbyTmuxFactoryOptions('/home/dev/repo', {
        readHead: onBranch,
      });
      expect(opts.label(spec())).toBe('repo-feature-x');
      expect(opts.tags(spec())).toEqual({
        '@orchestra-spawner': 'kirby',
        '@orchestra-repo': '/home/dev/repo',
        '@orchestra-session-type': 'worktree',
        '@orchestra-branch': 'feature/x',
      });
    });

    // A detached HEAD has no branch; the directory's name is what the
    // worktree list names the session after, and what the tag says.
    it('uses the directory name a detached worktree is named after', () => {
      const opts = kirbyTmuxFactoryOptions('/repo', {
        readHead: (path) => ({
          branch: path.split('/').pop()!,
          detached: true,
        }),
      });
      const s = spec({
        cwd: '/repo/.claude/worktrees/hotfix-dir',
        name: 'hotfix-dir',
      });
      expect(opts.tags(s)['@orchestra-branch']).toBe('hotfix-dir');
      expect(opts.label(s)).toBe('repo-hotfix-dir');
    });

    it('falls back to the registry name when the directory has no HEAD', () => {
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead: () => null });
      expect(opts.tags(spec())['@orchestra-branch']).toBe('feature-x');
    });

    it('reads HEAD once per spec, at the session directory', () => {
      const readHead = vi.fn(onBranch);
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead });
      const s = spec({ cwd: '/repo/.claude/worktrees/feature-y' });
      opts.resolve(s);
      opts.label(s);
      opts.tags(s);
      expect(readHead).toHaveBeenCalledTimes(1);
      expect(readHead).toHaveBeenCalledWith(
        '/repo/.claude/worktrees/feature-y'
      );
    });
  });

  describe('a terminal tab', () => {
    it('is told apart by the session-type tag its launcher set, and identified by name', () => {
      state.sessions = [
        tagged('repo-shell', 'shell', '/elsewhere'),
        tagged('repo-agent', 'worktree', '/repo', 'repo-agent'),
      ];
      const readHead = vi.fn(onBranch);
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead });
      expect(opts.resolve(terminal('shell', 'repo-shell'))).toBe('repo-shell');
      // The same name held by a worktree session is not this tab.
      expect(opts.resolve(terminal('agent', 'repo-agent'))).toBeNull();
      expect(opts.resolve(terminal('shell', 'repo-shell-2'))).toBeNull();
      expect(readHead).not.toHaveBeenCalled();
    });

    it('is labelled by the name core chose, and tagged without a branch', () => {
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead: onBranch });
      expect(opts.label(terminal('shell', 'repo-shell-3'))).toBe(
        'repo-shell-3'
      );
      expect(opts.tags(terminal('agent', 'repo-agent'))).toEqual({
        '@orchestra-spawner': 'kirby',
        '@orchestra-repo': '/repo',
        '@orchestra-session-type': 'agent',
      });
    });

    it('does not let a caller tag pass through as a session type it is not', () => {
      const opts = kirbyTmuxFactoryOptions('/repo', { readHead: onBranch });
      const s = spec({ tags: { '@orchestra-session-type': 'player' } });
      expect(opts.tags(s)['@orchestra-session-type']).toBe('worktree');
    });
  });
});
