import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitLine, runGit } from './git-run.js';

/**
 * The ceiling is a stop, not an error.
 *
 * `execFile` throws away everything it read the moment the output
 * exceeds its buffer, and hands the caller
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` instead. That is the failure the
 * worktree diff kept hitting, so the contract worth pinning here is the
 * opposite one: what arrived is returned, and the caller is told it is a
 * prefix.
 */

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'kirby-git-run-'));
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repo,
  });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'file.txt'), `${'y'.repeat(79)}\n`.repeat(4000));
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('runGit', () => {
  it('returns the whole output when it fits', async () => {
    const { text, truncated } = await runGit(['show', '--stat', 'HEAD'], {
      cwd: repo,
      maxBytes: 1024 * 1024,
    });
    expect(truncated).toBe(false);
    expect(text).toContain('file.txt');
  });

  it('stops at the ceiling and keeps what it read', async () => {
    const { text, truncated } = await runGit(['show', 'HEAD:file.txt'], {
      cwd: repo,
      maxBytes: 500,
    });
    expect(truncated).toBe(true);
    expect(text).toHaveLength(500);
    expect(text.startsWith('yyy')).toBe(true);
  });

  it('does not call output that lands exactly on the ceiling truncated', async () => {
    // Off by one here is not cosmetic: the caller answers `truncated`
    // by trimming its last complete file away and appending a note
    // saying the diff was cut short, for a diff that was whole.
    const whole = await runGit(['show', 'HEAD:file.txt'], {
      cwd: repo,
      maxBytes: 1024 * 1024,
    });
    const exact = await runGit(['show', 'HEAD:file.txt'], {
      cwd: repo,
      maxBytes: Buffer.byteLength(whole.text),
    });
    expect(exact).toEqual({ text: whole.text, truncated: false });
  });

  it('rejects with git’s own complaint when the command really fails', async () => {
    await expect(
      runGit(['rev-parse', '--verify', 'no-such-ref'], {
        cwd: repo,
        maxBytes: 1024,
      })
    ).rejects.toThrow(/rev-parse failed/);
  });

  it('rejects when git is not looking at a repository', async () => {
    await expect(
      runGit(['status'], { cwd: tmpdir(), maxBytes: 1024 })
    ).rejects.toThrow();
  });
});

describe('gitLine', () => {
  it('trims the trailing newline off a one-line answer', async () => {
    const sha = await gitLine(['rev-parse', 'HEAD'], { cwd: repo });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
