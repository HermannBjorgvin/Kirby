import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../../host/contract.js';
import { expandIndices } from '../../../lib/diff/diff-model.js';
import { useDiffOptions } from '../../../lib/diff/diff-options.js';
import {
  buildFlatDiff,
  estimateRowHeight,
  type FileDisplayState,
  type FlatRow,
} from '../../../lib/diff/diff-virtual.js';
import {
  cellHighlight,
  lineHighlight,
  useFileAnalyses,
} from '../../../lib/diff/highlight.js';
import { useTheme } from '../../../lib/theme.js';
import { CommentBlock, OrphanBlock } from '../comments/CommentBlock.js';
import { ConversationPanel } from '../comments/ConversationPanel.js';
import { DiffFileHeader } from './DiffFileHeader.js';
import { FoldRow, HunkRow, SplitCell, UnifiedRow } from './diff-rows.js';

/** Imperative scrolling into the virtualized list — jump targets may
 *  not be materialized yet, so DOM queries can't do this. */
export interface DiffJumpHandle {
  /** Scroll the row containing this thread/draft id into view. */
  jumpToId(id: string): boolean;
  /** Scroll a file's header row into view. */
  jumpToFile(file: string): boolean;
}

/**
 * The all-files diff as ONE virtualized list: only the rows in (and
 * around) the viewport exist as DOM, terminal-style, so a whole-file
 * diff of any size mounts and scrolls at a constant cost. Row visuals
 * are the same primitives the per-file view used.
 */
export function VirtualDiffList({
  files,
  threadsByFile,
  draftsByFile,
  generalThreads,
  commentsLoading,
  prId,
  headSha,
  focusThreadId,
  scrollRef,
  jumpRef,
}: {
  files: [string, DiffLine[]][];
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  prId: number;
  headSha?: string;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef?: Ref<DiffJumpHandle>;
}) {
  const options = useDiffOptions();
  const { resolved } = useTheme();
  const [fileState, setFileState] = useState<Map<string, FileDisplayState>>(
    () => new Map()
  );

  const linesByFile = useMemo(() => new Map(files), [files]);

  const flat = useMemo(
    () =>
      buildFlatDiff(files, {
        view: options.view,
        hideResolved: options.hideResolved,
        hasConversation: generalThreads.length > 0 || commentsLoading,
        generalThreads,
        threadsByFile,
        draftsByFile,
        fileState,
      }),
    [
      files,
      options.view,
      options.hideResolved,
      generalThreads,
      commentsLoading,
      threadsByFile,
      draftsByFile,
      fileState,
    ]
  );
  const rows = flat.rows;

  // React Compiler declines to memoize a component that calls this,
  // because the virtualizer hands back methods rather than values. That
  // is a property of @tanstack/react-virtual and not something this
  // file can restructure — and the desktop build does not run the
  // compiler, so the notice describes an optimisation that never runs.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateRowHeight(rows[i]),
    getItemKey: (i) => rows[i].key,
    overscan: 16,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Highlight only files that currently have rows on screen.
  const wantedFiles = useMemo(() => {
    const wanted = new Set<string>();
    for (const vi of virtualItems) {
      const row = rows[vi.index];
      if ('file' in row) wanted.add(row.file);
    }
    return wanted;
    // virtualItems identity churns per scroll frame; the derived set is
    // tiny and memo keeps downstream effects keyed on real changes.
  }, [virtualItems, rows]);
  const analyses = useFileAnalyses(linesByFile, resolved, wantedFiles);

  const patchFile = useCallback(
    (file: string, patch: Partial<FileDisplayState>) =>
      setFileState((prev) => {
        const next = new Map(prev);
        next.set(file, { ...next.get(file), ...patch });
        return next;
      }),
    []
  );
  const expand = useCallback(
    (
      file: string,
      fold: { from: number; to: number },
      dir: 'up' | 'down' | 'all'
    ) =>
      setFileState((prev) => {
        const next = new Map(prev);
        const cur = next.get(file) ?? {};
        const expanded = new Set(cur.expanded ?? []);
        for (const i of expandIndices(fold, dir)) expanded.add(i);
        next.set(file, { ...cur, expanded });
        return next;
      }),
    []
  );

  useImperativeHandle(
    jumpRef,
    () => ({
      jumpToId: (id) => {
        const index = flat.indexById.get(id);
        if (index == null) return false;
        virtualizer.scrollToIndex(index, { align: 'center' });
        return true;
      },
      jumpToFile: (file) => {
        const index = flat.fileIndex.get(file);
        if (index == null) return false;
        virtualizer.scrollToIndex(index, { align: 'start' });
        return true;
      },
    }),
    [flat, virtualizer]
  );

  const renderRow = (row: FlatRow) => {
    switch (row.kind) {
      case 'conversation':
        return (
          <ConversationPanel
            threads={generalThreads}
            loading={commentsLoading}
            prId={prId}
            focusThreadId={focusThreadId}
          />
        );
      case 'file-header': {
        const s = flat.stats.get(row.file);
        if (!s) return null;
        return (
          <div data-file={row.file} className="border-t border-border">
            <DiffFileHeader
              filename={row.file}
              open={s.open}
              onToggleOpen={() => patchFile(row.file, { open: !s.open })}
              viewed={s.viewed}
              onToggleViewed={() =>
                patchFile(row.file, { viewed: !s.viewed, open: s.viewed })
              }
              collapseReason={s.collapseReason}
              draftCount={s.draftCount}
              openThreads={s.openThreads}
              adds={s.adds}
              dels={s.dels}
            />
          </div>
        );
      }
      case 'hunk':
        return <HunkRow line={linesByFile.get(row.file)![row.index]} />;
      case 'fold':
        return (
          <FoldRow
            fold={{ from: row.from, to: row.to }}
            onExpand={(fold, dir) => expand(row.file, fold, dir)}
          />
        );
      case 'unified': {
        const line = linesByFile.get(row.file)![row.index];
        const hl = lineHighlight(analyses.get(row.file), row.index);
        return (
          <UnifiedRow
            line={line}
            tokens={hl.tokens}
            ranges={hl.ranges}
            wrap={options.wrap}
          />
        );
      }
      case 'split-context': {
        const line = linesByFile.get(row.file)![row.index];
        const { tokens } = lineHighlight(analyses.get(row.file), row.index);
        const cell = { index: row.index, line };
        return (
          <div className="grid grid-cols-2">
            <SplitCell cell={cell} tokens={tokens} side="L" wrap />
            <SplitCell cell={cell} tokens={tokens} side="R" wrap />
          </div>
        );
      }
      case 'split-pair': {
        const analysis = analyses.get(row.file);
        const { left, right } = row.row;
        const hlLeft = cellHighlight(analysis, left);
        const hlRight = cellHighlight(analysis, right);
        return (
          <div className="grid grid-cols-2">
            <SplitCell
              cell={left}
              tokens={hlLeft.tokens}
              ranges={hlLeft.ranges}
              side="L"
              wrap
            />
            <SplitCell
              cell={right}
              tokens={hlRight.tokens}
              ranges={hlRight.ranges}
              side="R"
              wrap
            />
          </div>
        );
      }
      case 'comments':
        return (
          <CommentBlock
            threads={row.threads}
            drafts={row.drafts}
            prId={prId}
            headSha={headSha}
            focusId={focusThreadId}
            indent={row.indent}
          />
        );
      case 'orphans':
        return (
          <OrphanBlock
            threads={row.threads}
            drafts={row.drafts}
            prId={prId}
            headSha={headSha}
            focusId={focusThreadId}
          />
        );
    }
  };

  return (
    <div
      className="relative font-mono text-sm leading-5"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((vi) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${vi.start}px)` }}
        >
          {renderRow(rows[vi.index])}
        </div>
      ))}
    </div>
  );
}
