import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../host/contract.js';
import {
  anchorKey,
  buildSplitRows,
  buildUnifiedRows,
  defaultCollapseReason,
  lineAnchors,
  type CollapseReason,
  type SplitRow,
} from './diff-model.js';

// ── Flat rows for the virtualized all-files diff ─────────────────
//
// The diff renders as ONE list across every file — headers, code
// rows, fold markers and comment cards — so the viewer can virtualize
// it (materialize only the rows in the viewport, terminal-style).
// Everything here is pure data: the component maps a FlatRow to the
// existing row primitives.

export type FlatRow =
  | { key: string; kind: 'conversation' }
  | { key: string; kind: 'file-header'; file: string }
  | { key: string; kind: 'hunk'; file: string; index: number }
  | { key: string; kind: 'unified'; file: string; index: number }
  | { key: string; kind: 'split-context'; file: string; index: number }
  | {
      key: string;
      kind: 'split-pair';
      file: string;
      row: Extract<SplitRow, { kind: 'pair' }>;
    }
  | { key: string; kind: 'fold'; file: string; from: number; to: number }
  | {
      key: string;
      kind: 'comments';
      file: string;
      threads: RemoteCommentThread[];
      drafts: ReviewComment[];
      /** Indent under the gutter (unified view). */
      indent: boolean;
    }
  | {
      key: string;
      kind: 'orphans';
      file: string;
      threads: RemoteCommentThread[];
      drafts: ReviewComment[];
    };

/** Rough pixel heights per row kind; the virtualizer refines them by
 *  measuring rendered rows. Code rows are the exact leading-5 height. */
export function estimateRowHeight(row: FlatRow): number {
  switch (row.kind) {
    case 'unified':
    case 'split-context':
    case 'split-pair':
      return 20;
    case 'hunk':
      return 20;
    case 'fold':
      return 24;
    case 'file-header':
      return 37;
    case 'comments':
      return 160;
    case 'orphans':
      return 220;
    case 'conversation':
      return 260;
  }
}

export interface FileDisplayState {
  /** Overrides the collapse-reason default when set. */
  open?: boolean;
  viewed?: boolean;
  expanded?: ReadonlySet<number>;
}

export interface FileStats {
  adds: number;
  dels: number;
  openThreads: number;
  draftCount: number;
  collapseReason: CollapseReason;
  open: boolean;
  viewed: boolean;
}

export interface FlatDiff {
  rows: FlatRow[];
  /** Comment/draft id → row index (the comments/orphans/conversation
   *  row containing it). */
  indexById: Map<string, number>;
  /** File → its header row index. */
  fileIndex: Map<string, number>;
  /** Per-file header data. */
  stats: Map<string, FileStats>;
}

/** Group agent drafts / remote threads by the anchor they sit under. */
function anchorComments<T extends { side: 'LEFT' | 'RIGHT' }>(
  present: ReadonlySet<string>,
  items: readonly T[],
  lineFor: (t: T) => number | null
): { byAnchor: Map<string, T[]>; orphans: T[]; pinned: Set<string> } {
  const byAnchor = new Map<string, T[]>();
  const orphans: T[] = [];
  const pinned = new Set<string>();
  for (const t of items) {
    const line = lineFor(t);
    if (line == null) {
      orphans.push(t);
      continue;
    }
    const a = anchorKey(t.side === 'LEFT' ? 'L' : 'R', line);
    if (present.has(a)) {
      (byAnchor.get(a) ?? byAnchor.set(a, []).get(a)!).push(t);
      pinned.add(a);
    } else {
      orphans.push(t);
    }
  }
  return { byAnchor, orphans, pinned };
}

/** Every anchor key this file's lines can carry a comment on. */
function presentAnchors(lines: readonly DiffLine[]): Set<string> {
  const present = new Set<string>();
  for (const l of lines) for (const a of lineAnchors(l)) present.add(a);
  return present;
}

/**
 * The tail row under a file, holding comments whose anchor line the
 * diff doesn't contain. Emits nothing when there are none.
 */
function pushOrphans(
  rows: FlatRow[],
  indexById: Map<string, number>,
  file: string,
  threads: RemoteCommentThread[],
  drafts: ReviewComment[]
): void {
  if (threads.length === 0 && drafts.length === 0) return;
  const index = rows.length;
  rows.push({ key: `o:${file}`, kind: 'orphans', file, threads, drafts });
  for (const x of threads) indexById.set(x.id, index);
  for (const x of drafts) indexById.set(x.id, index);
}

export function buildFlatDiff(
  files: readonly [string, DiffLine[]][],
  opts: {
    view: 'unified' | 'split';
    hideResolved: boolean;
    hasConversation: boolean;
    generalThreads: readonly RemoteCommentThread[];
    threadsByFile: ReadonlyMap<string, RemoteCommentThread[]>;
    draftsByFile: ReadonlyMap<string, ReviewComment[]>;
    fileState: ReadonlyMap<string, FileDisplayState>;
  }
): FlatDiff {
  const rows: FlatRow[] = [];
  const indexById = new Map<string, number>();
  const fileIndex = new Map<string, number>();
  const stats = new Map<string, FileStats>();

  if (opts.hasConversation) {
    rows.push({ key: 'conversation', kind: 'conversation' });
    for (const t of opts.generalThreads) indexById.set(t.id, 0);
  }

  for (const [file, lines] of files) {
    const state = opts.fileState.get(file) ?? {};
    const adds = lines.filter((l) => l.type === 'add').length;
    const dels = lines.filter((l) => l.type === 'remove').length;
    const collapseReason = defaultCollapseReason(file, adds + dels);
    const open = state.open ?? collapseReason === null;

    const allThreads = opts.threadsByFile.get(file) ?? [];
    const visibleThreads = opts.hideResolved
      ? allThreads.filter((t) => !t.isResolved)
      : allThreads;
    const activeDrafts = (opts.draftsByFile.get(file) ?? []).filter(
      (d) => d.status !== 'posted'
    );

    fileIndex.set(file, rows.length);
    rows.push({ key: `h:${file}`, kind: 'file-header', file });
    stats.set(file, {
      adds,
      dels,
      openThreads: allThreads.filter((t) => !t.isResolved).length,
      draftCount: activeDrafts.length,
      collapseReason,
      open,
      viewed: state.viewed ?? false,
    });
    if (!open) continue;

    const present = presentAnchors(lines);
    const t = anchorComments(present, visibleThreads, (x) =>
      x.lineStart == null ? null : x.lineEnd ?? x.lineStart
    );
    const d = anchorComments(present, activeDrafts, (x) => x.lineEnd);
    const pinnedAll = new Set([...t.pinned, ...d.pinned]);

    const unified = buildUnifiedRows(lines, {
      pinnedAnchors: pinnedAll,
      expanded: state.expanded ?? new Set(),
      noFold: lines.length <= 40,
    });

    const pushComments = (
      line: DiffLine,
      keySuffix: string,
      onlyLeft: boolean,
      indent: boolean
    ) => {
      const threads: RemoteCommentThread[] = [];
      const drafts: ReviewComment[] = [];
      const take = (anchor: string) => {
        threads.push(...(t.byAnchor.get(anchor) ?? []));
        drafts.push(...(d.byAnchor.get(anchor) ?? []));
      };
      if (!onlyLeft && line.newLine != null) take(anchorKey('R', line.newLine));
      // A context line carries both an old and a new number, and a
      // LEFT-side comment anchors to the old one. Taking the L anchor
      // only for removed lines dropped those comments entirely: they
      // count as anchored (so they never reach the orphan tail) but no
      // row ever emitted them. Whole-file diffs make most lines
      // context lines, and GitHub marks real threads LEFT.
      if ((onlyLeft || line.type !== 'add') && line.oldLine != null) {
        take(anchorKey('L', line.oldLine));
      }
      if (threads.length === 0 && drafts.length === 0) return;
      const index = rows.length;
      rows.push({
        key: `c:${file}:${keySuffix}`,
        kind: 'comments',
        file,
        threads,
        drafts,
        indent,
      });
      for (const x of threads) indexById.set(x.id, index);
      for (const x of drafts) indexById.set(x.id, index);
    };

    /**
     * A side-by-side row and the comment cards hanging off each half.
     * Either side can be absent where the two files differ in length.
     */
    const pushSplitPair = (row: Extract<SplitRow, { kind: 'pair' }>) => {
      rows.push({
        key: `p:${file}:${row.left?.index ?? 'x'}:${row.right?.index ?? 'x'}`,
        kind: 'split-pair',
        file,
        row,
      });
      if (row.left) {
        pushComments(row.left.line, `l${row.left.index}`, true, false);
      }
      if (row.right) {
        pushComments(row.right.line, `r${row.right.index}`, false, false);
      }
    };

    const pushFold = (from: number, to: number) => {
      rows.push({ key: `f:${file}:${from}`, kind: 'fold', file, from, to });
    };
    const pushHunk = (index: number) => {
      rows.push({ key: `k:${file}:${index}`, kind: 'hunk', file, index });
    };

    /** Side-by-side: every row pairs a left and a right half. */
    const appendSplitRows = () => {
      for (const row of buildSplitRows(lines, unified)) {
        if (row.kind === 'fold') {
          pushFold(row.from, row.to);
        } else if (row.kind === 'hunk') {
          pushHunk(row.index);
        } else if (row.kind === 'context') {
          rows.push({
            key: `s:${file}:${row.index}`,
            kind: 'split-context',
            file,
            index: row.index,
          });
          pushComments(lines[row.index], `s${row.index}`, false, false);
        } else {
          pushSplitPair(row);
        }
      }
    };

    /** One column: each visible line is its own row. */
    const appendUnifiedRows = () => {
      for (const row of unified) {
        if (row.kind === 'fold') {
          pushFold(row.from, row.to);
          continue;
        }
        const line = lines[row.index];
        if (line.type === 'hunk-header') {
          pushHunk(row.index);
          continue;
        }
        rows.push({
          key: `u:${file}:${row.index}`,
          kind: 'unified',
          file,
          index: row.index,
        });
        pushComments(line, `u${row.index}`, false, true);
      }
    };

    if (opts.view === 'split') appendSplitRows();
    else appendUnifiedRows();

    pushOrphans(rows, indexById, file, t.orphans, d.orphans);
  }

  return { rows, indexById, fileIndex, stats };
}
