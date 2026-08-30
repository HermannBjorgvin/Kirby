import type { DiffLine } from '@kirby/diff';
import type { ReviewComment } from './types.js';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { InsertionMap } from './comment-placement.js';
import {
  computeInsertionMap,
  computeRemoteInsertionMap,
} from './comment-placement.js';

// Dim ANSI — only used for the separator rows below (`── comments on
// lines not in diff ──` etc.). Diff rows themselves no longer carry
// pre-rendered ANSI; the renderer component owns their presentation.
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ── AnnotatedLine schema ──────────────────────────────────────────
//
// One entry per viewport row. Each variant carries the minimal
// structured data the renderer needs to draw it — no pre-baked ANSI
// strings for diff rows anymore. Moving the "selected line" highlight
// off an ANSI splice and onto a boolean prop kills a long-standing
// rendering-boundary bug where the splice would chop a trailing char
// from the content.
//
// Chunky-scroll trade-off: each thread occupies ONE annotated-line
// slot, not N physical rows. Stepping `scrollOffset` by 1 jumps past
// a whole thread. Acceptable because threads render in full inside
// the viewport; physical-row virtualization isn't justified at this
// scale. See plan `/home/hermann/.claude/plans/sleepy-greeting-thimble.md`.
export type AnnotatedLine =
  | { type: 'diff'; line: DiffLine; highlighted: boolean }
  | { type: 'separator'; rendered: string }
  | {
      type: 'thread-remote';
      thread: RemoteCommentThread;
      commentIndex: number;
    }
  | {
      type: 'thread-local';
      comment: ReviewComment;
      commentIndex: number;
    };

/**
 * Build a set of diffLine indices whose lines are referenced by the selected comment.
 */
function buildHighlightSet(
  diffLines: DiffLine[],
  comments: ReviewComment[],
  selectedCommentId: string | null
): Set<number> {
  const highlighted = new Set<number>();
  if (!selectedCommentId) return highlighted;

  const comment = comments.find((c) => c.id === selectedCommentId);
  if (!comment) return highlighted;

  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    const lineNum = comment.side === 'LEFT' ? dl.oldLine : dl.newLine;
    if (
      lineNum != null &&
      lineNum >= comment.lineStart &&
      lineNum <= comment.lineEnd
    ) {
      highlighted.add(i);
    }
  }

  return highlighted;
}

// ── Interleave ─────────────────────────────────────────────────────

/**
 * Accumulates the annotated-line stream.
 *
 * It owns the two things every section has to agree on: the comment index,
 * which runs continuously across section boundaries because comment
 * navigation steps through it, and where each trailing section begins.
 */
function createLineBuilder() {
  const lines: AnnotatedLine[] = [];
  const sectionAnchors: number[] = [0];
  let commentIndex = 0;

  return {
    lines,
    sectionAnchors,

    diff(line: DiffLine, highlighted: boolean): void {
      lines.push({ type: 'diff', line, highlighted });
    },

    localThread(comment: ReviewComment): void {
      lines.push({
        type: 'thread-local',
        comment,
        commentIndex: commentIndex++,
      });
    },

    remoteThread(thread: RemoteCommentThread): void {
      lines.push({
        type: 'thread-remote',
        thread,
        commentIndex: commentIndex++,
      });
    },

    label(rendered: string): void {
      lines.push({ type: 'separator', rendered });
    },

    /** Open a trailing section: anchor it, then write its heading. */
    beginSection(title: string): void {
      sectionAnchors.push(lines.length);
      lines.push({
        type: 'separator',
        rendered: `\n${DIM}── ${title} ──${RESET}`,
      });
    },
  };
}

type LineBuilder = ReturnType<typeof createLineBuilder>;

/** `line 12:`, or `line 12-15:` for a range — where an off-diff comment sits. */
function lineLabel(start: number, end: number): string {
  return `${DIM}  line ${start}${start === end ? '' : `-${end}`}:${RESET}`;
}

function appendOutOfDiffLocals(
  builder: LineBuilder,
  comments: ReviewComment[]
): void {
  if (comments.length === 0) return;

  builder.beginSection('comments on lines not in diff');
  for (const comment of comments) {
    builder.label(lineLabel(comment.lineStart, comment.lineEnd));
    builder.localThread(comment);
  }
}

function appendOutOfDiffRemotes(
  builder: LineBuilder,
  threads: RemoteCommentThread[]
): void {
  if (threads.length === 0) return;

  builder.beginSection('remote comments on lines not in diff');
  for (const thread of threads) {
    // A thread with no line at all — a general comment the transformer
    // could not place — gets no location line above it.
    if (thread.lineEnd != null) {
      builder.label(
        lineLabel(thread.lineStart ?? thread.lineEnd, thread.lineEnd)
      );
    }
    builder.remoteThread(thread);
  }
}

function appendGeneralComments(
  builder: LineBuilder,
  threads: RemoteCommentThread[]
): void {
  if (threads.length === 0) return;

  builder.beginSection('general PR comments');
  for (const thread of threads) builder.remoteThread(thread);
}

export function interleaveComments(
  diffLines: DiffLine[],
  comments: ReviewComment[],
  selectedCommentId: string | null,
  remoteThreads?: RemoteCommentThread[],
  generalComments?: RemoteCommentThread[]
): {
  lines: AnnotatedLine[];
  insertionMap: InsertionMap;
  sectionAnchors: number[];
} {
  // Drop posted local comments from the render pipeline: once a local
  // comment has been pushed to the remote, its `status` flips to
  // 'posted' but the entry stays in .kirby-comments.json as an audit
  // trail. The same comment is also served back by fetchCommentThreads
  // as a RemoteCommentThread, so rendering both would duplicate the box.
  const drafts = comments.filter((c) => c.status !== 'posted');

  const insertionMap = computeInsertionMap(diffLines, drafts);
  const { insertions: localInsertions, outOfDiff: localOutOfDiff } =
    insertionMap;

  // Skipped entirely when there are no threads: the map builds a line index
  // over the whole diff, which is wasted work on the common case.
  const remoteMap =
    remoteThreads && remoteThreads.length > 0
      ? computeRemoteInsertionMap(diffLines, remoteThreads)
      : {
          insertions: new Map<number, RemoteCommentThread[]>(),
          outOfDiff: [] as RemoteCommentThread[],
        };

  const highlightSet = buildHighlightSet(diffLines, drafts, selectedCommentId);

  const builder = createLineBuilder();

  // The diff body, with each line's threads hanging beneath it.
  for (let i = 0; i < diffLines.length; i++) {
    builder.diff(diffLines[i], highlightSet.has(i));
    for (const comment of localInsertions.get(i) ?? []) {
      builder.localThread(comment);
    }
    for (const thread of remoteMap.insertions.get(i) ?? []) {
      builder.remoteThread(thread);
    }
  }

  // Then the sections for everything that had nowhere to hang.
  appendOutOfDiffLocals(builder, localOutOfDiff);
  appendOutOfDiffRemotes(builder, remoteMap.outOfDiff);
  appendGeneralComments(builder, generalComments ?? []);

  return {
    lines: builder.lines,
    insertionMap,
    sectionAnchors: builder.sectionAnchors,
  };
}

// ── Position lookup ───────────────────────────────────────────────

export interface CommentPositionInfo {
  /** Annotated line index of the thread / local-comment entry */
  headerLine: number;
  /**
   * Annotated line index of the first referenced diff line (the line
   * the comment points AT, not the card itself). For out-of-diff
   * comments this falls back to the card's own position.
   */
  refStartLine: number;
}

/**
 * Map every thread/comment id to the annotated-line index of its card.
 * Used by `scrollToComment` to center the viewport on a selected
 * thread when the user presses Shift+↑/↓ or Ctrl+↑/↓.
 *
 * refStartLine prefers the diff row the comment references — that way
 * the viewport lands with the code visible, not the thread's header
 * alone. For out-of-diff and remote-only cases we fall back to the
 * card's own row.
 */
export function getCommentPositions(
  annotatedLines: AnnotatedLine[],
  insertionMap: InsertionMap,
  comments: ReviewComment[]
): Map<string, CommentPositionInfo> {
  const positions = new Map<string, CommentPositionInfo>();
  const { newLineToIndex, oldLineToIndex } = insertionMap;

  // diffLine idx → first annotated-line idx (diff rows are 1:1 so
  // this just needs to count past interleaved thread entries).
  const diffIdxToAnnotatedIdx = new Map<number, number>();
  let diffIdx = 0;
  for (let i = 0; i < annotatedLines.length; i++) {
    if (annotatedLines[i].type === 'diff') {
      diffIdxToAnnotatedIdx.set(diffIdx, i);
      diffIdx++;
    }
  }

  const commentLineStartDiffIdx = new Map<string, number>();
  for (const comment of comments) {
    const lineMap = comment.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    const idx = lineMap.get(comment.lineStart);
    if (idx !== undefined) {
      commentLineStartDiffIdx.set(comment.id, idx);
    }
  }

  for (let i = 0; i < annotatedLines.length; i++) {
    const line = annotatedLines[i];
    if (line.type === 'thread-local') {
      const lineStartDiffIdx = commentLineStartDiffIdx.get(line.comment.id);
      const refStartLine =
        lineStartDiffIdx !== undefined
          ? diffIdxToAnnotatedIdx.get(lineStartDiffIdx) ?? i
          : i;
      positions.set(line.comment.id, { headerLine: i, refStartLine });
    } else if (line.type === 'thread-remote') {
      // Remote threads don't have a local-comment line-lookup — fall
      // back to the card's own position for scroll purposes.
      positions.set(line.thread.id, { headerLine: i, refStartLine: i });
    }
  }

  return positions;
}
