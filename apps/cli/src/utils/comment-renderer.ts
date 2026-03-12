import type { DiffLine } from './diff-parser.js';
import type { ReviewComment } from '../types.js';

// ANSI color codes (matching diff-renderer conventions)
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
// Subtle highlight for referenced lines (faint background)
const BG_HIGHLIGHT = '\x1b[48;5;236m';

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

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const result: string[] = [];
  const words = text.split(/(\s+)/);
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length <= width) {
      currentLine += word;
    } else if (currentLine.length === 0) {
      // Single word exceeds width, break it
      for (let i = 0; i < word.length; i += width) {
        result.push(word.slice(i, i + width));
      }
    } else {
      result.push(currentLine);
      currentLine = word.trimStart();
    }
  }
  if (currentLine.length > 0) {
    result.push(currentLine);
  }
  return result.length > 0 ? result : [''];
}

// Indentation for comment boxes (aligns with diff content area)
const INDENT = ' '.repeat(13);
const MAX_BODY_WIDTH = 80;

function renderCommentBlock(
  comment: ReviewComment,
  commentIndex: number,
  paneCols: number,
  selected: boolean,
  pendingDelete?: boolean,
  editing?: boolean,
  editBuffer?: string
): AnnotatedLine[] {
  const badge = SEVERITY_BADGE[comment.severity] ?? `[${comment.severity}]`;
  const statusMark = comment.status === 'posted' ? `${GREEN} ✓${RESET}` : '';

  // Selected: yellow border stands out; unselected: dim magenta
  const borderColor = selected ? `${YELLOW}${BOLD}` : `${MAGENTA}${DIM}`;
  const bodyColor = selected ? '' : `${DIM}`;

  const maxBodyWidth = Math.min(
    MAX_BODY_WIDTH,
    Math.max(20, paneCols - INDENT.length - 6)
  );
  const lines: AnnotatedLine[] = [];

  // Header: severity + hints on the same line
  let headerExtra = statusMark;
  if (pendingDelete) {
    headerExtra += ` ${RED}Delete? [y]es [n]o${RESET}`;
  } else if (selected && !editing) {
    headerExtra += ` ${DIM}[e]dit [x]delete [p]ost${RESET}`;
  } else if (editing) {
    headerExtra += ` ${CYAN}EDITING${RESET} ${DIM}[esc] save · [ctrl+c] cancel${RESET}`;
  }

  lines.push({
    type: 'comment-header',
    rendered: `${INDENT}${borderColor}┌─${RESET} ${badge}${headerExtra}`,
    commentId: comment.id,
    commentIndex,
  });

  if (editing && editBuffer !== undefined) {
    const editLines = editBuffer.split('\n');
    for (const rawLine of editLines) {
      const wrapped = wrapText(rawLine, maxBodyWidth);
      for (const seg of wrapped) {
        lines.push({
          type: 'comment-body',
          rendered: `${INDENT}${borderColor}│${RESET}  ${seg}`,
          commentId: comment.id,
          commentIndex,
        });
      }
    }
    // Cursor indicator
    const lastIdx = lines.length - 1;
    lines[lastIdx].rendered += `${CYAN}▏${RESET}`;

    return lines;
  }

  // Body lines with word wrapping
  const bodyLines = comment.body.split('\n');
  const allWrappedLines: string[] = [];
  for (const rawLine of bodyLines) {
    const wrapped = wrapText(rawLine, maxBodyWidth);
    allWrappedLines.push(...wrapped);
  }

  const showAll = selected;
  const maxLines = showAll ? allWrappedLines.length : 4;
  const displayLines = allWrappedLines.slice(0, maxLines);

  for (const line of displayLines) {
    lines.push({
      type: 'comment-body',
      rendered: `${INDENT}${borderColor}│${RESET}  ${bodyColor}${line}${RESET}`,
      commentId: comment.id,
      commentIndex,
    });
  }

  if (!showAll && allWrappedLines.length > maxLines) {
    lines.push({
      type: 'comment-body',
      rendered: `${INDENT}${borderColor}│${RESET}  ${DIM}... ${
        allWrappedLines.length - maxLines
      } more lines${RESET}`,
      commentId: comment.id,
      commentIndex,
    });
  }

  return lines;
}

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

export function interleaveComments(
  diffLines: DiffLine[],
  renderedDiffLines: string[],
  comments: ReviewComment[],
  paneCols: number,
  selectedCommentId: string | null,
  pendingDeleteCommentId?: string | null,
  editingCommentId?: string | null,
  editBuffer?: string
): AnnotatedLine[] {
  if (comments.length === 0) {
    return renderedDiffLines.map((line) => ({
      type: 'diff' as const,
      rendered: line,
    }));
  }

  // Build highlight set for the selected comment's referenced lines
  const highlightSet = buildHighlightSet(
    diffLines,
    comments,
    selectedCommentId
  );

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
    let rendered = renderedDiffLines[i];
    // Apply subtle highlight to referenced lines
    if (highlightSet.has(i)) {
      rendered = `${BG_HIGHLIGHT}${rendered}${RESET}`;
    }
    result.push({ type: 'diff', rendered });

    const commentsHere = insertions.get(i);
    if (commentsHere) {
      for (const comment of commentsHere) {
        const selected = comment.id === selectedCommentId;
        const pendingDelete = comment.id === pendingDeleteCommentId;
        const isEditing = comment.id === editingCommentId;
        result.push(
          ...renderCommentBlock(
            comment,
            commentIdx++,
            paneCols,
            selected,
            pendingDelete,
            isEditing,
            isEditing ? editBuffer : undefined
          )
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
      const pendingDelete = comment.id === pendingDeleteCommentId;
      const isEditing = comment.id === editingCommentId;
      result.push({
        type: 'diff',
        rendered: `${DIM}  line ${comment.lineStart}${
          comment.lineStart !== comment.lineEnd ? `-${comment.lineEnd}` : ''
        }:${RESET}`,
      });
      result.push(
        ...renderCommentBlock(
          comment,
          commentIdx++,
          paneCols,
          selected,
          pendingDelete,
          isEditing,
          isEditing ? editBuffer : undefined
        )
      );
    }
  }

  return result;
}

export interface CommentPositionInfo {
  /** Annotated line index of the comment header */
  headerLine: number;
  /** Annotated line index of the first referenced line (lineStart) */
  refStartLine: number;
}

/**
 * Compute the annotated-line index of each comment header and its referenced lineStart.
 * Mirrors the insertion logic of `interleaveComments` but only records positions.
 */
export function getCommentPositions(
  diffLines: DiffLine[],
  renderedDiffLines: string[],
  comments: ReviewComment[]
): Map<string, CommentPositionInfo> {
  const positions = new Map<string, CommentPositionInfo>();
  if (comments.length === 0) return positions;

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

  // For each comment, find the diffLines index of lineStart
  const commentLineStartDiffIdx = new Map<string, number>();
  for (const comment of comments) {
    const lineMap = comment.side === 'LEFT' ? oldLineToIndex : newLineToIndex;
    const idx = lineMap.get(comment.lineStart);
    if (idx !== undefined) {
      commentLineStartDiffIdx.set(comment.id, idx);
    }
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

  // Walk through and count annotated line indices
  // Also track: diffLineIndex → annotated line index (for lineStart lookup)
  const diffIdxToAnnotatedIdx = new Map<number, number>();
  let lineIndex = 0;

  for (let i = 0; i < renderedDiffLines.length; i++) {
    diffIdxToAnnotatedIdx.set(i, lineIndex);
    lineIndex++; // the diff line itself

    const commentsHere = insertions.get(i);
    if (commentsHere) {
      for (const comment of commentsHere) {
        const headerPos = lineIndex;
        // Estimate block height: header(1) + body lines (no footer now)
        const bodyLines = comment.body.split('\n');
        const bodyCount = Math.min(bodyLines.length, 4);
        const truncLine = bodyLines.length > 4 ? 1 : 0;
        const blockHeight = 1 + bodyCount + truncLine; // header + body + truncation

        // Find refStartLine
        const lineStartDiffIdx = commentLineStartDiffIdx.get(comment.id);
        const refStartLine =
          lineStartDiffIdx !== undefined
            ? diffIdxToAnnotatedIdx.get(lineStartDiffIdx) ?? headerPos
            : headerPos;

        positions.set(comment.id, { headerLine: headerPos, refStartLine });
        lineIndex += blockHeight;
      }
    }
  }

  // out-of-diff comments
  if (outOfDiff.length > 0) {
    lineIndex++; // separator line
    for (const comment of outOfDiff) {
      lineIndex++; // "line N:" label
      const headerPos = lineIndex;
      const bodyLines = comment.body.split('\n');
      const bodyCount = Math.min(bodyLines.length, 4);
      const truncLine = bodyLines.length > 4 ? 1 : 0;
      lineIndex += 1 + bodyCount + truncLine;
      positions.set(comment.id, {
        headerLine: headerPos,
        refStartLine: headerPos,
      });
    }
  }

  return positions;
}
