import type { DiffLine } from '@kirby/diff';
import type { ReviewComment } from './types.js';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { log } from '@kirby/logger';

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

// ── Insertion maps ────────────────────────────────────────────────

export interface RemoteInsertionMap {
  insertions: Map<number, RemoteCommentThread[]>;
  outOfDiff: RemoteCommentThread[];
}

export function computeRemoteInsertionMap(
  diffLines: DiffLine[],
  threads: RemoteCommentThread[]
): RemoteInsertionMap {
  const newLineToIndex = new Map<number, number>();
  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.newLine != null) newLineToIndex.set(dl.newLine, i);
  }

  const oldLineToIndex = new Map<number, number>();
  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.oldLine != null) oldLineToIndex.set(dl.oldLine, i);
  }

  const insertions = new Map<number, RemoteCommentThread[]>();
  const outOfDiff: RemoteCommentThread[] = [];

  for (const thread of threads) {
    if (thread.lineEnd == null) {
      outOfDiff.push(thread);
      log(
        'warn',
        'placement.remoteThread',
        `thread ${thread.id} has null lineEnd → out-of-diff (transformer didn't resolve a line)`,
        {
          file: thread.file,
          side: thread.side,
          lineStart: thread.lineStart,
          lineEnd: thread.lineEnd,
          isOutdated: thread.isOutdated,
        }
      );
      continue;
    }
    const lineMap = thread.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    let insertAfter: number | undefined;

    for (const targetLine of [
      thread.lineEnd,
      thread.lineStart ?? thread.lineEnd,
    ]) {
      if (lineMap.has(targetLine)) {
        insertAfter = lineMap.get(targetLine);
        break;
      }
    }

    if (insertAfter === undefined) {
      let closest = -1;
      for (const [lineNum, idx] of lineMap) {
        if (lineNum <= thread.lineEnd && idx > closest) {
          closest = idx;
        }
      }
      if (closest >= 0) insertAfter = closest;
    }

    if (insertAfter !== undefined) {
      const existing = insertions.get(insertAfter) ?? [];
      existing.push(thread);
      insertions.set(insertAfter, existing);
      log(
        'info',
        'placement.remoteThread',
        `thread ${thread.id} placed inline after diff index ${insertAfter}`,
        {
          file: thread.file,
          side: thread.side,
          lineStart: thread.lineStart,
          lineEnd: thread.lineEnd,
          isOutdated: thread.isOutdated,
        }
      );
    } else {
      outOfDiff.push(thread);
      log(
        'warn',
        'placement.remoteThread',
        `thread ${thread.id} pushed to out-of-diff (no matching diff line)`,
        {
          file: thread.file,
          side: thread.side,
          lineStart: thread.lineStart,
          lineEnd: thread.lineEnd,
          isOutdated: thread.isOutdated,
          diffLineCount: diffLines.length,
        }
      );
    }
  }

  return { insertions, outOfDiff };
}

export interface InsertionMap {
  insertions: Map<number, ReviewComment[]>;
  outOfDiff: ReviewComment[];
  newLineToIndex: Map<number, number>;
  oldLineToIndex: Map<number, number>;
}

export function computeInsertionMap(
  diffLines: DiffLine[],
  comments: ReviewComment[]
): InsertionMap {
  const newLineToIndex = new Map<number, number>();
  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.newLine != null) newLineToIndex.set(dl.newLine, i);
  }

  const oldLineToIndex = new Map<number, number>();
  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.oldLine != null) oldLineToIndex.set(dl.oldLine, i);
  }

  const insertions = new Map<number, ReviewComment[]>();
  const outOfDiff: ReviewComment[] = [];

  for (const comment of comments) {
    const lineMap = comment.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    let insertAfter: number | undefined;

    for (const targetLine of [comment.lineEnd, comment.lineStart]) {
      if (lineMap.has(targetLine)) {
        insertAfter = lineMap.get(targetLine);
        break;
      }
    }

    if (insertAfter === undefined) {
      let closest = -1;
      for (const [lineNum, idx] of lineMap) {
        if (lineNum <= comment.lineEnd && idx > closest) {
          closest = idx;
        }
      }
      if (closest >= 0) insertAfter = closest;
    }

    if (insertAfter !== undefined) {
      const existing = insertions.get(insertAfter) ?? [];
      existing.push(comment);
      insertions.set(insertAfter, existing);
    } else {
      outOfDiff.push(comment);
    }
  }

  return { insertions, outOfDiff, newLineToIndex, oldLineToIndex };
}

// ── Interleave ─────────────────────────────────────────────────────

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
  comments = comments.filter((c) => c.status !== 'posted');
  const hasRemoteThreads = (remoteThreads ?? []).length > 0;
  const hasGeneralComments = (generalComments ?? []).length > 0;

  const insertionMap = computeInsertionMap(diffLines, comments);
  const { insertions: localInsertions, outOfDiff: localOutOfDiff } =
    insertionMap;

  const remoteMap = hasRemoteThreads
    ? computeRemoteInsertionMap(diffLines, remoteThreads!)
    : {
        insertions: new Map<number, RemoteCommentThread[]>(),
        outOfDiff: [] as RemoteCommentThread[],
      };

  const highlightSet = buildHighlightSet(
    diffLines,
    comments,
    selectedCommentId
  );

  const result: AnnotatedLine[] = [];
  const sectionAnchors: number[] = [0];
  let commentIndex = 0;

  for (let i = 0; i < diffLines.length; i++) {
    result.push({
      type: 'diff',
      line: diffLines[i],
      highlighted: highlightSet.has(i),
    });

    const commentsHere = localInsertions.get(i);
    if (commentsHere) {
      for (const comment of commentsHere) {
        result.push({
          type: 'thread-local',
          comment,
          commentIndex: commentIndex++,
        });
      }
    }

    const threadsHere = remoteMap.insertions.get(i);
    if (threadsHere) {
      for (const thread of threadsHere) {
        result.push({
          type: 'thread-remote',
          thread,
          commentIndex: commentIndex++,
        });
      }
    }
  }

  // Out-of-diff local comments
  if (localOutOfDiff.length > 0) {
    sectionAnchors.push(result.length);
    result.push({
      type: 'separator',
      rendered: `\n${DIM}── comments on lines not in diff ──${RESET}`,
    });
    for (const comment of localOutOfDiff) {
      result.push({
        type: 'separator',
        rendered: `${DIM}  line ${comment.lineStart}${
          comment.lineStart !== comment.lineEnd ? `-${comment.lineEnd}` : ''
        }:${RESET}`,
      });
      result.push({
        type: 'thread-local',
        comment,
        commentIndex: commentIndex++,
      });
    }
  }

  // Out-of-diff remote threads
  if (remoteMap.outOfDiff.length > 0) {
    sectionAnchors.push(result.length);
    result.push({
      type: 'separator',
      rendered: `\n${DIM}── remote comments on lines not in diff ──${RESET}`,
    });
    for (const thread of remoteMap.outOfDiff) {
      if (thread.lineEnd != null) {
        result.push({
          type: 'separator',
          rendered: `${DIM}  line ${thread.lineStart ?? thread.lineEnd}${
            thread.lineStart != null && thread.lineStart !== thread.lineEnd
              ? `-${thread.lineEnd}`
              : ''
          }:${RESET}`,
        });
      }
      result.push({
        type: 'thread-remote',
        thread,
        commentIndex: commentIndex++,
      });
    }
  }

  // PR-level general comments (file === null)
  if (hasGeneralComments) {
    sectionAnchors.push(result.length);
    result.push({
      type: 'separator',
      rendered: `\n${DIM}── general PR comments ──${RESET}`,
    });
    for (const thread of generalComments!) {
      result.push({
        type: 'thread-remote',
        thread,
        commentIndex: commentIndex++,
      });
    }
  }

  return { lines: result, insertionMap, sectionAnchors };
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

// ── Row estimation + row map ───────────────────────────────────────
//
// These were previously in `apps/cli/src/components/CommentThread.tsx`
// alongside the rendering components. They've moved here because:
// 1. They're pure functions over the renderer's data types and need
//    no React context.
// 2. The new `buildRowMap` belongs here (it operates on AnnotatedLine
//    streams that this module produces) and needs them.
// 3. Keeping them next to the data shape they describe lets all
//    consumers — the diff viewer's row-based scroll model, the file
//    list footer's `planCommentFooter`, and any future surface —
//    share one source of truth.

/**
 * Estimate how many rows a body string occupies after wrap. When
 * `contentWidth` is unknown the number falls back to a 4-line cap
 * (matches the file-list footer's pre-2026 behaviour); the diff
 * viewer's row map always passes a real width so long-bodied threads
 * aren't undercounted.
 */
export function estimateBodyRows(body: string, contentWidth?: number): number {
  const naturalLines = Math.max(1, body.split('\n').length);
  if (contentWidth && contentWidth > 0) {
    const wrapped = Math.max(
      1,
      Math.ceil(body.length / Math.max(1, contentWidth))
    );
    return Math.max(naturalLines, wrapped);
  }
  return Math.min(4, naturalLines);
}

/**
 * Estimate the row height of a `<CommentThreadCard>` so callers can
 * reserve space without measuring the rendered output. Always counts
 * the full thread (root + every reply) — the card no longer collapses
 * replies when not selected.
 *
 * Numbers mirror the card's structure: top border + author row +
 * wrapped body + bottom border + marginBottom = `4 + bodyRows`.
 * Per-reply: header + body + marginTop gap.
 */
export function estimateCardRows(
  thread: RemoteCommentThread,
  contentWidth?: number
): number {
  const root = thread.comments[0];
  if (!root) return 0;
  const rootRows = 4 + estimateBodyRows(root.body, contentWidth);
  const replyRows = thread.comments.slice(1).reduce((sum, c) => {
    return sum + 1 + estimateBodyRows(c.body, contentWidth) + 1;
  }, 0);
  return rootRows + replyRows;
}

/**
 * Mirror of `estimateCardRows` for local drafts. Selected/editing
 * cards show the full body; collapsed cards cap at 4 lines (matching
 * the runtime `MAX_COLLAPSED` in `<LocalCommentCard>`).
 */
export function estimateLocalCardRows(
  comment: ReviewComment,
  contentWidth?: number,
  selected = false
): number {
  const naturalLines = Math.max(1, comment.body.split('\n').length);
  const bodyRows = selected
    ? estimateBodyRows(comment.body, contentWidth)
    : Math.min(4, naturalLines);
  // border-top + header + body + border-bottom + marginBottom
  return 2 + 1 + bodyRows + 1;
}

/**
 * Extra rows reserved when a thread card has its reply input open.
 * The input box renders as a bordered Box (~3 rows) plus the
 * marginTop gap between body and input = 4 rows. Used by `buildRowMap`
 * so the row map's totals stay correct while the user composes.
 */
export const REPLY_INPUT_ROWS = 4;

/**
 * Extra rows reserved when a local-draft card is in `editing` state.
 * Editing replaces the body Text with an input that may run a row or
 * two longer than the static body, so we reserve a couple of slack
 * rows on top of the selected-body estimate. Conservative.
 */
export const EDIT_INPUT_SLACK_ROWS = 2;

export interface RowMapEntry {
  /** First physical row of this entry, measured from the top of the file diff. */
  rowStart: number;
  /** How many physical rows this entry consumes when rendered. */
  rowSpan: number;
}

export interface RowMap {
  /** 1:1 with the annotated-line stream it was built from. */
  positions: RowMapEntry[];
  /** Sum of every `rowSpan` — the row-unit equivalent of `annotatedLines.length`. */
  totalRows: number;
  /** Section anchors translated from slot indices to physical row offsets. */
  sectionAnchorRows: number[];
}

export interface BuildRowMapInputs {
  annotatedLines: AnnotatedLine[];
  /** Slot indices of section starts, as returned by `interleaveComments`. */
  sectionAnchors: number[];
  /** Card content width (after borders + paddingX). Pass the rendered width. */
  contentWidth: number;
  /** Active reply-mode thread id — its row span gets `REPLY_INPUT_ROWS` extra. */
  replyingToThreadId?: string | null;
  /** Active local-edit comment id — its row span gets `EDIT_INPUT_SLACK_ROWS` extra. */
  editingCommentId?: string | null;
  /**
   * Currently selected comment id. Only affects `<LocalCommentCard>`'s
   * body-collapse decision (selected drafts show the full body, others
   * cap at 4 lines). Remote thread cards always render fully expanded.
   */
  selectedCommentId?: string | null;
}

/**
 * Single source of truth for physical row positions across the diff
 * viewer's annotated-line stream. The diff viewer's scroll model
 * advances one ROW at a time but cards are atomic React components —
 * this map lets the slicer know which entries intersect the viewport
 * and where to clip the first one's top so partial cards render
 * cleanly via `marginTop={-topClip}`.
 *
 * Pure function: deterministic given inputs, no I/O. Cheap enough to
 * recompute via `useMemo` on each render. Re-runs when reply / edit
 * state changes (those bump card heights) or when the terminal
 * resizes (contentWidth changes).
 */
export function buildRowMap(inputs: BuildRowMapInputs): RowMap {
  const {
    annotatedLines,
    sectionAnchors,
    contentWidth,
    replyingToThreadId,
    editingCommentId,
    selectedCommentId,
  } = inputs;

  const positions: RowMapEntry[] = new Array(annotatedLines.length);
  let cursor = 0;
  for (let i = 0; i < annotatedLines.length; i++) {
    const entry = annotatedLines[i]!;
    let span = 1;
    if (entry.type === 'thread-remote') {
      span = estimateCardRows(entry.thread, contentWidth);
      if (entry.thread.id === replyingToThreadId) {
        span += REPLY_INPUT_ROWS;
      }
    } else if (entry.type === 'thread-local') {
      span = estimateLocalCardRows(
        entry.comment,
        contentWidth,
        selectedCommentId === entry.comment.id
      );
      if (entry.comment.id === editingCommentId) {
        span += EDIT_INPUT_SLACK_ROWS;
      }
    }
    positions[i] = { rowStart: cursor, rowSpan: span };
    cursor += span;
  }
  const totalRows = cursor;

  // sectionAnchors are slot indices into annotatedLines. Translate
  // each to its physical row by looking up the corresponding entry's
  // rowStart. An anchor that points past the end of the stream maps
  // to totalRows (i.e. "the bottom"); an empty stream collapses to
  // [0].
  const sectionAnchorRows: number[] = [];
  for (const anchor of sectionAnchors) {
    if (anchor <= 0) {
      sectionAnchorRows.push(0);
    } else if (anchor >= positions.length) {
      sectionAnchorRows.push(totalRows);
    } else {
      sectionAnchorRows.push(positions[anchor]!.rowStart);
    }
  }
  if (sectionAnchorRows.length === 0) sectionAnchorRows.push(0);

  return { positions, totalRows, sectionAnchorRows };
}
