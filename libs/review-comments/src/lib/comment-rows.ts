// ── Row estimation + row map ───────────────────────────────────────
//
// How tall each thing is once painted, and where each annotated-line
// slot lands in physical rows.
//
// These are pure functions over the renderer's data types and need no
// React context, which is why they live in the library rather than
// beside the components that draw them. Keeping them next to the data
// shape they describe lets all consumers — the diff viewer's row-based
// scroll model, the file list footer's `planCommentFooter`, and any
// future surface — share one source of truth.

import wrapAnsi from 'wrap-ansi';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { commentBodyParts } from './conventional.js';
import type { ReviewComment } from './types.js';
import type { AnnotatedLine } from './comment-renderer.js';

/**
 * Rows a comment body occupies once its Conventional Comments header
 * and its agent signature have been lifted out of the prose.
 *
 * Both of those render as a single `wrap="truncate-end"` row each — a
 * deliberate choice in the components, precisely so they can be
 * counted rather than measured. The prose is what actually wraps, and
 * is measured exactly.
 *
 * This is the one place the split is applied to the *measurement*; the
 * components apply it to the paint via `commentBodyView`. They have to
 * stay in step: a card measured against a different split from the one
 * it draws puts every row below it in the wrong place.
 */
function bodyRowsWithChrome(body: string, contentWidth?: number): number {
  const parts = commentBodyParts(body);
  return (
    (parts.header ? 1 : 0) +
    // Ink paints `<Text wrap="wrap">{''}</Text>` as no rows at all,
    // while estimateBodyRows floors at one. That gap used to be
    // unreachable for a real comment; splitting a header and a
    // signature out of the body made it reachable — a comment whose
    // whole content is its signature has empty prose.
    (parts.body ? estimateBodyRows(parts.body, contentWidth) : 0) +
    (parts.footer ? 1 : 0)
  );
}

/**
 * Rows a body string occupies after wrap. With a `contentWidth` this
 * is EXACT, not an estimate: it runs the same `wrap-ansi` call Ink's
 * `<Text wrap="wrap">` uses (ink/build/wrap-text.js), so word
 * boundaries, hard-broken long tokens, and wide glyphs all count the
 * way they paint. Character-count math (`ceil(len/width)`) is not
 * good enough here — it undercounts multi-line bodies whose
 * individual lines wrap, and every scroll consumer (viewport clamp,
 * j/k stepping, scroll-into-view) keys off these numbers, so a
 * one-row miss per card accumulates into unreachable rows.
 *
 * Without a width the number falls back to a 4-line cap (matches the
 * file-list footer's pre-2026 behaviour) — render paths should always
 * pass the real width.
 */
export function estimateBodyRows(body: string, contentWidth?: number): number {
  const naturalLines = Math.max(1, body.split('\n').length);
  if (contentWidth && contentWidth > 0) {
    const wrapped = wrapAnsi(body, contentWidth, { trim: false, hard: true });
    return Math.max(1, wrapped.split('\n').length);
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
 * Replies render in one container with a single marginTop gap, then
 * header + body each; the reply column is indented 2 cells, so reply
 * bodies wrap 2 cols narrower than the root.
 */
export function estimateCardRows(
  thread: RemoteCommentThread,
  contentWidth?: number
): number {
  const root = thread.comments[0];
  if (!root) return 0;
  const rootRows = 4 + bodyRowsWithChrome(root.body, contentWidth);
  const replies = thread.comments.slice(1);
  const replyWidth =
    contentWidth && contentWidth > 0
      ? Math.max(1, contentWidth - 2)
      : undefined;
  const replyRows =
    replies.length === 0
      ? 0
      : 1 +
        replies.reduce(
          (sum, c) => sum + 1 + bodyRowsWithChrome(c.body, replyWidth),
          0
        );
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
  const parts = commentBodyParts(comment.body);
  const lines = parts.body.split('\n');
  const MAX_COLLAPSED = 4;
  const shown = selected ? lines : lines.slice(0, MAX_COLLAPSED);
  const truncatedNote = !selected && lines.length > MAX_COLLAPSED ? 1 : 0;
  // The card paints the shown lines as ONE <Text> holding the newlines
  // (see the note in CommentThread.tsx for why), so measure the joined
  // string rather than summing per line — and measure nothing at all
  // when the prose is empty, which Ink paints as no rows while
  // estimateBodyRows floors at one.
  const prose = shown.join('\n');
  const bodyRows =
    (prose ? estimateBodyRows(prose, contentWidth) : 0) +
    truncatedNote +
    // The badge and the signature each paint one truncating row, and
    // survive the collapse: capping the prose does not remove the
    // card's classification.
    (parts.header ? 1 : 0) +
    (parts.footer ? 1 : 0);
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
 * Buffer-aware version of `REPLY_INPUT_ROWS`: rows the open reply
 * input occupies for a given buffer — the marginTop gap + bordered box
 * (2 rows) + the wrapped buffer. `contentWidth` is the CARD interior
 * width; the input's own text is 6 cols narrower (marginLeft 2 +
 * border 2 + paddingX 2), and the trailing cursor glyph takes a cell.
 */
export function estimateReplyInputRows(
  buffer: string,
  contentWidth?: number
): number {
  const inputWidth =
    contentWidth && contentWidth > 0
      ? Math.max(1, contentWidth - 6)
      : undefined;
  return 1 + 2 + estimateBodyRows(`${buffer}▍`, inputWidth);
}

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
