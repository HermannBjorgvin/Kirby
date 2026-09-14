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
  tmuxSetOption,
  tmuxShowOption,
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

// Options are set and read against the exact session — `=name:` — and
// never a prefix match: with `feature` and `feature-2` both live, a bare
// `-t feature` is ambiguous, and tmux picks for us.
describe('tmuxSetOption', () => {
  it('targets the session exactly, by `=name:`', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxSetOption('kirby-abc-feature', '@tag', 'value');
    expect(mockedExec.mock.calls[0]![1]).toEqual([
      'set-option',
      '-t',
      '=kirby-abc-feature:',
      '@tag',
      'value',
    ]);
  });

  it('reports a missing session as a non-zero exit rather than throwing', () => {
    mockedExec.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit'), { status: 1 });
    });
    expect(tmuxSetOption('missing', '@tag', 'v').exitCode).toBe(1);
  });
});

describe('tmuxShowOption', () => {
  it('reads one option value with `show-options -qv` against the exact session', () => {
    mockedExec.mockReturnValueOnce('/repo/x\n' as unknown as Buffer);
    expect(tmuxShowOption('kirby-abc-feature', '@tag')).toBe('/repo/x');
    expect(mockedExec.mock.calls[0]![1]).toEqual([
      'show-options',
      '-qv',
      '-t',
      '=kirby-abc-feature:',
      '@tag',
    ]);
  });

  // `-q` makes an unset option print nothing and exit zero; a missing
  // session or server exits non-zero. Both are "no value", not errors.
  it('is empty for an unset option and for a session that is not there', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    expect(tmuxShowOption('kirby-abc-feature', '@unset')).toBe('');
    mockedExec.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit'), { status: 1 });
    });
    expect(tmuxShowOption('missing', '@tag')).toBe('');
  });

  it('strips only the line terminator, keeping the value itself intact', () => {
    mockedExec.mockReturnValueOnce('  spaced  \n' as unknown as Buffer);
    expect(tmuxShowOption('s', '@tag')).toBe('  spaced  ');
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

  // A caller that wants session user options along with each name pays
  // the same single fork: the options are added to the format string.
  // They sit *between* the name and the path — a value never carries a
  // tab (the caller's contract for what it stores), the path may — so
  // the path is still everything after the last option column.
  describe('with session user options', () => {
    it('asks for each option in the format and reports the set ones by name', () => {
      mockedExec.mockReturnValueOnce(
        'kirby-abc-x\t/repo\tfeature/x\t\t/repo/.claude/worktrees/x\n' as unknown as Buffer
      );
      expect(
        tmuxListSessionsDetailed(['@x-repo', '@x-branch', '@x-agent'])
      ).toEqual([
        {
          name: 'kirby-abc-x',
          path: '/repo/.claude/worktrees/x',
          options: { '@x-repo': '/repo', '@x-branch': 'feature/x' },
        },
      ]);
      expect(mockedExec.mock.calls[0]![1]).toEqual([
        'list-sessions',
        '-F',
        '#{session_name}\t#{@x-repo}\t#{@x-branch}\t#{@x-agent}\t#{session_path}',
      ]);
    });

    // An unset option expands to the empty string in a format; it is
    // left out rather than reported as ''.
    it('reports no options at all for a session that has none set', () => {
      mockedExec.mockReturnValueOnce(
        'plain\t\t\t/home/dev\n' as unknown as Buffer
      );
      expect(tmuxListSessionsDetailed(['@a', '@b'])).toEqual([
        { name: 'plain', path: '/home/dev', options: {} },
      ]);
    });

    it('still keeps a tab inside the path intact', () => {
      mockedExec.mockReturnValueOnce(
        'kirby-term-shell-ab12\tv\t/odd\tdir\n' as unknown as Buffer
      );
      expect(tmuxListSessionsDetailed(['@a'])).toEqual([
        {
          name: 'kirby-term-shell-ab12',
          path: '/odd\tdir',
          options: { '@a': 'v' },
        },
      ]);
    });

    it('keeps the two-column format, and no options key, when none are asked for', () => {
      mockedExec.mockReturnValueOnce('a\t/p\n' as unknown as Buffer);
      expect(tmuxListSessionsDetailed([])).toEqual([{ name: 'a', path: '/p' }]);
      expect(mockedExec.mock.calls[0]![1]).toEqual([
        'list-sessions',
        '-F',
        '#{session_name}\t#{session_path}',
      ]);
    });
  });
});
