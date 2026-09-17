import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(repo, 'orig.txt'), numbered(20));
  git(repo, ['add', 'orig.txt']);
  git(repo, ['commit', '-q', '-m', 'add orig']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  // Line 10 changed, line 30 removed: two hunks, well apart.
  writeFileSync(
    join(repo, 'a.txt'),
    numbered(40, { 10: 'changed 10' }).replace('line 30\n', '')
  );
  git(repo, ['commit', '-q', '-am', 'work']);
  // A rename plus a single-line edit, so the rename-detection fix has
  // something to prove: without it this diffs as a wholly new file.
  git(repo, ['mv', 'orig.txt', 'renamed.txt']);
  writeFileSync(join(repo, 'renamed.txt'), numbered(20, { 10: 'renamed 10' }));
  git(repo, ['commit', '-q', '-am', 'rename and edit']);
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

  /** `git diff -- <pathspec>` applies the pathspec before rename
   *  detection runs, so a rename diffed by its new name alone used to
   *  come back as a wholly new file — every line "commentable", none
   *  on the left. Finding the old name first and diffing with both
   *  restores the single edited hunk. */
  it('finds a renamed file by its old path, keeping only the edited hunk', async () => {
    const lines = await commentableLines({
      cwd: repo,
      targetBranch: 'main',
      file: 'renamed.txt',
    });
    expect(lines).toEqual({
      right: [{ start: 7, end: 13 }],
      left: [{ start: 7, end: 13 }],
    });
  });

  /** The pathspec is anchored to the repo root (`:(top,literal)`), so
   *  a path given relative to the root still resolves when the command
   *  runs from a subdirectory. */
  it('resolves a repo-root-relative path when run from a subdirectory', async () => {
    const sub = join(repo, 'sub');
    mkdirSync(sub, { recursive: true });
    const lines = await commentableLines({
      cwd: sub,
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
});

describe('commentableLines when the diff is too large to read fully', () => {
  let bigRepo: string;

  beforeAll(() => {
    bigRepo = mkdtempSync(join(tmpdir(), 'n10-anchor-big-'));
    git(bigRepo, ['init', '-q', '-b', 'main']);
    git(bigRepo, ['config', 'user.email', 't@example.com']);
    git(bigRepo, ['config', 'user.name', 't']);
    const lineOf = (ch: string) => `${ch.repeat(99)}\n`.repeat(100_000);
    writeFileSync(join(bigRepo, 'huge.txt'), lineOf('a'));
    git(bigRepo, ['add', '.']);
    git(bigRepo, ['commit', '-q', '-m', 'base']);
    git(bigRepo, ['checkout', '-q', '-b', 'feature']);
    // Every line differs from its counterpart, so nothing matches as
    // context: the patch is roughly twice the file, well past the
    // 16 MB ceiling.
    writeFileSync(join(bigRepo, 'huge.txt'), lineOf('b'));
    git(bigRepo, ['commit', '-q', '-am', 'rewrite']);
  });

  afterAll(() => {
    rmSync(bigRepo, { recursive: true, force: true });
  });

  /** A truncated patch is missing hunks the provider still knows
   *  about: reporting an incomplete range list as complete would let
   *  through an anchor that is really out of the diff. */
  it('throws instead of returning an incomplete range list', async () => {
    await expect(
      commentableLines({
        cwd: bigRepo,
        targetBranch: 'main',
        file: 'huge.txt',
      })
    ).rejects.toThrow(/too large/);
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

  /** GitHub requires `start_line` and `line` to fall in the same hunk:
   *  a range that starts in one hunk and ends in the next is refused
   *  even though both endpoints are individually commentable. */
  it('refuses a range that spans two hunks', () => {
    const twoHunks = {
      right: [
        { start: 7, end: 13 },
        { start: 27, end: 32 },
      ],
      left: [
        { start: 7, end: 13 },
        { start: 27, end: 32 },
      ],
    };
    expect(
      lineAnchorProblem(twoHunks, {
        file: 'a.txt',
        side: 'RIGHT',
        lineStart: 13,
        lineEnd: 27,
      })
    ).not.toBeNull();
  });

  /** A RIGHT anchor that misses but lands on a deleted line has a more
   *  useful answer than "not part of the diff": say which side to use. */
  it('suggests --side=LEFT when the missed lines were deleted, not added', () => {
    const withDeletion = {
      right: [{ start: 7, end: 13 }],
      left: [{ start: 7, end: 20 }],
    };
    const problem = lineAnchorProblem(withDeletion, {
      file: 'a.txt',
      side: 'RIGHT',
      lineStart: 15,
      lineEnd: 18,
    });
    expect(problem).toContain('--side=LEFT');
  });

  it('does not suggest --side=LEFT when the lines are not on the old side either', () => {
    const problem = at(93, 99);
    expect(problem).not.toContain('--side=LEFT');
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
