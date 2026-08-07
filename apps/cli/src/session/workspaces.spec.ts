import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@kirby/worktree-manager', () => ({
  createWorktree: vi.fn(async () => '/wt/feature-x'),
  deleteBranch: vi.fn(async () => undefined),
  listWorktrees: vi.fn(async () => [
    { path: '/wt/feature-x', branch: 'feature/x' },
    { path: '/wt/orphan', branch: '' },
    { path: '/wt/mid-rebase', branch: 'fix/y', state: 'rebasing' },
  ]),
  removeWorktree: vi.fn(async () => undefined),
  worktreeSessionName: vi.fn(
    (wt: { path: string; branch: string }) =>
      wt.branch.replace(/\//g, '-') || 'orphan'
  ),
}));

vi.mock('../pty-registry.js', () => ({
  killSession: vi.fn(),
}));

import { deleteBranch, removeWorktree } from '@kirby/worktree-manager';
import { killSession } from '../pty-registry.js';
import {
  getSessionWorkspaces,
  localWorkspaces,
  setSessionWorkspaces,
  workspaceForSession,
  type SessionWorkspaces,
} from './workspaces.js';

afterEach(() => {
  setSessionWorkspaces([localWorkspaces]);
  vi.clearAllMocks();
});

describe('localWorkspaces', () => {
  it('lists worktrees as rows with branch and state, no host', async () => {
    const rows = await localWorkspaces.list();
    expect(rows).toEqual([
      { name: 'feature-x', cwd: '/wt/feature-x', branch: 'feature/x' },
      { name: 'orphan', cwd: '/wt/orphan' },
      {
        name: 'fix-y',
        cwd: '/wt/mid-rebase',
        branch: 'fix/y',
        state: 'rebasing',
      },
    ]);
  });

  it('removes agent, worktree, then branch', async () => {
    await localWorkspaces.remove('feature-x', 'feature/x');
    expect(killSession).toHaveBeenCalledWith('feature-x');
    expect(removeWorktree).toHaveBeenCalledWith('feature/x', { force: true });
    expect(deleteBranch).toHaveBeenCalledWith('feature/x', true);
  });
});

describe('workspaceForSession', () => {
  const desktop: SessionWorkspaces = {
    host: 'desktop',
    prepare: async () => null,
    list: async () => [],
    remove: async () => undefined,
  };

  beforeEach(() => {
    setSessionWorkspaces([localWorkspaces, desktop]);
  });

  it('a bare name belongs to the local workspace', () => {
    expect(workspaceForSession('feature-x')).toBe(localWorkspaces);
  });

  it('a host-prefixed name belongs to that host', () => {
    expect(workspaceForSession('desktop:feature-x')).toBe(desktop);
  });

  it('an unknown host falls back to local', () => {
    expect(workspaceForSession('gone:feature-x')).toBe(localWorkspaces);
  });

  it('the active set is what was installed', () => {
    expect(getSessionWorkspaces()).toEqual([localWorkspaces, desktop]);
  });
});
