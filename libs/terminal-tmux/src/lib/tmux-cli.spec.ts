import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessions,
  tmuxListSessionsDetailed,
  tmuxVersion,
} from './tmux-cli.js';

const mockedExec = vi.mocked(execFileSync);

beforeEach(() => mockedExec.mockReset());

describe('tmuxVersion', () => {
  it('returns trimmed stdout from `tmux -V`', () => {
    mockedExec.mockReturnValueOnce('tmux 3.4\n' as unknown as Buffer);
    expect(tmuxVersion()).toBe('tmux 3.4');
    expect(mockedExec).toHaveBeenCalledWith(
      'tmux',
      ['-V'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('throws when tmux is missing', () => {
    mockedExec.mockImplementationOnce(() => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw err;
    });
    expect(() => tmuxVersion()).toThrow();
  });
});

describe('tmuxKillSession', () => {
  it('calls `tmux kill-session -t NAME`', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxKillSession('kirby-bar');
    const call = mockedExec.mock.calls[0]!;
    expect(call[0]).toBe('tmux');
    expect(call[1]).toEqual(['kill-session', '-t', 'kirby-bar']);
  });

  it('does not throw if the session does not exist', () => {
    mockedExec.mockImplementationOnce(() => {
      const err = Object.assign(new Error('exit'), {
        status: 1,
        stderr: 'no such session',
      });
      throw err;
    });
    const result = tmuxKillSession('missing');
    expect(result.exitCode).toBe(1);
  });
});

describe('tmuxHasSession', () => {
  it('returns true on exit code 0', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    expect(tmuxHasSession('foo')).toBe(true);
  });

  it('returns false on exit code 1', () => {
    mockedExec.mockImplementationOnce(() => {
      const err = Object.assign(new Error('exit'), { status: 1 });
      throw err;
    });
    expect(tmuxHasSession('missing')).toBe(false);
  });

  it('passes the name through `-t` arg', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxHasSession('kirby-baz');
    const call = mockedExec.mock.calls[0]!;
    expect(call[0]).toBe('tmux');
    expect(call[1]).toEqual(['has-session', '-t', 'kirby-baz']);
  });
});

describe('tmuxListSessions', () => {
  it('returns one name per line of `list-sessions -F`', () => {
    mockedExec.mockReturnValueOnce(
      'kirby-abc-feature-x\t/wt/x\nkirby-abc-feature-y\t/wt/y\nunrelated\t/home\n' as unknown as Buffer
    );
    expect(tmuxListSessions()).toEqual([
      'kirby-abc-feature-x',
      'kirby-abc-feature-y',
      'unrelated',
    ]);
    const call = mockedExec.mock.calls[0]!;
    expect(call[0]).toBe('tmux');
    expect(call[1]).toEqual([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_path}',
    ]);
  });

  it('returns [] when there is no server (non-zero exit)', () => {
    mockedExec.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit'), {
        status: 1,
        stderr: 'no server running on /tmp/tmux-1000/default',
      });
    });
    expect(tmuxListSessions()).toEqual([]);
  });

  it('drops blank lines rather than yielding empty names', () => {
    mockedExec.mockReturnValueOnce('one\n\n  \ntwo\n' as unknown as Buffer);
    expect(tmuxListSessions()).toEqual(['one', 'two']);
  });
});

describe('tmuxListSessionsDetailed', () => {
  // The directory a session was started in is what identifies a
  // terminal session — there is no state file — so it has to come back
  // with the name from the one `list-sessions` fork a scan makes.
  it('pairs every name with the directory the session was started in', () => {
    mockedExec.mockReturnValueOnce(
      'kirby-term-shell-ab12\t/home/dev/proj\nkirby-abc-x\t/repo/.claude/worktrees/x\n' as unknown as Buffer
    );
    expect(tmuxListSessionsDetailed()).toEqual([
      { name: 'kirby-term-shell-ab12', path: '/home/dev/proj' },
      { name: 'kirby-abc-x', path: '/repo/.claude/worktrees/x' },
    ]);
  });

  // A tab is a legal character in a directory name; the name comes
  // first and never contains one (the sanitizer only ever emits what it
  // was given, and nothing composes a name with a tab), so the split is
  // at the first tab and the rest is the path.
  it('keeps a path that itself contains a tab intact', () => {
    mockedExec.mockReturnValueOnce(
      'kirby-term-shell-ab12\t/odd\tdir\n' as unknown as Buffer
    );
    expect(tmuxListSessionsDetailed()).toEqual([
      { name: 'kirby-term-shell-ab12', path: '/odd\tdir' },
    ]);
  });

  it('reports a session with no path as an empty one rather than dropping it', () => {
    mockedExec.mockReturnValueOnce('bare\n' as unknown as Buffer);
    expect(tmuxListSessionsDetailed()).toEqual([{ name: 'bare', path: '' }]);
  });

  it('returns [] when there is no server', () => {
    mockedExec.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit'), { status: 1 });
    });
    expect(tmuxListSessionsDetailed()).toEqual([]);
  });
});
