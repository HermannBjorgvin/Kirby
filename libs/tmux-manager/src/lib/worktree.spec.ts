import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWorktree,
  removeWorktree,
  canRemoveBranch,
  listBranches,
  fetchRemote,
  listAllBranches,
  parseWorktrees,
  listWorktrees,
  fastForwardMaster,
  countConflicts,
  rebaseOntoMaster,
} from './worktree.js';
import { existsSync } from 'node:fs';

vi.mock('./exec.js', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { execFile } from './exec.js';

const mockExecFile = vi.mocked(execFile);
const mockExistsSync = vi.mocked(existsSync);

function resolve(stdout = '') {
  return { stdout, stderr: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listBranches', () => {
  it('should parse git branch output into array', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve('main\nfeature/auth\nfix/bug-123\n')
    );
    const branches = await listBranches();
    expect(branches).toEqual(['main', 'feature/auth', 'fix/bug-123']);
  });

  it('should return empty array when git fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listBranches()).toEqual([]);
  });

  it('should filter out empty lines', async () => {
    mockExecFile.mockResolvedValueOnce(resolve('main\n\ndev\n'));
    expect(await listBranches()).toEqual(['main', 'dev']);
  });
});

describe('createWorktree', () => {
  it('should return absolute path for existing branch', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/feature-auth');
    expect(result).toMatch(/^\//); // absolute path
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '.claude/worktrees/feature-auth', 'feature/auth'],
      { encoding: 'utf8' }
    );
  });

  it('should fall back to -b for new branch', async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce(resolve());
    const result = await createWorktree('new-branch');
    expect(result).toContain('.claude/worktrees/new-branch');
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile).toHaveBeenLastCalledWith(
      'git',
      ['worktree', 'add', '-b', 'new-branch', '.claude/worktrees/new-branch'],
      { encoding: 'utf8' }
    );
  });

  it('should return null when both attempts fail', async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'));
    expect(await createWorktree('bad-branch')).toBeNull();
  });

  it('should return existing path without calling git when worktree already exists', async () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/feature-auth');
    expect(result).toMatch(/^\//);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe('removeWorktree', () => {
  it('should return true on success', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await removeWorktree('feature/auth')).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '.claude/worktrees/feature-auth'],
      { encoding: 'utf8' }
    );
  });

  it('should return false on failure', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not found'));
    expect(await removeWorktree('nonexistent')).toBe(false);
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
    mockExecFile.mockResolvedValueOnce(resolve(' M src/file.ts\n'));
    expect(await canRemoveBranch('feature/dirty')).toEqual({
      safe: false,
      reason: 'uncommitted changes',
    });
  });

  it('should reject branches not pushed to upstream', async () => {
    mockExecFile.mockResolvedValueOnce(resolve(''));
    mockExecFile.mockResolvedValueOnce(resolve('abc1234 some commit\n'));
    expect(await canRemoveBranch('feature/unpushed')).toEqual({
      safe: false,
      reason: 'not pushed to upstream',
    });
  });

  it('should return safe for clean, pushed branches', async () => {
    mockExecFile.mockResolvedValueOnce(resolve(''));
    mockExecFile.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/done')).toEqual({ safe: true });
  });

  it('should skip checks gracefully when worktree does not exist', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a directory'));
    mockExecFile.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/no-worktree')).toEqual({
      safe: true,
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
  it('should return only .claude/worktrees/ entries, excluding main worktree', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve(
        [
          'worktree /home/user/repo',
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          'worktree /home/user/repo/.claude/worktrees/feature-auth',
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
    mockExecFile.mockResolvedValueOnce(
      resolve(
        [
          'worktree /home/user/repo',
          'HEAD abc123',
          'bare',
          '',
          'worktree /home/user/repo/.claude/worktrees/feature-auth',
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
    mockExecFile.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listWorktrees()).toEqual([]);
  });

  it('should return empty array when no worktrees exist', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve(
        [
          'worktree /home/user/repo',
          'HEAD abc123',
          'branch refs/heads/main',
          '',
        ].join('\n')
      )
    );

    expect(await listWorktrees()).toEqual([]);
  });
});

describe('rebaseOntoMaster', () => {
  it('should return success when fetch and rebase both succeed', async () => {
    mockExecFile
      .mockResolvedValueOnce(resolve())
      .mockResolvedValueOnce(resolve());
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('success');
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-C', '/path/to/worktree', 'fetch', 'origin', 'master'],
      { encoding: 'utf8' }
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-C', '/path/to/worktree', 'rebase', 'origin/master'],
      { encoding: 'utf8' }
    );
  });

  it('should return error when fetch fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('fetch failed'));
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('error');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('should return conflict and abort when rebase fails', async () => {
    mockExecFile
      .mockResolvedValueOnce(resolve()) // fetch succeeds
      .mockRejectedValueOnce(new Error('conflict')) // rebase fails
      .mockResolvedValueOnce(resolve()); // abort succeeds
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('conflict');
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    expect(mockExecFile).toHaveBeenLastCalledWith(
      'git',
      ['-C', '/path/to/worktree', 'rebase', '--abort'],
      { encoding: 'utf8' }
    );
  });

  it('should return conflict even when abort also fails', async () => {
    mockExecFile
      .mockResolvedValueOnce(resolve()) // fetch succeeds
      .mockRejectedValueOnce(new Error('conflict')) // rebase fails
      .mockRejectedValueOnce(new Error('abort failed')); // abort fails
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('conflict');
    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });
});

describe('fetchRemote', () => {
  it('should return true on success', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await fetchRemote()).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['fetch', '--all', '--prune'],
      { encoding: 'utf8' }
    );
  });

  it('should return false when git fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('network error'));
    expect(await fetchRemote()).toBe(false);
  });
});

describe('listAllBranches', () => {
  it('should return deduplicated local and remote branches', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve(
        'main\nfeature/auth\norigin/main\norigin/feature/auth\norigin/deploy\n'
      )
    );
    const branches = await listAllBranches();
    expect(branches).toEqual(['main', 'feature/auth', 'deploy']);
  });

  it('should filter out HEAD pointer', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve('main\norigin/HEAD\norigin/main\n')
    );
    expect(await listAllBranches()).toEqual(['main']);
  });

  it('should handle empty output', async () => {
    mockExecFile.mockResolvedValueOnce(resolve(''));
    expect(await listAllBranches()).toEqual([]);
  });

  it('should return empty array when git fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listAllBranches()).toEqual([]);
  });
});

describe('fastForwardMaster', () => {
  it('should return true when fetch and branch update both succeed', async () => {
    mockExecFile
      .mockResolvedValueOnce(resolve())
      .mockResolvedValueOnce(resolve());
    expect(await fastForwardMaster()).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin', 'master'],
      { encoding: 'utf8' }
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['branch', '-f', 'master', 'origin/master'],
      { encoding: 'utf8' }
    );
  });

  it('should return false when fetch fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('fetch failed'));
    expect(await fastForwardMaster()).toBe(false);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('should return false when branch update fails', async () => {
    mockExecFile
      .mockResolvedValueOnce(resolve())
      .mockRejectedValueOnce(new Error('branch update failed'));
    expect(await fastForwardMaster()).toBe(false);
  });
});

describe('countConflicts', () => {
  it('should return 0 for clean merge', async () => {
    mockExecFile.mockResolvedValueOnce(resolve('abc123'));
    expect(await countConflicts('feature/clean')).toBe(0);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['merge-tree', '--write-tree', 'origin/master', 'feature/clean'],
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
    mockExecFile.mockRejectedValueOnce(err);
    expect(await countConflicts('feature/conflicts')).toBe(2);
  });

  it('should return 0 for non-conflict errors', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('unknown error'));
    expect(await countConflicts('feature/broken')).toBe(0);
  });

  it('should return 0 when exit code is 1 but no CONFLICT lines', async () => {
    const err = new Error('merge issue') as Error & {
      code: number;
      stdout: string;
    };
    err.code = 1;
    err.stdout = 'abc123\n';
    mockExecFile.mockRejectedValueOnce(err);
    expect(await countConflicts('feature/weird')).toBe(0);
  });
});
