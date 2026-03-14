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
// Warm yellow-tinted background for referenced lines (applied after the gutter)
const BG_HIGHLIGHT = '\x1b[48;5;58m';

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

const STATUS_MARKS: Record<string, string> = {
  posted: `${GREEN} ✓${RESET}`,
  posting: `${YELLOW} ⏳${RESET}`,
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

/**
 * Strip ANSI escape sequences to measure visible character width.
 */
function visibleLength(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Pad a string (which may contain ANSI codes) to a target visible width.
 */
function padVisible(str: string, targetWidth: number): string {
  const visible = visibleLength(str);
  if (visible >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - visible);
}

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
  const statusMark = STATUS_MARKS[comment.status] ?? '';

  // Selected: yellow border stands out; unselected: dim magenta
  const borderColor = selected ? `${YELLOW}${BOLD}` : `${MAGENTA}${DIM}`;
  const bodyColor = selected ? '' : `${DIM}`;

  // Box inner width = maxBodyWidth + 2 (for "  " padding inside box)
  const maxBodyWidth = Math.min(
    MAX_BODY_WIDTH,
    Math.max(20, paneCols - INDENT.length - 6)
  );
  const boxInnerWidth = maxBodyWidth + 2;
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

  // Top border: ┌─ badge headerExtra ──...──┐
  const headerContent = ` ${badge}${headerExtra} `;
  const headerVisLen = visibleLength(headerContent);
  const topFillLen = Math.max(0, boxInnerWidth - headerVisLen);
  lines.push({
    type: 'comment-header',
    rendered: `${INDENT}${borderColor}┌─${RESET}${headerContent}${borderColor}${'─'.repeat(
      topFillLen
    )}┐${RESET}`,
    commentId: comment.id,
    commentIndex,
  });

  if (editing && editBuffer !== undefined) {
    const editLines = editBuffer.split('\n');
    for (const rawLine of editLines) {
      const wrapped = wrapText(rawLine, maxBodyWidth);
      for (const seg of wrapped) {
        const padded = padVisible(seg, maxBodyWidth);
        lines.push({
          type: 'comment-body',
          rendered: `${INDENT}${borderColor}│${RESET}  ${padded} ${borderColor}│${RESET}`,
          commentId: comment.id,
          commentIndex,
        });
      }
    }
    // Cursor indicator
    const lastIdx = lines.length - 1;
    lines[lastIdx].rendered = lines[lastIdx].rendered.replace(
      /│\x1b\[0m$/, // eslint-disable-line no-control-regex
      `${CYAN}▏${RESET}${borderColor}│${RESET}`
    );

    // Bottom border
    lines.push({
      type: 'comment-body',
      rendered: `${INDENT}${borderColor}└${'─'.repeat(
        boxInnerWidth + 1
      )}┘${RESET}`,
      commentId: comment.id,
      commentIndex,
    });

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
    const padded = padVisible(`${bodyColor}${line}${RESET}`, maxBodyWidth);
    lines.push({
      type: 'comment-body',
      rendered: `${INDENT}${borderColor}│${RESET}  ${padded} ${borderColor}│${RESET}`,
      commentId: comment.id,
      commentIndex,
    });
  }

  if (!showAll && allWrappedLines.length > maxLines) {
    const truncMsg = `${DIM}... ${
      allWrappedLines.length - maxLines
    } more lines${RESET}`;
    const padded = padVisible(truncMsg, maxBodyWidth);
    lines.push({
      type: 'comment-body',
      rendered: `${INDENT}${borderColor}│${RESET}  ${padded} ${borderColor}│${RESET}`,
      commentId: comment.id,
      commentIndex,
    });
  }

  // Bottom border
  lines.push({
    type: 'comment-body',
    rendered: `${INDENT}${borderColor}└${'─'.repeat(
      boxInnerWidth + 1
    )}┘${RESET}`,
    commentId: comment.id,
    commentIndex,
  });

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

export function interleaveComments(
  diffLines: DiffLine[],
  renderedDiffLines: string[],
  comments: ReviewComment[],
  paneCols: number,
  selectedCommentId: string | null,
  pendingDeleteCommentId?: string | null,
  editingCommentId?: string | null,
  editBuffer?: string
): { lines: AnnotatedLine[]; insertionMap: InsertionMap } {
  if (comments.length === 0) {
    return {
      lines: renderedDiffLines.map((line) => ({
        type: 'diff' as const,
        rendered: line,
      })),
      insertionMap: computeInsertionMap(diffLines, comments),
    };
  }

  const highlightSet = buildHighlightSet(
    diffLines,
    comments,
    selectedCommentId
  );

  const insertionMap = computeInsertionMap(diffLines, comments);
  const { insertions, outOfDiff } = insertionMap;

  // Build annotated lines
  const result: AnnotatedLine[] = [];
  let commentIdx = 0;

  for (let i = 0; i < renderedDiffLines.length; i++) {
    let rendered = renderedDiffLines[i];
    // Apply yellow background highlight starting after the line-number gutter
    // so it aligns with the comment box indent. Re-apply BG after every RESET
    // so the background persists through the line's own ANSI codes.
    if (highlightSet.has(i)) {
      // Find the char index where the gutter ends (after INDENT_LENGTH visible chars).
      // If the line is too short (e.g. empty lines), skip highlighting entirely.
      const GUTTER_CHARS = INDENT.length; // 13 visible chars
      let visCount = 0;
      let splitIdx = -1;
      for (let j = 0; j < rendered.length; j++) {
        if (rendered[j] === '\x1b') {
          const end = rendered.indexOf('m', j);
          if (end !== -1) {
            j = end;
            continue;
          }
        }
        visCount++;
        if (visCount > GUTTER_CHARS) {
          splitIdx = j;
          break;
        }
      }
      if (splitIdx >= 0) {
        const gutter = rendered.slice(0, splitIdx);
        const content = rendered.slice(splitIdx);
        rendered = `${gutter}${BG_HIGHLIGHT}${content.replaceAll(
          RESET,
          `${RESET}${BG_HIGHLIGHT}`
        )}${RESET}`;
      }
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

  return { lines: result, insertionMap };
}

export interface CommentPositionInfo {
  /** Annotated line index of the comment header */
  headerLine: number;
  /** Annotated line index of the first referenced line (lineStart) */
  refStartLine: number;
}

/**
 * Compute the annotated-line index of each comment header and its referenced lineStart.
 * Walks the actual annotated output to get exact positions (no estimation).
 */
export function getCommentPositions(
  annotatedLines: AnnotatedLine[],
  insertionMap: InsertionMap,
  comments: ReviewComment[]
): Map<string, CommentPositionInfo> {
  const positions = new Map<string, CommentPositionInfo>();
  if (comments.length === 0) return positions;

  const { newLineToIndex, oldLineToIndex } = insertionMap;

  // Map: diffLine index → first annotated line index for that diff line
  const diffIdxToAnnotatedIdx = new Map<number, number>();
  let diffIdx = 0;
  for (let i = 0; i < annotatedLines.length; i++) {
    if (annotatedLines[i].type === 'diff') {
      diffIdxToAnnotatedIdx.set(diffIdx, i);
      diffIdx++;
    }
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

  // Scan annotated lines for comment-header entries
  for (let i = 0; i < annotatedLines.length; i++) {
    const line = annotatedLines[i];
    if (line.type === 'comment-header' && line.commentId) {
      const lineStartDiffIdx = commentLineStartDiffIdx.get(line.commentId);
      const refStartLine =
        lineStartDiffIdx !== undefined
          ? diffIdxToAnnotatedIdx.get(lineStartDiffIdx) ?? i
          : i;
      positions.set(line.commentId, { headerLine: i, refStartLine });
    }
  }

  return positions;
}
