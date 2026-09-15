import { describe, expect, it } from 'vitest';
import type { TmuxSessionInfo } from '@kirby/terminal-tmux';
import {
  isTerminalSession,
  isWorktreeSessionFor,
  registryNameOf,
  sanitizeLabelPart,
  sessionTags,
  taggedSession,
  terminalSessionLabel,
  worktreeSessionLabel,
} from './session-identity.js';

/**
 * Names are labels, tags are identity. The label builder is the half
 * of the convention both programs implement independently (Orchestra
 * in bash), so its outputs are pinned as literals — the same table
 * lives in agent-plugins' CLAUDE.md — rather than derived from the
 * function under test.
 */
describe('session labels', () => {
  // repo basename, branch → label. `/`, `.` and `:` become `-`; the
  // repo's basename is what the label starts with.
  it.each([
    ['/home/dev/kirby', 'feature/x', 'kirby-feature-x'],
    ['/home/dev/agent-plugins', 'fix-typo', 'agent-plugins-fix-typo'],
    ['/srv/my.repo', 'release/v1.0:rc1', 'my-repo-release-v1-0-rc1'],
    ['/srv/a:b', 'main', 'a-b-main'],
    ['/repo', 'hotfix-dir', 'repo-hotfix-dir'],
  ])('worktree %s + %s → %s', (repo, branch, label) => {
    expect(worktreeSessionLabel(repo, branch)).toBe(label);
  });

  it.each([
    ['/home/dev/kirby', 'shell', 'kirby-shell'],
    ['/home/dev/kirby', 'agent', 'kirby-agent'],
    ['/srv/my.repo', 'shell', 'my-repo-shell'],
  ] as const)('terminal %s + %s → %s', (repo, kind, label) => {
    expect(terminalSessionLabel(repo, kind)).toBe(label);
  });

  // The cap applies to the whole name: the first 195 characters, `-`,
  // and the first four hex characters of the SHA-256 of the uncapped,
  // already-replaced name. Pinned as a literal so a change to which
  // string is hashed — the raw branch, say — fails here.
  it('caps a long name at 200 characters with a hash tail of the replaced name', () => {
    const label = worktreeSessionLabel(
      '/home/dev/kirby',
      `release/${'x'.repeat(300)}`
    );
    expect(label).toHaveLength(200);
    expect(label.startsWith('kirby-release-xxxxx')).toBe(true);
    expect(label.slice(-10)).toBe('xxxxx-4481');
    expect(
      worktreeSessionLabel(
        '/home/dev/agent-plugins',
        `feature/${'y'.repeat(190)}`
      ).slice(-5)
    ).toBe('-746a');
  });

  it('sanitizes one part without capping it', () => {
    expect(sanitizeLabelPart('a/b.c:d')).toBe('a-b-c-d');
    expect(sanitizeLabelPart('x'.repeat(300))).toHaveLength(300);
  });
});

function listed(
  name: string,
  options: Record<string, string> | undefined,
  extra: Partial<TmuxSessionInfo> = {}
): TmuxSessionInfo {
  return { name, created: 10, path: '/p', options, ...extra };
}

const OURS = {
  '@orchestra-spawner': 'kirby',
  '@orchestra-repo': '/repos/alpha',
  '@orchestra-session-type': 'worktree',
  '@orchestra-branch': 'feat/a',
};

describe('taggedSession', () => {
  it('reads one of ours from its tags, never from its name', () => {
    expect(taggedSession(listed('anything-at-all', OURS))).toEqual({
      name: 'anything-at-all',
      created: 10,
      path: '/p',
      spawner: 'kirby',
      repo: '/repos/alpha',
      type: 'worktree',
      branch: 'feat/a',
    });
  });

  // A session whose name is exactly what Kirby would have chosen, but
  // that carries no tags, is foreign. Half the tags are not enough.
  it.each([
    ['no tags', undefined],
    ['empty tags', {}],
    ['spawner only', { '@orchestra-spawner': 'kirby' }],
    ['session type only', { '@orchestra-session-type': 'worktree' }],
    [
      'an unknown session type',
      { '@orchestra-spawner': 'kirby', '@orchestra-session-type': 'player' },
    ],
    [
      'repo and branch but no type',
      {
        '@orchestra-spawner': 'kirby',
        '@orchestra-repo': '/repos/alpha',
        '@orchestra-branch': 'feat/a',
      },
    ],
  ])('treats a session with %s as foreign', (_label, options) => {
    expect(taggedSession(listed('kirby-feat-a', options))).toBeNull();
  });

  it('carries the Orchestra tags along when set, and leaves them out when not', () => {
    const session = taggedSession(
      listed('x', {
        ...OURS,
        '@orchestra-spawner': 'orchestra',
        '@orchestra-agent': 'codex',
        '@orchestra-orchestrator': 'tmux:kirby-main',
        '@orchestra-last-report': 'DONE 2026-09-14T10:22:03Z',
      })
    );
    expect(session).toMatchObject({
      spawner: 'orchestra',
      agent: 'codex',
      orchestrator: 'tmux:kirby-main',
      lastReport: 'DONE 2026-09-14T10:22:03Z',
    });
    expect(taggedSession(listed('x', OURS))).not.toHaveProperty('agent');
  });
});

describe('matching', () => {
  const worktree = taggedSession(listed('n', OURS))!;
  const shell = taggedSession(
    listed('alpha-shell', {
      '@orchestra-spawner': 'kirby',
      '@orchestra-repo': '/repos/alpha',
      '@orchestra-session-type': 'shell',
    })
  )!;

  it('matches a worktree session on repo and unsanitized branch, exactly', () => {
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', 'feat/a')).toBe(true);
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', 'feat-a')).toBe(
      false
    );
    expect(isWorktreeSessionFor(worktree, '/repos/alpha/', 'feat/a')).toBe(
      false
    );
    expect(isWorktreeSessionFor(worktree, '/repos/beta', 'feat/a')).toBe(false);
    expect(isWorktreeSessionFor(shell, '/repos/alpha', 'feat/a')).toBe(false);
  });

  it('tells a terminal tab from a worktree session by type', () => {
    expect(isTerminalSession(shell)).toBe(true);
    expect(isTerminalSession(worktree)).toBe(false);
  });

  // The registry keys a worktree session by the branch with `/`
  // rewritten, and a terminal by its tmux name.
  it('keys a session the way the PTY registry does', () => {
    expect(registryNameOf(worktree)).toBe('feat-a');
    expect(registryNameOf(shell)).toBe('alpha-shell');
  });
});

describe('sessionTags', () => {
  it('writes spawner, repo, type and — for a worktree — the unsanitized branch', () => {
    expect(
      sessionTags('/repos/alpha', { type: 'worktree', branch: 'feat/a' })
    ).toEqual(OURS);
    expect(sessionTags('/repos/alpha', { type: 'agent' })).toEqual({
      '@orchestra-spawner': 'kirby',
      '@orchestra-repo': '/repos/alpha',
      '@orchestra-session-type': 'agent',
    });
  });

  it('round-trips through taggedSession', () => {
    const tags = sessionTags('/repos/alpha', { type: 'shell' });
    expect(taggedSession(listed('alpha-shell', tags))).toMatchObject({
      spawner: 'kirby',
      repo: '/repos/alpha',
      type: 'shell',
    });
  });
});
