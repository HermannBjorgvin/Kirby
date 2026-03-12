import type { DiffLine } from './diff-parser.js';
import type { ReviewComment } from '../types.js';

// ANSI color codes (matching diff-renderer conventions)
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const INVERSE = '\x1b[7m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

export interface AnnotatedLine {
  type: 'diff' | 'comment-header' | 'comment-body';
  rendered: string;
  commentId?: string;
  commentIndex?: number;
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: `${RED}${BOLD}[critical]${RESET}`,
  major: `${YELLOW}${BOLD}[major]${RESET}`,
  minor: `${CYAN}[minor]${RESET}`,
  nit: `${DIM}[nit]${RESET}`,
};

function renderCommentBlock(
  comment: ReviewComment,
  commentIndex: number,
  paneCols: number,
  selected: boolean
): AnnotatedLine[] {
  const badge = SEVERITY_BADGE[comment.severity] ?? `[${comment.severity}]`;
  const statusMark =
    comment.status === 'posted' ? `${GREEN} ✓ posted${RESET}` : '';
  const selectMarker = selected ? `${INVERSE}` : '';
  const selectEnd = selected ? `${RESET}` : '';

  const maxBodyWidth = Math.max(20, paneCols - 12);
  const bodyLines = comment.body.split('\n');
  const truncatedFirst =
    bodyLines[0].length > maxBodyWidth
      ? bodyLines[0].slice(0, maxBodyWidth - 1) + '…'
      : bodyLines[0];

  const lines: AnnotatedLine[] = [];

  // Header line
  lines.push({
    type: 'comment-header',
    rendered: `${selectMarker}${MAGENTA}  ┌─ ${badge} ${truncatedFirst}${statusMark}${selectEnd}`,
    commentId: comment.id,
    commentIndex,
  });

  // Additional body lines (show up to 3 more)
  const extraLines = bodyLines.slice(1, 4);
  for (const line of extraLines) {
    const truncated =
      line.length > maxBodyWidth ? line.slice(0, maxBodyWidth - 1) + '…' : line;
    lines.push({
      type: 'comment-body',
      rendered: `${selectMarker}${MAGENTA}  │  ${truncated}${selectEnd}`,
      commentId: comment.id,
      commentIndex,
    });
  }
  if (bodyLines.length > 4) {
    lines.push({
      type: 'comment-body',
      rendered: `${selectMarker}${MAGENTA}  │  ${DIM}... ${
        bodyLines.length - 4
      } more lines${RESET}${selectEnd}`,
      commentId: comment.id,
      commentIndex,
    });
  }

  // Footer
  lines.push({
    type: 'comment-body',
    rendered: `${selectMarker}${MAGENTA}  └─${
      selected ? ` ${DIM}[e]dit [x]delete [p]ost${RESET}` : ''
    }${selectEnd}`,
    commentId: comment.id,
    commentIndex,
  });

  return lines;
}

export function interleaveComments(
  diffLines: DiffLine[],
  renderedDiffLines: string[],
  comments: ReviewComment[],
  paneCols: number,
  selectedCommentId: string | null
): AnnotatedLine[] {
  if (comments.length === 0) {
    return renderedDiffLines.map((line) => ({
      type: 'diff' as const,
      rendered: line,
    }));
  }

  // Build map: newLine number → index in diffLines array
  const newLineToIndex = new Map<number, number>();
  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.newLine != null) {
      newLineToIndex.set(dl.newLine, i);
    }
  }

  // Also build oldLine map for LEFT-side comments
  const oldLineToIndex = new Map<number, number>();
  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.oldLine != null) {
      oldLineToIndex.set(dl.oldLine, i);
    }
  }

  // Map each comment to an insertion index (after which diff line index to insert)
  const insertions = new Map<number, ReviewComment[]>();
  const outOfDiff: ReviewComment[] = [];

  for (const comment of comments) {
    const lineMap = comment.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    let insertAfter: number | undefined;

    // Try lineEnd first, then lineStart, then closest
    for (const targetLine of [comment.lineEnd, comment.lineStart]) {
      if (lineMap.has(targetLine)) {
        insertAfter = lineMap.get(targetLine);
        break;
      }
    }

    // If exact line not found, find closest line <= lineEnd
    if (insertAfter === undefined) {
      let closest = -1;
      for (const [lineNum, idx] of lineMap) {
        if (lineNum <= comment.lineEnd && idx > closest) {
          closest = idx;
        }
      }
      if (closest >= 0) {
        insertAfter = closest;
      }
    }

    if (insertAfter !== undefined) {
      const existing = insertions.get(insertAfter) ?? [];
      existing.push(comment);
      insertions.set(insertAfter, existing);
    } else {
      outOfDiff.push(comment);
    }
  }

  // Build annotated lines
  const result: AnnotatedLine[] = [];
  let commentIdx = 0;

  for (let i = 0; i < renderedDiffLines.length; i++) {
    result.push({ type: 'diff', rendered: renderedDiffLines[i] });

    const commentsHere = insertions.get(i);
    if (commentsHere) {
      for (const comment of commentsHere) {
        const selected = comment.id === selectedCommentId;
        result.push(
          ...renderCommentBlock(comment, commentIdx++, paneCols, selected)
        );
      }
    }
  }

  // Append out-of-diff comments at the end
  if (outOfDiff.length > 0) {
    result.push({
      type: 'diff',
      rendered: `\n${DIM}── comments on lines not in diff ──${RESET}`,
    });
    for (const comment of outOfDiff) {
      const selected = comment.id === selectedCommentId;
      result.push({
        type: 'diff',
        rendered: `${DIM}  line ${comment.lineStart}${
          comment.lineStart !== comment.lineEnd ? `-${comment.lineEnd}` : ''
        }:${RESET}`,
      });
      result.push(
        ...renderCommentBlock(comment, commentIdx++, paneCols, selected)
      );
    }
  }

  return result;
}
