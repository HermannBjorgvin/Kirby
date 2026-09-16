import { resolveRef } from './diff-fetcher.js';
import { gitLine, runGit } from './git-run.js';

/**
 * Whether a line anchor is one the provider will accept.
 *
 * GitHub refuses a review comment on any line outside the pull
 * request's diff — the changed lines and the three lines of context
 * around each hunk — with a 422 that names nothing the agent can act
 * on, long after the draft was written. The check runs when the draft
 * is written instead, against the same merge-base diff the provider
 * shows, so the agent is told which lines it *can* use and can pick
 * one, or say the remark is about the whole file or the whole pull
 * request (see `commentAnchor` in `@n10/review-comments`).
 */

export interface LineRange {
  start: number;
  end: number;
}

/** The lines a comment may anchor to, per side of the diff. */
export interface CommentableLines {
  /** New-file lines (RIGHT): every hunk's `+start,count`. */
  right: LineRange[];
  /** Old-file lines (LEFT): every hunk's `-start,count`. */
  left: LineRange[];
}

/** A hunk-count patch has 3 lines of context, as the provider's does. */
const CONTEXT_LINES = 3;

/** A single file's patch is never large enough to matter; the ceiling
 *  is a backstop against a generated file. */
const MAX_PATCH_BYTES = 16 * 1024 * 1024;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function range(start: string, count: string | undefined): LineRange | null {
  const n = count === undefined ? 1 : Number(count);
  if (n === 0) return null;
  const s = Number(start);
  return { start: s, end: s + n - 1 };
}

/** The line ranges each `@@` header of a unified diff covers. */
export function parseHunkRanges(patch: string): CommentableLines {
  const right: LineRange[] = [];
  const left: LineRange[] = [];
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (!m) continue;
    const l = range(m[1], m[2]);
    const r = range(m[3], m[4]);
    if (l) left.push(l);
    if (r) right.push(r);
  }
  return { right, left };
}

/**
 * The commentable lines of `file` in the pull request that merges
 * `cwd`'s HEAD into `targetBranch`, or null when the file is not in
 * that diff at all. Throws when the target cannot be resolved, so the
 * caller can decide whether an unverifiable anchor is allowed through.
 */
export async function commentableLines(opts: {
  cwd: string;
  targetBranch: string;
  file: string;
}): Promise<CommentableLines | null> {
  const targetRef = await resolveRef(opts.targetBranch, opts.cwd);
  const base = await gitLine(['merge-base', targetRef, 'HEAD'], {
    cwd: opts.cwd,
  });
  const { text } = await runGit(
    ['diff', `-U${CONTEXT_LINES}`, '--no-color', base, 'HEAD', '--', opts.file],
    { cwd: opts.cwd, maxBytes: MAX_PATCH_BYTES }
  );
  if (text.trim() === '') return null;
  return parseHunkRanges(text);
}

function within(ranges: LineRange[], line: number): boolean {
  return ranges.some((r) => line >= r.start && line <= r.end);
}

function describeRanges(ranges: LineRange[]): string {
  return ranges
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
    .join(', ');
}

/**
 * Why the provider would refuse this anchor, in words the agent can
 * act on, or null when it would take it.
 */
export function lineAnchorProblem(
  lines: CommentableLines | null,
  anchor: {
    file: string;
    side: 'LEFT' | 'RIGHT';
    lineStart: number;
    lineEnd: number;
  }
): string | null {
  const where = `${anchor.file}:${
    anchor.lineStart === anchor.lineEnd
      ? anchor.lineStart
      : `${anchor.lineStart}-${anchor.lineEnd}`
  }`;
  const alternatives =
    'Anchor to one of those lines, omit --lineStart/--lineEnd for a remark ' +
    'about the whole file, or omit --file too for a remark about the pull request.';
  if (lines === null) {
    return (
      `${anchor.file} is not part of this pull request's diff, so nothing in ` +
      `it can be commented on. Comment on a changed file, or omit --file for ` +
      `a remark about the pull request.`
    );
  }
  const ranges = anchor.side === 'LEFT' ? lines.left : lines.right;
  if (within(ranges, anchor.lineStart) && within(ranges, anchor.lineEnd)) {
    return null;
  }
  const sideNote = anchor.side === 'LEFT' ? ' (old-file lines)' : '';
  return (
    `${where} is not part of this pull request's diff. The provider only ` +
    `accepts line comments on changed lines and the ${CONTEXT_LINES} lines of ` +
    `context around them; the commentable lines in ${anchor.file}${sideNote} ` +
    `are ${describeRanges(ranges) || 'none'}. ${alternatives}`
  );
}
