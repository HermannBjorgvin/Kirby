import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import {
  isDuplicateSession,
  sessionNameCandidates,
  tmuxAttachArgs,
  tmuxFreeSessionName,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessions,
  tmuxListSessionsDetailed,
  tmuxNewSessionDetached,
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
  // Exact: once `bar` is gone a bare `-t bar` is a prefix match and
  // would kill `bar-2`.
  it('calls `tmux kill-session -t =NAME:`', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxKillSession('bar');
    const call = mockedExec.mock.calls[0]!;
    expect(call[0]).toBe('tmux');
    expect(call[1]).toEqual(['kill-session', '-t', '=bar:']);
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

  it('asks about exactly the name, never a prefix of a longer one', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxHasSession('baz');
    const call = mockedExec.mock.calls[0]!;
    expect(call[0]).toBe('tmux');
    expect(call[1]).toEqual(['has-session', '-t', '=baz:']);
  });
});

describe('tmuxNewSessionDetached', () => {
  it('creates detached with the name, directory, size, flags and command in that order', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    const result = tmuxNewSessionDetached('repo-feat', {
      cwd: '/wt/feat',
      cols: 120,
      rows: 40,
      flags: ['-e', 'HOME=/home/dev'],
      command: ['--', '/bin/sh', '-c', 'claude'],
    });
    expect(result.exitCode).toBe(0);
    expect(mockedExec.mock.calls[0]![1]).toEqual([
      'new-session',
      '-d',
      '-s',
      'repo-feat',
      '-c',
      '/wt/feat',
      '-x',
      '120',
      '-y',
      '40',
      '-e',
      'HOME=/home/dev',
      '--',
      '/bin/sh',
      '-c',
      'claude',
    ]);
  });

  it('ends the argv at the size when there is no command, so tmux runs its default shell', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxNewSessionDetached('repo-shell', { cwd: '/repo', cols: 80, rows: 24 });
    expect(mockedExec.mock.calls[0]![1]?.slice(-2)).toEqual(['-y', '24']);
  });

  // The race a creator has to answer: the name was free a moment ago
  // and is not now. tmux names the failure, and nothing else is one.
  it('reports a taken name as a duplicate rather than throwing', () => {
    mockedExec.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit'), {
        status: 1,
        stderr: 'duplicate session: repo-feat\n',
      });
    });
    const result = tmuxNewSessionDetached('repo-feat', {
      cwd: '/wt',
      cols: 80,
      rows: 24,
    });
    expect(result.exitCode).toBe(1);
    expect(isDuplicateSession(result)).toBe(true);
    expect(
      isDuplicateSession({
        stdout: '',
        stderr: 'error connecting',
        exitCode: 1,
      })
    ).toBe(false);
    expect(isDuplicateSession({ stdout: '', stderr: '', exitCode: 0 })).toBe(
      false
    );
  });
});

describe('tmuxAttachArgs', () => {
  it('attaches to exactly the named session', () => {
    expect(tmuxAttachArgs('repo-feat')).toEqual([
      'attach-session',
      '-t',
      '=repo-feat:',
    ]);
  });
});

describe('free-name probing', () => {
  it('tries the name, then -2, -3, …', () => {
    const it3 = sessionNameCandidates('repo-feat');
    expect([it3.next().value, it3.next().value, it3.next().value]).toEqual([
      'repo-feat',
      'repo-feat-2',
      'repo-feat-3',
    ]);
  });

  it('answers the first candidate the server does not hold, one has-session per candidate', () => {
    // `repo-shell` and `repo-shell-2` exist; `-3` does not.
    mockedExec
      .mockReturnValueOnce('' as unknown as Buffer)
      .mockReturnValueOnce('' as unknown as Buffer)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('exit'), { status: 1 });
      });
    expect(tmuxFreeSessionName('repo-shell')).toBe('repo-shell-3');
    expect(mockedExec.mock.calls.map((c) => c[1])).toEqual([
      ['has-session', '-t', '=repo-shell:'],
      ['has-session', '-t', '=repo-shell-2:'],
      ['has-session', '-t', '=repo-shell-3:'],
    ]);
  });

  it('lets the caller fold in names it holds itself', () => {
    const mine = new Set(['repo-shell']);
    expect(tmuxFreeSessionName('repo-shell', (n) => mine.has(n))).toBe(
      'repo-shell-2'
    );
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('gives up rather than probing forever', () => {
    expect(() => tmuxFreeSessionName('x', () => true)).toThrow(/no free/);
  });
});

// Options are set and read against the exact session — `=name:` — and
// never a prefix match: with `feature` and `feature-2` both live, a bare
// `-t feature` is ambiguous, and tmux picks for us.
describe('tmuxSetOption', () => {
  it('targets the session exactly, by `=name:`', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    tmuxSetOption('repo-feature', '@tag', 'value');
    expect(mockedExec.mock.calls[0]![1]).toEqual([
      'set-option',
      '-t',
      '=repo-feature:',
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
    expect(tmuxShowOption('repo-feature', '@tag')).toBe('/repo/x');
    expect(mockedExec.mock.calls[0]![1]).toEqual([
      '-u',
      'show-options',
      '-qv',
      '-t',
      '=repo-feature:',
      '@tag',
    ]);
  });

  // `-q` makes an unset option print nothing and exit zero; a missing
  // session or server exits non-zero. Both are "no value", not errors.
  it('is empty for an unset option and for a session that is not there', () => {
    mockedExec.mockReturnValueOnce('' as unknown as Buffer);
    expect(tmuxShowOption('repo-feature', '@unset')).toBe('');
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
      'repo-feature-x\t1\t/wt/x\nrepo-feature-y\t2\t/wt/y\nunrelated\t3\t/home\n' as unknown as Buffer
    );
    expect(tmuxListSessions()).toEqual([
      'repo-feature-x',
      'repo-feature-y',
      'unrelated',
    ]);
    const call = mockedExec.mock.calls[0]!;
    expect(call[0]).toBe('tmux');
    expect(call[1]).toEqual([
      '-u',
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_created}\t#{session_path}',
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
    mockedExec.mockReturnValueOnce(
      'one\t1\t/a\n\n  \ntwo\t2\t/b\n' as unknown as Buffer
    );
    expect(tmuxListSessions()).toEqual(['one', 'two']);
  });
});

describe('tmuxListSessionsDetailed', () => {
  // The directory a session was started in is what identifies a
  // terminal session — there is no state file — so it has to come back
  // with the name from the one `list-sessions` fork a scan makes.
  it('pairs every name with its creation time and the directory it was started in', () => {
    mockedExec.mockReturnValueOnce(
      'proj-shell\t1757900000\t/home/dev/proj\nrepo-x\t1757900100\t/repo/.claude/worktrees/x\n' as unknown as Buffer
    );
    expect(tmuxListSessionsDetailed()).toEqual([
      { name: 'proj-shell', created: 1757900000, path: '/home/dev/proj' },
      {
        name: 'repo-x',
        created: 1757900100,
        path: '/repo/.claude/worktrees/x',
      },
    ]);
  });

  // A tab is a legal character in a directory name; the name comes
  // first and never contains one (the sanitizer only ever emits what it
  // was given, and nothing composes a name with a tab), so the split is
  // at the first tab and the rest is the path.
  it('keeps a path that itself contains a tab intact', () => {
    mockedExec.mockReturnValueOnce(
      'proj-shell\t5\t/odd\tdir\n' as unknown as Buffer
    );
    expect(tmuxListSessionsDetailed()).toEqual([
      { name: 'proj-shell', created: 5, path: '/odd\tdir' },
    ]);
  });

  it('reports a session with no path as an empty one rather than dropping it', () => {
    mockedExec.mockReturnValueOnce('bare\n' as unknown as Buffer);
    expect(tmuxListSessionsDetailed()).toEqual([
      { name: 'bare', created: 0, path: '' },
    ]);
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
        'repo-x\t7\t/repo\tfeature/x\t\t/repo/.claude/worktrees/x\n' as unknown as Buffer
      );
      expect(
        tmuxListSessionsDetailed(['@x-repo', '@x-branch', '@x-agent'])
      ).toEqual([
        {
          name: 'repo-x',
          created: 7,
          path: '/repo/.claude/worktrees/x',
          options: { '@x-repo': '/repo', '@x-branch': 'feature/x' },
        },
      ]);
      expect(mockedExec.mock.calls[0]![1]).toEqual([
        '-u',
        'list-sessions',
        '-F',
        '#{session_name}\t#{session_created}\t#{@x-repo}\t#{@x-branch}\t#{@x-agent}\t#{session_path}',
      ]);
    });

    // An unset option expands to the empty string in a format; it is
    // left out rather than reported as ''.
    it('reports no options at all for a session that has none set', () => {
      mockedExec.mockReturnValueOnce(
        'plain\t9\t\t\t/home/dev\n' as unknown as Buffer
      );
      expect(tmuxListSessionsDetailed(['@a', '@b'])).toEqual([
        { name: 'plain', created: 9, path: '/home/dev', options: {} },
      ]);
    });

    it('still keeps a tab inside the path intact', () => {
      mockedExec.mockReturnValueOnce(
        'proj-shell\t9\tv\t/odd\tdir\n' as unknown as Buffer
      );
      expect(tmuxListSessionsDetailed(['@a'])).toEqual([
        {
          name: 'proj-shell',
          created: 9,
          path: '/odd\tdir',
          options: { '@a': 'v' },
        },
      ]);
    });

    it('keeps the two-column format, and no options key, when none are asked for', () => {
      mockedExec.mockReturnValueOnce('a\t3\t/p\n' as unknown as Buffer);
      expect(tmuxListSessionsDetailed([])).toEqual([
        { name: 'a', created: 3, path: '/p' },
      ]);
      expect(mockedExec.mock.calls[0]![1]).toEqual([
        '-u',
        'list-sessions',
        '-F',
        '#{session_name}\t#{session_created}\t#{session_path}',
      ]);
    });
  });

  // tmux decides from LANG/LC_CTYPE/LC_ALL whether its client is UTF-8
  // and, when it is not, rewrites the tab between columns to `_`, which
  // folds every column into the name. `-u` declares the client UTF-8
  // whatever the locale says.
  it('asks for UTF-8 output so a non-UTF-8 locale cannot rewrite the tabs', () => {
    mockedExec.mockReturnValueOnce('a\t3\t/p\n' as unknown as Buffer);
    tmuxListSessionsDetailed();
    expect(mockedExec.mock.calls[0]![1]?.[0]).toBe('-u');
  });
});
