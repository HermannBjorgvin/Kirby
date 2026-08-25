import { memo, useCallback, useMemo, useState } from 'react';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import {
  anchorKey,
  buildSplitRows,
  buildUnifiedRows,
  defaultCollapseReason,
  expandIndices,
  lineAnchors,
} from '../../lib/diff-model.js';
import { useDiffOptions } from '../../lib/diff-options.js';
import { useFileAnalysis } from '../../lib/highlight.js';
import { useTheme } from '../../lib/theme.js';
import { CommentBlock, OrphanBlock } from './CommentBlock.js';
import { DiffFileHeader } from './DiffFileHeader.js';
import { FoldRow, HunkRow, SplitCell, UnifiedRow } from './diff-rows.js';

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

/**
 * One file's diff. Unchanged regions fold to ±3 lines with expandable
 * gaps (the host sends whole-file context so comments on untouched
 * lines can be placed); changed line pairs get intra-line word
 * highlights; comments render under the line they anchor to, and those
 * whose anchor is outside the diff are listed at the bottom.
 */
export const DiffView = memo(function DiffView({
  filename,
  lines,
  threads,
  drafts = [],
  prId,
  headSha,
  focusThreadId,
}: {
  filename: string;
  lines: DiffLine[];
  threads: RemoteCommentThread[];
  drafts?: ReviewComment[];
  prId: number;
  headSha?: string;
  focusThreadId: string | null;
}) {
  const options = useDiffOptions();
  const { resolved } = useTheme();

  const adds = useMemo(
    () => lines.filter((l) => l.type === 'add').length,
    [lines]
  );
  const dels = useMemo(
    () => lines.filter((l) => l.type === 'remove').length,
    [lines]
  );
  const collapseReason = defaultCollapseReason(filename, adds + dels);
  const [open, setOpen] = useState(collapseReason === null);
  const [viewed, setViewed] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const visibleThreads = useMemo(
    () =>
      options.hideResolved ? threads.filter((t) => !t.isResolved) : threads,
    [threads, options.hideResolved]
  );
  const activeDrafts = useMemo(
    () => drafts.filter((d) => d.status !== 'posted'),
    [drafts]
  );

  const { inline, draftMap, orphaned, orphanDrafts, pinnedAll } =
    useMemo(() => {
      const present = new Set<string>();
      for (const l of lines) for (const a of lineAnchors(l)) present.add(a);
      const t = anchorComments(present, visibleThreads, (x) =>
        x.lineStart == null ? null : x.lineEnd ?? x.lineStart
      );
      const d = anchorComments(present, activeDrafts, (x) => x.lineEnd);
      return {
        inline: t.byAnchor,
        draftMap: d.byAnchor,
        orphaned: t.orphans,
        orphanDrafts: d.orphans,
        pinnedAll: new Set([...t.pinned, ...d.pinned]),
      };
    }, [lines, visibleThreads, activeDrafts]);

  const unifiedRows = useMemo(
    () =>
      buildUnifiedRows(lines, {
        pinnedAnchors: pinnedAll,
        expanded,
        noFold: lines.length <= 40,
      }),
    [lines, pinnedAll, expanded]
  );
  const splitRows = useMemo(
    () =>
      options.view === 'split' ? buildSplitRows(lines, unifiedRows) : null,
    [options.view, lines, unifiedRows]
  );

  // Tokens + word-diff ranges come from the diff worker, off-thread.
  const { tokens, wordRanges } = useFileAnalysis(
    filename,
    lines,
    resolved,
    open
  );

  const expand = useCallback(
    (fold: { from: number; to: number }, dir: 'up' | 'down' | 'all') =>
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const i of expandIndices(fold, dir)) next.add(i);
        return next;
      }),
    []
  );

  const commentsFor = useCallback(
    (line: DiffLine, onlyLeft = false) => {
      const threads: RemoteCommentThread[] = [];
      const drafts: ReviewComment[] = [];
      const push = (anchor: string) => {
        threads.push(...(inline.get(anchor) ?? []));
        drafts.push(...(draftMap.get(anchor) ?? []));
      };
      if (!onlyLeft && line.newLine != null) push(anchorKey('R', line.newLine));
      if ((onlyLeft || line.type === 'remove') && line.oldLine != null) {
        push(anchorKey('L', line.oldLine));
      }
      return { threads, drafts };
    },
    [inline, draftMap]
  );

  const openThreads = threads.filter((t) => !t.isResolved).length;
  const block = (line: DiffLine, onlyLeft = false, indent = true) => {
    const c = commentsFor(line, onlyLeft);
    return (
      <CommentBlock
        threads={c.threads}
        drafts={c.drafts}
        prId={prId}
        headSha={headSha}
        focusId={focusThreadId}
        indent={indent}
      />
    );
  };
  const orphanBlock =
    orphaned.length > 0 || orphanDrafts.length > 0 ? (
      <OrphanBlock
        threads={orphaned}
        drafts={orphanDrafts}
        prId={prId}
        headSha={headSha}
        focusId={focusThreadId}
      />
    ) : null;

  return (
    <section data-file={filename} className="border-b border-border">
      <DiffFileHeader
        filename={filename}
        open={open}
        onToggleOpen={() => setOpen((o) => !o)}
        viewed={viewed}
        onToggleViewed={() => {
          setViewed((v) => !v);
          setOpen(viewed);
        }}
        collapseReason={collapseReason}
        draftCount={activeDrafts.length}
        openThreads={openThreads}
        adds={adds}
        dels={dels}
      />

      {open &&
        (splitRows ? (
          <div className="font-mono text-sm leading-5">
            {splitRows.map((row, i) => {
              if (row.kind === 'fold')
                return (
                  <FoldRow key={`f${row.from}`} fold={row} onExpand={expand} />
                );
              if (row.kind === 'hunk')
                return <HunkRow key={i} line={lines[row.index]} />;
              if (row.kind === 'context') {
                const line = lines[row.index];
                return (
                  <div key={i}>
                    <div className="grid grid-cols-2">
                      <SplitCell
                        cell={{ index: row.index, line }}
                        tokens={tokens?.[row.index]}
                        side="L"
                        wrap
                      />
                      <SplitCell
                        cell={{ index: row.index, line }}
                        tokens={tokens?.[row.index]}
                        side="R"
                        wrap
                      />
                    </div>
                    {block(line, false, false)}
                  </div>
                );
              }
              return (
                <div key={i}>
                  <div className="grid grid-cols-2">
                    <SplitCell
                      cell={row.left}
                      tokens={row.left ? tokens?.[row.left.index] : undefined}
                      ranges={
                        row.left ? wordRanges.get(row.left.index) : undefined
                      }
                      side="L"
                      wrap
                    />
                    <SplitCell
                      cell={row.right}
                      tokens={row.right ? tokens?.[row.right.index] : undefined}
                      ranges={
                        row.right ? wordRanges.get(row.right.index) : undefined
                      }
                      side="R"
                      wrap
                    />
                  </div>
                  {row.left && block(row.left.line, true, false)}
                  {row.right && block(row.right.line, false, false)}
                </div>
              );
            })}
            {orphanBlock}
          </div>
        ) : (
          <div className="font-mono text-sm leading-5">
            {unifiedRows.map((row) => {
              if (row.kind === 'fold')
                return (
                  <FoldRow key={`f${row.from}`} fold={row} onExpand={expand} />
                );
              const line = lines[row.index];
              if (line.type === 'hunk-header')
                return <HunkRow key={row.index} line={line} />;
              return (
                <div key={row.index}>
                  <UnifiedRow
                    line={line}
                    tokens={tokens?.[row.index]}
                    ranges={wordRanges.get(row.index)}
                    wrap={options.wrap}
                  />
                  {block(line)}
                </div>
              );
            })}
            {orphanBlock}
          </div>
        ))}
    </section>
  );
});
