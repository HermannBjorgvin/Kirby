import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { tmuxHasSession, tmuxKillSession, tmuxVersion } from './tmux-cli.js';

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
