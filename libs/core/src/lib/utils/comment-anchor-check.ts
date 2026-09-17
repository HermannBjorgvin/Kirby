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
const RENAME_STATUS = /^R\d+$/;

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
 * A pathspec that names `file` relative to the repo root regardless of
 * the cwd git runs from (`top`), and never as a glob (`literal`) — a
 * path that happens to contain `*`, `?`, `[` or a leading `:` is still
 * one file.
 */
function pathspec(file: string): string {
  return `:(top,literal)${file}`;
}

/**
 * The path `file` was renamed from between `base` and `HEAD`, or null
 * when it was not renamed.
 *
 * `git diff -- <pathspec>` applies the pathspec *before* rename
 * detection runs, so a renamed file diffed by its new name alone comes
 * back as a wholly new file — every line on the right, none on the
 * left. Finding the old name first and including it in the pathspec
 * restores rename detection.
 */
async function findRenameSource(
  base: string,
  file: string,
  cwd: string
): Promise<string | null> {
  const { text, truncated } = await runGit(
    ['diff', '--name-status', '-M', base, 'HEAD'],
    { cwd, maxBytes: MAX_PATCH_BYTES }
  );
  if (truncated) {
    throw new Error(
      `The pull request's file list was too large to check ${file} against ` +
        `the diff`
    );
  }
  for (const line of text.split('\n')) {
    const [status, from, to] = line.split('\t');
    if (to === file && status && RENAME_STATUS.test(status)) return from;
  }
  return null;
}

/**
 * The commentable lines of `file` in the pull request that merges
 * `cwd`'s HEAD into `targetBranch`, or null when the file is not in
 * that diff at all. Throws when the target cannot be resolved, or when
 * the diff itself is too large to read fully, so the caller can decide
 * whether an unverifiable anchor is allowed through.
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
  const renamedFrom = await findRenameSource(base, opts.file, opts.cwd);
  const pathspecs = renamedFrom
    ? [pathspec(renamedFrom), pathspec(opts.file)]
    : [pathspec(opts.file)];
  const { text, truncated } = await runGit(
    [
      'diff',
      `-U${CONTEXT_LINES}`,
      '--no-color',
      base,
      'HEAD',
      '--',
      ...pathspecs,
    ],
    { cwd: opts.cwd, maxBytes: MAX_PATCH_BYTES }
  );
  if (truncated) {
    throw new Error(
      `The diff for ${opts.file} was too large to check against the pull ` +
        `request's diff`
    );
  }
  if (text.trim() === '') return null;
  return parseHunkRanges(text);
}

/** Whether the whole `[lineStart, lineEnd]` range sits inside a single
 *  hunk — the provider requires `start_line` and `line` to share one
 *  hunk, so a range spanning two is refused even when both ends are
 *  individually commentable. */
function fitsOneHunk(
  ranges: LineRange[],
  lineStart: number,
  lineEnd: number
): boolean {
  return ranges.some((r) => lineStart >= r.start && lineEnd <= r.end);
}

function describeRanges(ranges: LineRange[]): string {
  return ranges
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
    .join(', ');
}

/**
 * Why the provider would refuse a remark anchored to this whole file:
 * it is not part of the pull request's diff, so there is nothing on it
 * to comment on. Shared by `lineAnchorProblem` (a line anchor whose
 * file is out of the diff) and `n10 util add-comment`'s check of a
 * whole-file anchor, so the wording lives in one place.
 */
export function fileAnchorProblem(file: string): string {
  return (
    `${file} is not part of this pull request's diff, so nothing in ` +
    `it can be commented on. Comment on a changed file, or omit --file for ` +
    `a remark about the pull request.`
  );
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
    return fileAnchorProblem(anchor.file);
  }
  const ranges = anchor.side === 'LEFT' ? lines.left : lines.right;
  if (fitsOneHunk(ranges, anchor.lineStart, anchor.lineEnd)) return null;
  const sideNote = anchor.side === 'LEFT' ? ' (old-file lines)' : '';
  const parts = [
    `${where} is not part of this pull request's diff. The provider only ` +
      `accepts line comments on changed lines and the ${CONTEXT_LINES} lines ` +
      `of context around them, all within one hunk; the commentable lines in ` +
      `${anchor.file}${sideNote} are ${describeRanges(ranges) || 'none'}.`,
  ];
  if (
    anchor.side === 'RIGHT' &&
    fitsOneHunk(lines.left, anchor.lineStart, anchor.lineEnd)
  ) {
    parts.push(
      'Those lines were removed, not added — comment on the old-file side ' +
        'with --side=LEFT.'
    );
  }
  parts.push(alternatives);
  return parts.join(' ');
}
