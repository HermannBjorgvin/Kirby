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
  // Kept, and asserted never to be reached: this is the registry keyed
  // by the bare branch name, so it answers for whichever repository
  // launched the agent — including one that is not open.
  killSession: (name: string) => calls.log.push(`unguarded-kill:${name}`),
  killPersistedTmuxSession: (name: string) =>
    calls.log.push(`kill-tmux:${name}`),
}));

vi.mock('./sessions.js', () => ({
  killOwnSession: (name: string) => calls.log.push(`kill:${name}`),
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
  it('kills the agent before touching the directory', async () => {
    await removeWorktree('feature/x', false);

    const removeAt = calls.log.indexOf('remove:feature/x:safe');
    const killAt = calls.log.indexOf('kill:feature-x');
    expect(killAt).toBeGreaterThanOrEqual(0);
    // Removing first would delete the directory the agent is running in.
    expect(killAt).toBeLessThan(removeAt);
  });

  it('stops the branch’s babysitter before the agent, so no update restarts one', async () => {
    await removeWorktree('feature/x', false);
    const stopAt = calls.log.indexOf('stop-babysit:feature/x');
    expect(stopAt).toBeGreaterThanOrEqual(0);
    // A watcher still running would answer its next update by checking
    // the branch out again and starting an agent in it.
    expect(stopAt).toBeLessThan(calls.log.indexOf('kill:feature-x'));
  });

  it('kills both the branch-derived and worktree-derived session names', async () => {
    // They differ when a worktree directory was reused for another
    // branch; missing either leaves a PTY pointed at a deleted path.
    await removeWorktree('feature/x', false);
    expect(calls.log).toContain('kill:feature-x');
    expect(calls.log).toContain('kill:wt-feature-x');
  });

  it('kills a persisted tmux session the registry never saw', async () => {
    // A tmux agent from a previous run is alive without being in the
    // registry, so registry-only kills would leave it running in a
    // directory about to be deleted.
    await removeWorktree('feature/x', false);
    expect(calls.log).toContain('kill-tmux:feature-x');
    expect(calls.log).toContain('kill-tmux:wt-feature-x');
  });

  it('deletes the branch once the worktree is gone', async () => {
    await removeWorktree('feature/x', false);
    const removeAt = calls.log.indexOf('remove:feature/x:safe');
    const deleteAt = calls.log.indexOf('delete-branch:feature/x');
    expect(deleteAt).toBeGreaterThan(removeAt);
  });

  it('keeps the branch when the worktree could not be removed', async () => {
    calls.removed = false;
    expect(await removeWorktree('feature/x', false)).toBe(false);
    // Deleting the branch here would orphan a worktree that still
    // exists on disk.
    expect(calls.log).not.toContain('delete-branch:feature/x');
  });

  it('passes force through to git', async () => {
    await removeWorktree('feature/x', true);
    expect(calls.log).toContain('remove:feature/x:force');
  });

  it('still kills and removes when the branch has no listed worktree', async () => {
    // A branch whose directory git no longer lists must still be
    // cleaned up rather than skipped.
    calls.worktrees = [];
    expect(await removeWorktree('gone', false)).toBe(true);
    expect(calls.log).toContain('kill:gone');
    expect(calls.log).toContain('remove:gone:safe');
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
