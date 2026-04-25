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
