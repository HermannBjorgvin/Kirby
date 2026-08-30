// ── Insertion maps ────────────────────────────────────────────────
//
// Where a comment hangs in a diff. A comment is anchored to a line of a
// file; a diff only shows some of those lines, so placing one means
// mapping a file line onto a diff row — and deciding what to do when
// that line is not on screen.

import type { DiffLine } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { log } from '@kirby/logger';
import type { ReviewComment } from './types.js';

/** Diff-row index of every file line, one map per side of the diff. */
interface LineIndexes {
  newLineToIndex: Map<number, number>;
  oldLineToIndex: Map<number, number>;
}

function buildLineIndexes(diffLines: DiffLine[]): LineIndexes {
  const newLineToIndex = new Map<number, number>();
  const oldLineToIndex = new Map<number, number>();

  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.newLine != null) newLineToIndex.set(dl.newLine, i);
    if (dl.oldLine != null) oldLineToIndex.set(dl.oldLine, i);
  }

  return { newLineToIndex, oldLineToIndex };
}

/**
 * Which diff row a comment hangs beneath.
 *
 * First choice is a row for one of the candidate lines outright. Failing
 * that it falls back to the last row before the anchor, which is what keeps
 * a comment whose own line is folded away visible near where it belongs.
 * `undefined` means the diff has no row at or before the anchor at all —
 * the comment belongs in the out-of-diff section.
 */
function placeAfter(
  lineMap: Map<number, number>,
  candidates: number[],
  anchorLine: number
): number | undefined {
  for (const targetLine of candidates) {
    const exact = lineMap.get(targetLine);
    if (exact !== undefined) return exact;
  }

  let closest = -1;
  for (const [lineNum, idx] of lineMap) {
    if (lineNum <= anchorLine && idx > closest) closest = idx;
  }
  return closest >= 0 ? closest : undefined;
}

/** Append to the bucket at `index`, starting one if this is the first. */
function pushAt<T>(buckets: Map<number, T[]>, index: number, item: T): void {
  const existing = buckets.get(index) ?? [];
  existing.push(item);
  buckets.set(index, existing);
}

export interface RemoteInsertionMap {
  insertions: Map<number, RemoteCommentThread[]>;
  outOfDiff: RemoteCommentThread[];
}

export function computeRemoteInsertionMap(
  diffLines: DiffLine[],
  threads: RemoteCommentThread[]
): RemoteInsertionMap {
  const { newLineToIndex, oldLineToIndex } = buildLineIndexes(diffLines);
  const insertions = new Map<number, RemoteCommentThread[]>();
  const outOfDiff: RemoteCommentThread[] = [];

  for (const thread of threads) {
    // Every placement decision is logged with the same identifying fields:
    // which thread went where is the first thing asked when a comment
    // renders somewhere surprising.
    const where = {
      file: thread.file,
      side: thread.side,
      lineStart: thread.lineStart,
      lineEnd: thread.lineEnd,
      isOutdated: thread.isOutdated,
    };

    if (thread.lineEnd == null) {
      outOfDiff.push(thread);
      log(
        'warn',
        'placement.remoteThread',
        `thread ${thread.id} has null lineEnd → out-of-diff (transformer didn't resolve a line)`,
        where
      );
      continue;
    }

    const lineMap = thread.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    const insertAfter = placeAfter(
      lineMap,
      [thread.lineEnd, thread.lineStart ?? thread.lineEnd],
      thread.lineEnd
    );

    if (insertAfter !== undefined) {
      pushAt(insertions, insertAfter, thread);
      log(
        'info',
        'placement.remoteThread',
        `thread ${thread.id} placed inline after diff index ${insertAfter}`,
        where
      );
    } else {
      outOfDiff.push(thread);
      log(
        'warn',
        'placement.remoteThread',
        `thread ${thread.id} pushed to out-of-diff (no matching diff line)`,
        { ...where, diffLineCount: diffLines.length }
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
  const { newLineToIndex, oldLineToIndex } = buildLineIndexes(diffLines);
  const insertions = new Map<number, ReviewComment[]>();
  const outOfDiff: ReviewComment[] = [];

  for (const comment of comments) {
    const lineMap = comment.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    const insertAfter = placeAfter(
      lineMap,
      [comment.lineEnd, comment.lineStart],
      comment.lineEnd
    );

    if (insertAfter !== undefined) pushAt(insertions, insertAfter, comment);
    else outOfDiff.push(comment);
  }

  return { insertions, outOfDiff, newLineToIndex, oldLineToIndex };
}
