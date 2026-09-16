import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worktree removal is the destructive path, and it is a sequence, not a
 * single call: kill the agent, remove the worktree, then delete the
 * branch. Getting the order or the conditions wrong strands a PTY in a
 * deleted directory, deletes a branch whose worktree is still there, or
 * removes a directory out from under a live agent.
 */

const calls = vi.hoisted(() => ({
  log: [] as string[],
  removed: true,
  worktrees: [] as { branch: string; path: string }[],
  config: { editor: undefined } as Record<string, unknown>,
  spawned: [] as { cmd: string; args: string[]; detached: boolean }[],
  createReturns: '/repo/.claude/worktrees/b' as string | null,
}));

vi.mock('./repo.js', () => ({ requireRepo: () => '/repo' }));

vi.mock('@kirby/vcs-core', () => ({ readConfig: () => calls.config }));

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: { detached: boolean }) => {
    calls.spawned.push({ cmd, args, detached: opts.detached });
    return { unref: () => undefined };
  },
}));

vi.mock('@kirby/core', () => ({
  removeWorktreeSession: (branch: string, force: boolean, repo: string) => {
    calls.log.push(`remove-session:${repo}:${branch}:${force}`);
    return Promise.resolve(calls.removed);
  },
}));

vi.mock('./babysit.js', () => ({
  stopBabysitForBranch: (branch: string) =>
    calls.log.push(`stop-babysit:${branch}`),
}));

vi.mock('@kirby/worktree-manager', () => ({
  listWorktrees: () => Promise.resolve(calls.worktrees),
  listBranches: () => Promise.resolve(['main']),
  listAllBranches: () => Promise.resolve(['main', 'origin/main']),
  createWorktree: (branch: string) => {
    calls.log.push(`create:${branch}`);
    return Promise.resolve(calls.createReturns);
  },
  removeWorktree: (branch: string, opts: { force: boolean }) => {
    calls.log.push(`remove:${branch}:${opts.force ? 'force' : 'safe'}`);
    return Promise.resolve(calls.removed);
  },
  canRemoveBranch: () => Promise.resolve({ safe: true }),
  deleteBranch: (branch: string) => {
    calls.log.push(`delete-branch:${branch}`);
    return Promise.resolve(true);
  },
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
  worktreeSessionName: (wt: { branch: string }) =>
    `wt-${wt.branch.replace(/\//g, '-')}`,
}));

const { openInEditor, removeWorktree } = await import('./worktrees.js');

beforeEach(() => {
  calls.log = [];
  calls.removed = true;
  calls.worktrees = [
    { branch: 'feature/x', path: '/repo/.claude/worktrees/feature/x' },
  ];
  calls.config = {};
  calls.spawned = [];
  calls.createReturns = '/repo/.claude/worktrees/b';
  delete process.env.VISUAL;
  delete process.env.EDITOR;
});

describe('removeWorktree', () => {
  it('stops babysitting then delegates removal with the captured repository', async () => {
    expect(await removeWorktree('feature/x', true)).toBe(true);
    expect(calls.log).toEqual([
      'stop-babysit:feature/x',
      'remove-session:/repo:feature/x:true',
    ]);
  });
  it('returns a failed removal to the caller', async () => {
    calls.removed = false;
    expect(await removeWorktree('feature/x', false)).toBe(false);
  });
});

describe('openInEditor', () => {
  it('refuses when no editor is configured anywhere', async () => {
    await expect(openInEditor('b')).rejects.toThrow('No editor configured');
    expect(calls.spawned).toEqual([]);
  });

  it('prefers the configured editor over the environment', async () => {
    calls.config = { editor: 'code' };
    process.env.VISUAL = 'vim';
    expect(await openInEditor('b')).toEqual({ editor: 'code' });
    expect(calls.spawned[0].cmd).toBe('code');
  });

  it('falls back to VISUAL, then EDITOR', async () => {
    process.env.EDITOR = 'nano';
    expect(await openInEditor('b')).toEqual({ editor: 'nano' });

    process.env.VISUAL = 'vim';
    expect(await openInEditor('b')).toEqual({ editor: 'vim' });
  });

  it('creates the worktree first, so a PR with no checkout still opens', async () => {
    calls.config = { editor: 'code' };
    await openInEditor('b');
    expect(calls.log).toContain('create:b');
    expect(calls.spawned[0].args).toEqual(['/repo/.claude/worktrees/b']);
  });

  it('spawns detached so closing Kirby does not close the editor', async () => {
    calls.config = { editor: 'code' };
    await openInEditor('b');
    expect(calls.spawned[0].detached).toBe(true);
  });

  it('reports a worktree it could not resolve', async () => {
    calls.config = { editor: 'code' };
    calls.createReturns = null;
    await expect(openInEditor('b')).rejects.toThrow(
      'Failed to resolve a worktree'
    );
    expect(calls.spawned).toEqual([]);
  });
});
