import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve as pathResolve } from 'node:path';
import {
  createWorktree,
  removeWorktree,
  deleteBranch,
  canRemoveBranch,
  listBranches,
  fetchRemote,
  listAllBranches,
  parseWorktrees,
  listWorktrees,
  fastForwardMainBranch,
  countConflicts,
  rebaseOntoMaster,
  getMainBranch,
  resetMainBranchCache,
  resetWorktreeResolver,
  branchToSessionName,
  setWorktreeResolver,
  createTemplateResolver,
} from './worktree.js';
import { existsSync } from 'node:fs';

vi.mock('./exec.js', () => ({
  exec: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { exec } from './exec.js';

const mockExec = vi.mocked(exec);
const mockExistsSync = vi.mocked(existsSync);

function resolve(stdout = '') {
  return { stdout, stderr: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMainBranchCache();
  resetWorktreeResolver();
});

describe('listBranches', () => {
  it('should parse git branch output into array', async () => {
    mockExec.mockResolvedValueOnce(
      resolve('main\nfeature/auth\nfix/bug-123\n')
    );
    const branches = await listBranches();
    expect(branches).toEqual(['main', 'feature/auth', 'fix/bug-123']);
  });

  it('should return empty array when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listBranches()).toEqual([]);
  });

  it('should filter out empty lines', async () => {
    mockExec.mockResolvedValueOnce(resolve('main\n\ndev\n'));
    expect(await listBranches()).toEqual(['main', 'dev']);
  });
});

describe('createWorktree', () => {
  it('should return absolute path for existing branch', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/feature-auth');
    expect(result).toMatch(/^\//); // absolute path
    expect(mockExec).toHaveBeenCalledWith(
      'git worktree add ".claude/worktrees/feature-auth" "feature/auth"',
      { encoding: 'utf8' }
    );
  });

  it('should fall back to -b for new branch', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce(resolve());
    const result = await createWorktree('new-branch');
    expect(result).toContain('.claude/worktrees/new-branch');
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenLastCalledWith(
      'git worktree add -b "new-branch" ".claude/worktrees/new-branch"',
      { encoding: 'utf8' }
    );
  });

  it('should return null when both attempts fail', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'));
    expect(await createWorktree('bad-branch')).toBeNull();
  });

  it('should return existing path without calling git when worktree already exists', async () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/feature-auth');
    expect(result).toMatch(/^\//);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe('removeWorktree', () => {
  it('should return true on success', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await removeWorktree('feature/auth')).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      'git worktree remove ".claude/worktrees/feature-auth"',
      { encoding: 'utf8' }
    );
  });

  it('should return false on failure', async () => {
    mockExec.mockRejectedValueOnce(new Error('not found'));
    expect(await removeWorktree('nonexistent')).toBe(false);
  });
});

describe('deleteBranch', () => {
  it('should return true on success and call git branch -d', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await deleteBranch('feature/auth')).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git branch -d "feature/auth"', {
      encoding: 'utf8',
    });
  });

  it('should return false on failure', async () => {
    mockExec.mockRejectedValueOnce(new Error('branch not found'));
    expect(await deleteBranch('nonexistent')).toBe(false);
  });

  it('should use -D flag when force is true', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await deleteBranch('feature/auth', true)).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git branch -D "feature/auth"', {
      encoding: 'utf8',
    });
  });

  it('should properly quote the branch name', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    await deleteBranch('feat/ui/sidebar');
    expect(mockExec).toHaveBeenCalledWith('git branch -d "feat/ui/sidebar"', {
      encoding: 'utf8',
    });
  });
});

describe('canRemoveBranch', () => {
  it('should reject main as protected', async () => {
    expect(await canRemoveBranch('main')).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });

  it('should reject master as protected', async () => {
    expect(await canRemoveBranch('master')).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });

  it('should reject gitbutler branches as protected', async () => {
    expect(await canRemoveBranch('gitbutler/integration')).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });

  it('should reject branches with uncommitted changes', async () => {
    mockExec.mockResolvedValueOnce(resolve(' M src/file.ts\n'));
    expect(await canRemoveBranch('feature/dirty')).toEqual({
      safe: false,
      reason: 'uncommitted changes',
    });
  });

  it('should reject branches not pushed to upstream', async () => {
    mockExec.mockResolvedValueOnce(resolve(''));
    mockExec.mockResolvedValueOnce(resolve('abc1234 some commit\n'));
    expect(await canRemoveBranch('feature/unpushed')).toEqual({
      safe: false,
      reason: 'not pushed to upstream',
    });
  });

  it('should return safe for clean, pushed branches', async () => {
    mockExec.mockResolvedValueOnce(resolve(''));
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/done')).toEqual({ safe: true });
  });

  it('should skip checks gracefully when worktree does not exist', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a directory'));
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/no-worktree')).toEqual({
      safe: true,
    });
  });

  it('should skip unpushed check when confirmedMerged is true', async () => {
    // Only the status check runs (returns clean), no git log call
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/squash-merged', true)).toEqual({
      safe: true,
    });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('should still reject uncommitted changes when confirmedMerged is true', async () => {
    mockExec.mockResolvedValueOnce(resolve(' M src/file.ts\n'));
    expect(await canRemoveBranch('feature/dirty-merged', true)).toEqual({
      safe: false,
      reason: 'uncommitted changes',
    });
  });

  it('should still reject protected branches when confirmedMerged is true', async () => {
    expect(await canRemoveBranch('master', true)).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });
});

describe('parseWorktrees', () => {
  it('should parse multiple worktrees from porcelain output', () => {
    const output = [
      'worktree /home/user/repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /home/user/repo/.claude/worktrees/feature-auth',
      'HEAD def456',
      'branch refs/heads/feature/auth',
      '',
      'worktree /home/user/repo/.claude/worktrees/fix-bug',
      'HEAD 789abc',
      'branch refs/heads/fix/bug',
      '',
    ].join('\n');

    const result = parseWorktrees(output);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      path: '/home/user/repo',
      branch: 'main',
      bare: false,
    });
    expect(result[1]).toEqual({
      path: '/home/user/repo/.claude/worktrees/feature-auth',
      branch: 'feature/auth',
      bare: false,
    });
    expect(result[2]).toEqual({
      path: '/home/user/repo/.claude/worktrees/fix-bug',
      branch: 'fix/bug',
      bare: false,
    });
  });

  it('should handle bare worktrees', () => {
    const output = ['worktree /home/user/repo', 'HEAD abc123', 'bare', ''].join(
      '\n'
    );

    const result = parseWorktrees(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.bare).toBe(true);
    expect(result[0]!.branch).toBe('');
  });

  it('should return empty array for empty output', () => {
    expect(parseWorktrees('')).toEqual([]);
    expect(parseWorktrees('\n')).toEqual([]);
  });
});

describe('listWorktrees', () => {
  const cwd = process.cwd();

  it('should return only resolver-owned entries, excluding main worktree', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          `worktree ${cwd}/.claude/worktrees/feature-auth`,
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
        ].join('\n')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });

  it('should filter out bare worktrees', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'bare',
          '',
          `worktree ${cwd}/.claude/worktrees/feature-auth`,
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
        ].join('\n')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });

  it('should return empty array when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listWorktrees()).toEqual([]);
  });

  it('should return empty array when no worktrees exist', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [`worktree ${cwd}`, 'HEAD abc123', 'branch refs/heads/main', ''].join(
          '\n'
        )
      )
    );

    expect(await listWorktrees()).toEqual([]);
  });

  it('should use custom resolver when set', async () => {
    setWorktreeResolver(
      createTemplateResolver('../{session}', '/repos/myrepo.git')
    );
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          'worktree /repos/myrepo.git',
          'HEAD abc123',
          'bare',
          '',
          'worktree /repos/feature-auth',
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
          'worktree /repos/fix-bug',
          'HEAD 789abc',
          'branch refs/heads/fix/bug',
          '',
          'worktree /other/unrelated',
          'HEAD 111222',
          'branch refs/heads/other',
          '',
        ].join('\n')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.branch)).toEqual(['feature/auth', 'fix/bug']);
  });

  it('should not false-positive on prefix collisions', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          `worktree ${cwd}/.claude/worktrees-old/stale`,
          'HEAD def456',
          'branch refs/heads/stale',
          '',
          `worktree ${cwd}/.claude/worktrees/feature-auth`,
          'HEAD 789abc',
          'branch refs/heads/feature/auth',
          '',
        ].join('\n')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });
});

describe('rebaseOntoMaster', () => {
  it('should return success when fetch and rebase both succeed', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve()); // rebase
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('success');
    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(mockExec).toHaveBeenCalledWith(
      'git -C "/path/to/worktree" fetch origin master',
      { encoding: 'utf8' }
    );
    expect(mockExec).toHaveBeenCalledWith(
      'git -C "/path/to/worktree" rebase origin/master',
      { encoding: 'utf8' }
    );
  });

  it('should return error when fetch fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(new Error('fetch failed'));
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('error');
    expect(mockExec).toHaveBeenCalledTimes(2); // getMainBranch + fetch
  });

  it('should return conflict and abort when rebase fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch succeeds
      .mockRejectedValueOnce(new Error('conflict')) // rebase fails
      .mockResolvedValueOnce(resolve()); // abort succeeds
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('conflict');
    expect(mockExec).toHaveBeenCalledTimes(4);
    expect(mockExec).toHaveBeenLastCalledWith(
      'git -C "/path/to/worktree" rebase --abort',
      { encoding: 'utf8' }
    );
  });

  it('should return conflict even when abort also fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch succeeds
      .mockRejectedValueOnce(new Error('conflict')) // rebase fails
      .mockRejectedValueOnce(new Error('abort failed')); // abort fails
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('conflict');
    expect(mockExec).toHaveBeenCalledTimes(4);
  });
});

describe('fetchRemote', () => {
  it('should return true on success', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await fetchRemote()).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git fetch --all --prune', {
      encoding: 'utf8',
    });
  });

  it('should return false when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('network error'));
    expect(await fetchRemote()).toBe(false);
  });
});

describe('listAllBranches', () => {
  it('should return deduplicated local and remote branches', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        'main\nfeature/auth\norigin/main\norigin/feature/auth\norigin/deploy\n'
      )
    );
    const branches = await listAllBranches();
    expect(branches).toEqual(['main', 'feature/auth', 'deploy']);
  });

  it('should filter out HEAD pointer', async () => {
    mockExec.mockResolvedValueOnce(resolve('main\norigin/HEAD\norigin/main\n'));
    expect(await listAllBranches()).toEqual(['main']);
  });

  it('should handle empty output', async () => {
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await listAllBranches()).toEqual([]);
  });

  it('should return empty array when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listAllBranches()).toEqual([]);
  });
});

describe('getMainBranch', () => {
  it('should detect main branch from symbolic-ref', async () => {
    mockExec.mockResolvedValueOnce(resolve('refs/remotes/origin/master'));
    expect(await getMainBranch()).toBe('master');
    expect(mockExec).toHaveBeenCalledWith(
      'git symbolic-ref refs/remotes/origin/HEAD',
      { encoding: 'utf8' }
    );
  });

  it('should detect "main" from symbolic-ref', async () => {
    mockExec.mockResolvedValueOnce(resolve('refs/remotes/origin/main'));
    expect(await getMainBranch()).toBe('main');
  });

  it('should fall back to rev-parse when symbolic-ref fails', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('no symbolic-ref'))
      .mockResolvedValueOnce(resolve());
    expect(await getMainBranch()).toBe('master');
    expect(mockExec).toHaveBeenCalledWith(
      'git rev-parse --verify --quiet origin/master',
      { encoding: 'utf8' }
    );
  });

  it('should default to "main" when both symbolic-ref and rev-parse fail', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('no symbolic-ref'))
      .mockRejectedValueOnce(new Error('no origin/master'));
    expect(await getMainBranch()).toBe('main');
  });

  it('should return cached value on subsequent calls', async () => {
    mockExec.mockResolvedValueOnce(resolve('refs/remotes/origin/master'));
    await getMainBranch();
    // Second call should not invoke exec again
    expect(await getMainBranch()).toBe('master');
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

describe('fastForwardMainBranch', () => {
  it('should use branch -f when HEAD is not on main branch', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve('feature/foo\n')) // symbolic-ref HEAD
      .mockResolvedValueOnce(resolve()); // branch -f
    expect(await fastForwardMainBranch()).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git fetch origin master', {
      encoding: 'utf8',
    });
    expect(mockExec).toHaveBeenCalledWith('git symbolic-ref --short HEAD', {
      encoding: 'utf8',
    });
    expect(mockExec).toHaveBeenCalledWith(
      'git branch -f master origin/master',
      { encoding: 'utf8' }
    );
  });

  it('should use merge --ff-only when HEAD IS on main branch', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve('master\n')) // symbolic-ref HEAD
      .mockResolvedValueOnce(resolve()); // merge --ff-only
    expect(await fastForwardMainBranch()).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git merge --ff-only origin/master', {
      encoding: 'utf8',
    });
  });

  it('should return false when fetch fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(new Error('fetch failed'));
    expect(await fastForwardMainBranch()).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(2); // getMainBranch + fetch
  });

  it('should return false when branch update fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve('feature/foo\n')) // symbolic-ref HEAD
      .mockRejectedValueOnce(new Error('branch update failed'));
    expect(await fastForwardMainBranch()).toBe(false);
  });

  it('should return false when HEAD is detached and branch -f fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockRejectedValueOnce(new Error('not a symbolic ref')); // symbolic-ref HEAD fails (detached)
    expect(await fastForwardMainBranch()).toBe(false);
  });
});

describe('countConflicts', () => {
  it('should return 0 for clean merge', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve('abc123'));
    expect(await countConflicts('feature/clean')).toBe(0);
    expect(mockExec).toHaveBeenCalledWith(
      'git merge-tree --write-tree origin/master "feature/clean"',
      { encoding: 'utf8' }
    );
  });

  it('should count CONFLICT lines from exit code 1', async () => {
    const err = new Error('merge conflict') as Error & {
      code: number;
      stdout: string;
    };
    err.code = 1;
    err.stdout = [
      'abc123',
      'CONFLICT (content): Merge conflict in src/file1.ts',
      'CONFLICT (content): Merge conflict in src/file2.ts',
      '',
    ].join('\n');
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(err);
    expect(await countConflicts('feature/conflicts')).toBe(2);
  });

  it('should return 0 for non-conflict errors', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(new Error('unknown error'));
    expect(await countConflicts('feature/broken')).toBe(0);
  });

  it('should return 0 when exit code is 1 but no CONFLICT lines', async () => {
    const err = new Error('merge issue') as Error & {
      code: number;
      stdout: string;
    };
    err.code = 1;
    err.stdout = 'abc123\n';
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(err);
    expect(await countConflicts('feature/weird')).toBe(0);
  });
});

describe('branchToSessionName', () => {
  it('should replace slashes with hyphens', () => {
    expect(branchToSessionName('feature/auth')).toBe('feature-auth');
  });

  it('should handle multiple slashes', () => {
    expect(branchToSessionName('feat/ui/sidebar')).toBe('feat-ui-sidebar');
  });

  it('should return names without slashes unchanged', () => {
    expect(branchToSessionName('main')).toBe('main');
  });

  it('should handle empty string', () => {
    expect(branchToSessionName('')).toBe('');
  });
});

describe('WorktreeResolver', () => {
  describe('default resolver', () => {
    it('dir() matches existing worktreeDir behavior', () => {
      // default resolver is active after resetWorktreeResolver in beforeEach
      // We test indirectly via createWorktree which calls worktreeDir
      // Just verify branchToSessionName is used consistently
      expect(branchToSessionName('feature/auth')).toBe('feature-auth');
    });

    it('owns() uses startsWith and rejects paths outside base', () => {
      const cwd = process.cwd();
      const base = pathResolve(cwd, '.claude/worktrees');
      // The default resolver should own paths under .claude/worktrees
      // We test via listWorktrees behavior (tested above)
      // Here we test createTemplateResolver as a proxy for the pattern
      const resolver = createTemplateResolver(
        '.claude/worktrees/{session}',
        cwd
      );
      expect(resolver.owns(`${base}/feature-auth`)).toBe(true);
      expect(resolver.owns(base)).toBe(true);
      expect(resolver.owns(`${base}-old/stale`)).toBe(false);
      expect(resolver.owns('/completely/different/path')).toBe(false);
    });
  });

  describe('createTemplateResolver', () => {
    it('with ../{session} produces sibling paths', () => {
      const resolver = createTemplateResolver(
        '../{session}',
        '/repos/myrepo.git'
      );
      expect(resolver.dir('feature/auth')).toBe('../feature-auth');
      expect(resolver.dir('main')).toBe('../main');
    });

    it('with {branch} preserves slashes', () => {
      const resolver = createTemplateResolver(
        'worktrees/{branch}',
        '/repos/myrepo'
      );
      expect(resolver.dir('feature/auth')).toBe('worktrees/feature/auth');
    });

    it('owns() derives base from template', () => {
      const resolver = createTemplateResolver(
        '../{session}',
        '/repos/myrepo.git'
      );
      // base = resolve('/repos/myrepo.git', '..') = '/repos'
      expect(resolver.owns('/repos/feature-auth')).toBe(true);
      expect(resolver.owns('/repos')).toBe(true);
      expect(resolver.owns('/repos-other/foo')).toBe(false);
      expect(resolver.owns('/other/path')).toBe(false);
    });

    it('owns() handles absolute template paths', () => {
      const resolver = createTemplateResolver(
        '/custom/worktrees/{session}',
        '/any'
      );
      expect(resolver.owns('/custom/worktrees/feature-auth')).toBe(true);
      expect(resolver.owns('/custom/worktrees')).toBe(true);
      expect(resolver.owns('/custom/other')).toBe(false);
    });

    it('with default-like template matches default resolver behavior', () => {
      const cwd = process.cwd();
      const resolver = createTemplateResolver(
        '.claude/worktrees/{session}',
        cwd
      );
      const base = pathResolve(cwd, '.claude/worktrees');
      expect(resolver.owns(`${base}/feature-auth`)).toBe(true);
      expect(resolver.owns(`${base}-old/stale`)).toBe(false);
    });
  });
});
