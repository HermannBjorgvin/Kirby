import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  commentableLines,
  lineAnchorProblem,
  parseHunkRanges,
} from './comment-anchor-check.js';

/**
 * The anchor check against real git, because what it reports is git's
 * own hunk arithmetic: where the three lines of context start and end
 * is the whole question, and a hand-written patch would only prove the
 * parser agrees with itself.
 */

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

const numbered = (n: number, edits: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => edits[i + 1] ?? `line ${i + 1}`).join(
    '\n'
  ) + '\n';

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'n10-anchor-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@example.com']);
  git(repo, ['config', 'user.name', 't']);
  writeFileSync(join(repo, 'a.txt'), numbered(40));
  writeFileSync(join(repo, 'untouched.txt'), numbered(5));
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  // Line 10 changed, line 30 removed: two hunks, well apart.
  writeFileSync(
    join(repo, 'a.txt'),
    numbered(40, { 10: 'changed 10' }).replace('line 30\n', '')
  );
  git(repo, ['commit', '-q', '-am', 'work']);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('commentableLines', () => {
  it('covers each hunk with its context, on both sides', async () => {
    const lines = await commentableLines({
      cwd: repo,
      targetBranch: 'main',
      file: 'a.txt',
    });
    expect(lines).toEqual({
      right: [
        { start: 7, end: 13 },
        { start: 27, end: 32 },
      ],
      left: [
        { start: 7, end: 13 },
        { start: 27, end: 33 },
      ],
    });
  });

  it('is null for a file the pull request does not touch', async () => {
    await expect(
      commentableLines({
        cwd: repo,
        targetBranch: 'main',
        file: 'untouched.txt',
      })
    ).resolves.toBeNull();
  });

  it('throws when the target branch cannot be resolved', async () => {
    await expect(
      commentableLines({ cwd: repo, targetBranch: 'no-such', file: 'a.txt' })
    ).rejects.toThrow(/Cannot resolve ref/);
  });
});

describe('parseHunkRanges', () => {
  it('reads a count-less header as one line and drops empty sides', () => {
    expect(parseHunkRanges('@@ -0,0 +1 @@\n+only\n')).toEqual({
      right: [{ start: 1, end: 1 }],
      left: [],
    });
  });
});

describe('lineAnchorProblem', () => {
  const lines = {
    right: [{ start: 7, end: 13 }],
    left: [{ start: 7, end: 13 }],
  };
  const at = (
    lineStart: number,
    lineEnd = lineStart,
    side: 'LEFT' | 'RIGHT' = 'RIGHT'
  ) => lineAnchorProblem(lines, { file: 'a.txt', side, lineStart, lineEnd });

  it('accepts a range inside a hunk', () => {
    expect(at(7, 13)).toBeNull();
  });

  /** The message is the agent's only guidance at that moment: it must
   *  say which lines would work and what the other two anchors are. */
  it('names the commentable lines and the anchors that need none', () => {
    const problem = at(93, 99) ?? '';
    expect(problem).toContain('a.txt:93-99 is not part of this pull request');
    expect(problem).toContain('are 7-13');
    expect(problem).toContain('omit --lineStart/--lineEnd');
    expect(problem).toContain('omit --file too');
  });

  it('rejects a range that only starts inside a hunk', () => {
    expect(at(12, 14)).not.toBeNull();
  });

  it('checks the old-file side for a LEFT comment', () => {
    expect(at(7, 7, 'LEFT')).toBeNull();
    expect(at(20, 20, 'LEFT')).toContain('(old-file lines)');
  });

  it('says so when the file is not in the diff at all', () => {
    expect(
      lineAnchorProblem(null, {
        file: 'b.txt',
        side: 'RIGHT',
        lineStart: 1,
        lineEnd: 1,
      })
    ).toContain('b.txt is not part of this pull request');
  });
});
