import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  planCommentFooter,
  CARD_MAX_WIDTH,
  type FooterComposeState,
} from '../../components/CommentThread.js';
import {
  totalRows,
  viewportRowsForBudget,
} from '../../utils/virtual-viewport.js';

// Layout math shared by the DiffFileList renderer and the
// diff-file-list input handler. Both sides need identical geometry —
// the renderer to draw the footer viewport, the handler to scroll it —
// so it lives here instead of being derived twice.

// Tree row — either a directory header or a file. Directory headers
// render dim with no stats; their depth indents nested paths.
// `fileRowIndex` is the ordinal within the file-only sequence, used to
// map the outer `selectedIndex` (which still counts files, not rows)
// to a row.
export type TreeRow =
  | { kind: 'dir'; name: string; depth: number }
  | { kind: 'file'; file: DiffFile; depth: number; fileRowIndex: number };

export function buildFileTree(files: DiffFile[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const emittedDirs = new Set<string>();
  files.forEach((file, fileRowIndex) => {
    const parts = file.filename.split('/');
    const dirs = parts.slice(0, -1);
    // Emit each missing ancestor directory once, deepest-last.
    let prefix = '';
    dirs.forEach((segment, depth) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (!emittedDirs.has(prefix)) {
        emittedDirs.add(prefix);
        rows.push({ kind: 'dir', name: segment, depth });
      }
    });
    rows.push({
      kind: 'file',
      file,
      depth: dirs.length,
      fileRowIndex,
    });
  });
  return rows;
}

// ── Unified list items ───────────────────────────────────────────
// File rows and comment cards live in ONE virtual viewport — there is
// no separate file window + comments footer. Non-selectable rows are
// merged into the span of the selectable item they precede: directory
// headers ride on the file below them, and the "PR Comments" heading
// (plus its blank spacer row) rides on the first comment. That keeps
// the spans array 1:1 with the selection ordinal (files first, then
// comments), so the viewport geometry needs no notion of
// "unselectable" items.

export type DiffListItem =
  | {
      kind: 'file';
      file: DiffFile;
      depth: number;
      /** Directory headers rendered directly above this file. */
      dirs: { name: string; depth: number }[];
      span: number;
    }
  | {
      kind: 'comment';
      thread: RemoteCommentThread;
      commentIndex: number;
      /** First comment carries the section heading (blank + title). */
      withHeading: boolean;
      span: number;
    };

/**
 * Stable identity for a unified-list item — scroll anchoring compares
 * previous/next layouts by key so offsets track content, not indices.
 */
export function itemKey(item: DiffListItem): string {
  return item.kind === 'file'
    ? `f:${item.file.filename}`
    : `c:${item.thread.id}`;
}

export function buildDiffListItems(opts: {
  displayFiles: DiffFile[];
  treeMode: boolean;
  threads: RemoteCommentThread[];
  cardContentWidth: number;
  /** Live compose state — an open reply input / annotate composer
   *  changes the composing card's span. */
  compose?: FooterComposeState;
}): DiffListItem[] {
  const { displayFiles, treeMode, threads, cardContentWidth } = opts;
  const items: DiffListItem[] = [];

  if (treeMode) {
    let pendingDirs: { name: string; depth: number }[] = [];
    for (const row of buildFileTree(displayFiles)) {
      if (row.kind === 'dir') {
        pendingDirs.push({ name: row.name, depth: row.depth });
      } else {
        items.push({
          kind: 'file',
          file: row.file,
          depth: row.depth,
          dirs: pendingDirs,
          span: 1 + pendingDirs.length,
        });
        pendingDirs = [];
      }
    }
  } else {
    for (const file of displayFiles) {
      items.push({ kind: 'file', file, depth: 0, dirs: [], span: 1 });
    }
  }

  const { spans: cardSpans } = planCommentFooter(
    threads,
    cardContentWidth,
    opts.compose
  );
  threads.forEach((thread, commentIndex) => {
    const withHeading = commentIndex === 0;
    items.push({
      kind: 'comment',
      thread,
      commentIndex,
      withHeading,
      // Heading block = blank spacer + "PR Comments (N)" row.
      span: (cardSpans[commentIndex] ?? 5) + (withHeading ? 2 : 0),
    });
  });

  return items;
}

export interface DiffListLayout {
  /** Interior pane width (paneCols minus paddingX). */
  maxWidth: number;
  /** Comment card width, capped like the diff viewer's cards. */
  cardWidth: number;
  /** Card interior text width (cardWidth minus border + padding). */
  cardContentWidth: number;
  /** Unified items — files first, then comments (selection order). */
  items: DiffListItem[];
  /** Row span per item, 1:1 with `items`. */
  spans: number[];
  /** Rows handed to `<VirtualViewport>`. */
  budgetRows: number;
  /** Body rows for scroll math — clamped/stepped against this. */
  viewportRows: number;
}

export function computeDiffListLayout(opts: {
  paneRows: number;
  paneCols: number;
  displayFiles: DiffFile[];
  treeMode: boolean;
  skippedCount: number;
  threads: RemoteCommentThread[];
  /** Live compose state — see `buildDiffListItems`. */
  compose?: FooterComposeState;
}): DiffListLayout {
  const { paneRows, paneCols, displayFiles, skippedCount, threads } = opts;

  const maxWidth = Math.max(20, paneCols - 2);
  const cardWidth = Math.min(CARD_MAX_WIDTH, maxWidth);
  const cardContentWidth = Math.max(1, cardWidth - 4);

  const items = buildDiffListItems({
    displayFiles,
    treeMode: opts.treeMode,
    threads,
    cardContentWidth,
    compose: opts.compose,
  });
  const spans = items.map((i) => i.span);

  // Chrome outside the viewport: title + divider + hints (marginTop +
  // row) + optional skipped note + the "(no files)" placeholder row.
  const skippedNoteRows = skippedCount > 0 ? 1 : 0;
  const noFilesRows = displayFiles.length === 0 ? 1 : 0;
  const budgetRows = Math.max(1, paneRows - 4 - skippedNoteRows - noFilesRows);
  const viewportRows = viewportRowsForBudget(totalRows(spans), budgetRows);

  return {
    maxWidth,
    cardWidth,
    cardContentWidth,
    items,
    spans,
    budgetRows,
    viewportRows,
  };
}
