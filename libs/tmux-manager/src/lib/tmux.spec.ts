import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSessions,
  isAvailable,
  hasSession,
  killSession,
  createSession,
  listSessions,
  branchToSessionName,
} from './tmux.js';

vi.mock('./exec.js', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { execFile } from './exec.js';

const mockExecFile = vi.mocked(execFile);

function resolve(stdout = '') {
  return { stdout, stderr: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseSessions', () => {
  it('should parse a single session line', () => {
    const output = 'my-session|3|1708900000|1\n';
    const result = parseSessions(output);
    expect(result).toEqual([
      { name: 'my-session', windows: 3, created: 1708900000, attached: true },
    ]);
  });

  it('should parse multiple sessions', () => {
    const output = 'session-a|1|1708900000|0\nsession-b|2|1708900100|1\n';
    const result = parseSessions(output);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('session-a');
    expect(result[0]!.attached).toBe(false);
    expect(result[1]!.name).toBe('session-b');
    expect(result[1]!.attached).toBe(true);
  });

  it('should return empty array for empty output', () => {
    expect(parseSessions('')).toEqual([]);
    expect(parseSessions('\n')).toEqual([]);
  });
});

describe('isAvailable', () => {
  it('should return true when tmux is installed', async () => {
    mockExecFile.mockResolvedValueOnce(resolve('tmux 3.4'));
    expect(await isAvailable()).toBe(true);
  });

  it('should return false when tmux is not installed', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('command not found'));
    expect(await isAvailable()).toBe(false);
  });
});

describe('listSessions', () => {
  it('should parse tmux output into sessions', async () => {
    mockExecFile.mockResolvedValueOnce(
      resolve('work|2|1708900000|1\ntest|1|1708900100|0\n')
    );
    const sessions = await listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.name).toBe('work');
    expect(sessions[1]!.name).toBe('test');
  });

  it('should return empty array when tmux fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('no server running'));
    expect(await listSessions()).toEqual([]);
  });
});

describe('hasSession', () => {
  it('should return true when session exists', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await hasSession('my-session')).toBe(true);
  });

  it("should return false when session doesn't exist", async () => {
    mockExecFile.mockRejectedValueOnce(new Error('session not found'));
    expect(await hasSession('nonexistent')).toBe(false);
  });

  it('should reject invalid session names', async () => {
    await expect(hasSession('foo; rm -rf /')).rejects.toThrow(
      'Invalid tmux session name'
    );
  });
});

describe('createSession', () => {
  it('should create a detached session', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await createSession('my-session')).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session'],
      { encoding: 'utf8' }
    );
  });

  it('should pass dimensions when provided', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await createSession('my-session', 120, 40)).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', '-x', '120', '-y', '40'],
      { encoding: 'utf8' }
    );
  });

  it('should return false on failure', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('duplicate session'));
    expect(await createSession('existing')).toBe(false);
  });

  it('should reject invalid session names', async () => {
    await expect(createSession('foo; rm -rf /')).rejects.toThrow(
      'Invalid tmux session name'
    );
  });
});

describe('killSession', () => {
  it('should return true on success', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(await killSession('my-session')).toBe(true);
  });

  it('should return false on failure', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('session not found'));
    expect(await killSession('nonexistent')).toBe(false);
  });
});

describe('createSession with command', () => {
  it('should append command to tmux new-session via sh -c', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', 120, 40, 'claude --worktree main')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      [
        'new-session',
        '-d',
        '-s',
        'my-session',
        '-x',
        '120',
        '-y',
        '40',
        'sh',
        '-c',
        'claude --worktree main',
      ],
      { encoding: 'utf8' }
    );
  });

  it('should work with command but no dimensions', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession('my-session', undefined, undefined, 'bash')
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      ['new-session', '-d', '-s', 'my-session', 'sh', '-c', 'bash'],
      { encoding: 'utf8' }
    );
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

describe('createSession with cwd', () => {
  it('should include -c flag when cwd is provided', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession(
        'my-session',
        120,
        40,
        'claude',
        '/home/user/worktree'
      )
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      [
        'new-session',
        '-d',
        '-s',
        'my-session',
        '-x',
        '120',
        '-y',
        '40',
        '-c',
        '/home/user/worktree',
        'sh',
        '-c',
        'claude',
      ],
      { encoding: 'utf8' }
    );
  });

  it('should work with cwd but no command', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession(
        'my-session',
        120,
        40,
        undefined,
        '/home/user/worktree'
      )
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      [
        'new-session',
        '-d',
        '-s',
        'my-session',
        '-x',
        '120',
        '-y',
        '40',
        '-c',
        '/home/user/worktree',
      ],
      { encoding: 'utf8' }
    );
  });

  it('should handle paths with spaces in cwd', async () => {
    mockExecFile.mockResolvedValueOnce(resolve());
    expect(
      await createSession(
        'my-session',
        120,
        40,
        'claude',
        '/home/user/JBT Marel/worktree'
      )
    ).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'tmux',
      [
        'new-session',
        '-d',
        '-s',
        'my-session',
        '-x',
        '120',
        '-y',
        '40',
        '-c',
        '/home/user/JBT Marel/worktree',
        'sh',
        '-c',
        'claude',
      ],
      { encoding: 'utf8' }
    );
  });
});

describe('validateSessionName (via hasSession)', () => {
  it('should allow valid session names', async () => {
    mockExecFile.mockResolvedValue(resolve());
    await expect(hasSession('my-session')).resolves.not.toThrow();
    await expect(hasSession('feat_auth')).resolves.not.toThrow();
    await expect(hasSession('session.1')).resolves.not.toThrow();
  });

  it('should reject names with shell metacharacters', async () => {
    await expect(hasSession('foo; rm -rf /')).rejects.toThrow();
    await expect(hasSession('foo$(whoami)')).rejects.toThrow();
    await expect(hasSession('foo`id`')).rejects.toThrow();
    await expect(hasSession('foo|bar')).rejects.toThrow();
    await expect(hasSession('foo & bar')).rejects.toThrow();
  });
});
