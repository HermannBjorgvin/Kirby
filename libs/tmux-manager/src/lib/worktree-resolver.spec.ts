import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve as pathResolve } from 'node:path';
import { createResolver, sanitizeBranch } from './worktree-resolver.js';

vi.mock('./exec.js', () => ({
  exec: vi.fn(),
}));

import { exec } from './exec.js';

const mockExec = vi.mocked(exec);

function resolve(stdout = '') {
  return { stdout, stderr: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeBranch', () => {
  it('should replace slashes with hyphens', () => {
    expect(sanitizeBranch('feature/auth')).toBe('feature-auth');
  });
  it('should handle multiple slashes', () => {
    expect(sanitizeBranch('feat/ui/sidebar')).toBe('feat-ui-sidebar');
  });
  it('should leave clean names alone', () => {
    expect(sanitizeBranch('main')).toBe('main');
  });
});

describe('createResolver', () => {
  it('should use config override when provided (absolute)', async () => {
    const resolver = await createResolver('/custom/path/{branch}');
    expect(resolver.pathFor('feature/auth')).toBe('/custom/path/feature-auth');
  });

  it('should use relative config override resolved against cwd', async () => {
    const resolver = await createResolver('../{branch}');
    const expected = pathResolve(process.cwd(), '../feature-auth');
    expect(resolver.pathFor('feature/auth')).toBe(expected);
  });

  it('should detect bare repo and use sibling layout', async () => {
    mockExec.mockResolvedValueOnce(resolve('true'));
    mockExec.mockResolvedValueOnce(resolve('/home/user/repo.git'));

    const resolver = await createResolver();
    expect(resolver.pathFor('feature/auth')).toBe(
      '/home/user/repo.git/feature-auth'
    );
  });

  it('should fall back to .kirby/worktrees/ for non-bare repos', async () => {
    mockExec.mockResolvedValueOnce(resolve('false'));

    const resolver = await createResolver();
    expect(resolver.pathFor('feature/auth')).toContain(
      '.kirby/worktrees/feature-auth'
    );
  });

  it('owns() should match paths within bare repo scope', async () => {
    mockExec.mockResolvedValueOnce(resolve('true'));
    mockExec.mockResolvedValueOnce(resolve('/home/user/repo.git'));

    const resolver = await createResolver();
    expect(resolver.owns('/home/user/repo.git/feature-auth')).toBe(true);
    expect(resolver.owns('/somewhere/else/feature-auth')).toBe(false);
  });

  it('owns() should always return true for config override', async () => {
    const resolver = await createResolver('/custom/{branch}');
    expect(resolver.owns('/anything/at/all')).toBe(true);
  });

  it('should fall back to default when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repo'));

    const resolver = await createResolver();
    expect(resolver.pathFor('main')).toContain('.kirby/worktrees/main');
  });
});
