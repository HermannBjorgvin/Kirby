import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  EyeOffIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import type { DiffLine } from '@kirby/diff';
import type { RemoteCommentThread } from '../../../host/contract.js';
import {
  anchorKey,
  buildSplitRows,
  buildUnifiedRows,
  defaultCollapseReason,
  expandIndices,
  lineAnchors,
  wordDiff,
  type CharRange,
  type SplitCell,
  type UnifiedRow,
} from '../../lib/diff-model.js';
import { useDiffOptions } from '../../lib/diff-options.js';
import { useHighlightedLines, type LineTokens } from '../../lib/highlight.js';
import { useTheme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { ThreadCard } from './ThreadCard.js';

/**
 * One file's diff. Unchanged regions are folded to ±3 lines with
 * expandable gaps (the host gives us whole-file context so threads on
 * untouched lines can be placed); changed line pairs get intra-line
 * word highlights; threads render under the line they anchor to, and
 * threads whose anchor is outside the diff are listed at the bottom.
 */
export const DiffView = memo(function DiffView({
  filename,
  lines,
  threads,
  prId,
  focusThreadId,
}: {
  filename: string;
  lines: DiffLine[];
  threads: RemoteCommentThread[];
  prId: number;
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

  // Threads keyed by the anchor they sit under.
  const { inline, orphaned, pinned } = useMemo(() => {
    const present = new Set<string>();
    for (const l of lines) for (const a of lineAnchors(l)) present.add(a);
    const inline = new Map<string, RemoteCommentThread[]>();
    const pinned = new Set<string>();
    const orphaned: RemoteCommentThread[] = [];
    for (const t of visibleThreads) {
      if (t.lineStart == null) {
        orphaned.push(t);
        continue;
      }
      const a = anchorKey(
        t.side === 'LEFT' ? 'L' : 'R',
        t.lineEnd ?? t.lineStart
      );
      if (present.has(a)) {
        (inline.get(a) ?? inline.set(a, []).get(a)!).push(t);
        pinned.add(a);
      } else {
        orphaned.push(t);
      }
    }
    return { inline, orphaned, pinned };
  }, [lines, visibleThreads]);

  const unifiedRows = useMemo(
    () =>
      buildUnifiedRows(lines, {
        pinnedAnchors: pinned,
        expanded,
        noFold: lines.length <= 40,
      }),
    [lines, pinned, expanded]
  );
  const splitRows = useMemo(
    () =>
      options.view === 'split' ? buildSplitRows(lines, unifiedRows) : null,
    [options.view, lines, unifiedRows]
  );

  const contents = useMemo(() => lines.map((l) => l.content), [lines]);
  const tokens = useHighlightedLines(filename, contents, resolved, open);

  // Word-level highlights for paired remove/add lines (both layouts).
  const wordRanges = useMemo(() => {
    const map = new Map<number, CharRange[]>();
    const pairs = buildSplitRows(
      lines,
      lines.map((_, index) => ({ kind: 'line', index }))
    );
    for (const r of pairs) {
      if (r.kind !== 'pair' || !r.left || !r.right) continue;
      const d = wordDiff(r.left.line.content, r.right.line.content);
      if (!d) continue;
      map.set(r.left.index, d.old);
      map.set(r.right.index, d.new);
    }
    return map;
  }, [lines]);

  const expand = useCallback(
    (fold: { from: number; to: number }, dir: 'up' | 'down' | 'all') =>
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const i of expandIndices(fold, dir)) next.add(i);
        return next;
      }),
    []
  );

  const openThreads = threads.filter((t) => !t.isResolved).length;
  const dir = filename.includes('/')
    ? filename.slice(0, filename.lastIndexOf('/') + 1)
    : '';
  const base = filename.slice(dir.length);

  const threadsFor = (line: DiffLine, onlyLeft = false) => {
    const out: RemoteCommentThread[] = [];
    if (!onlyLeft && line.newLine != null)
      out.push(...(inline.get(anchorKey('R', line.newLine)) ?? []));
    if ((onlyLeft || line.type === 'remove') && line.oldLine != null) {
      out.push(...(inline.get(anchorKey('L', line.oldLine)) ?? []));
    }
    return out;
  };

  const threadBlock = (list: RemoteCommentThread[], indent = true) =>
    list.length > 0 && (
      <div
        className={cn(
          'space-y-2 border-y border-border bg-muted/30 py-2 pr-4 font-sans',
          indent ? 'pl-[5.5rem]' : 'pl-4'
        )}
      >
        {list.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            prId={prId}
            focused={t.id === focusThreadId}
          />
        ))}
      </div>
    );

  return (
    <section data-file={filename} className="border-b border-border">
      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border bg-background/95 px-2 backdrop-blur">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-sm">
            <span className="text-muted-foreground">{dir}</span>
            <span
              className={cn(
                'text-foreground',
                viewed && 'text-muted-foreground line-through'
              )}
            >
              {base}
            </span>
          </span>
        </button>
        {collapseReason && !open && (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            {collapseReason === 'large'
              ? 'large diff'
              : collapseReason === 'lockfile'
              ? 'lockfile'
              : 'generated'}
          </span>
        )}
        {openThreads > 0 && (
          <span className="rounded-full bg-warning/15 px-1.5 text-xs font-medium text-warning">
            {openThreads} open
          </span>
        )}
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-success">+{adds}</span>{' '}
          <span className="text-destructive">−{dels}</span>
        </span>
        <Tip label={viewed ? 'Mark as not viewed' : 'Mark as viewed'}>
          <button
            onClick={() => {
              setViewed((v) => !v);
              setOpen(viewed);
            }}
            className={cn(
              'ml-1 flex h-5 items-center gap-1 rounded border px-1.5 text-xs transition-colors',
              viewed
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {viewed ? (
              <CheckIcon className="size-3" />
            ) : (
              <EyeOffIcon className="size-3" />
            )}
            Viewed
          </button>
        </Tip>
      </div>

      {open &&
        (splitRows ? (
          <div className="font-mono text-sm leading-5">
            {splitRows.map((row, i) => {
              if (row.kind === 'fold') {
                return (
                  <FoldRow key={`f${row.from}`} fold={row} onExpand={expand} />
                );
              }
              if (row.kind === 'hunk') {
                return <HunkRow key={i} line={lines[row.index]} />;
              }
              if (row.kind === 'context') {
                const line = lines[row.index];
                return (
                  <div key={i}>
                    <div className="grid grid-cols-2">
                      <SplitCellView
                        cell={{ index: row.index, line }}
                        tokens={tokens?.[row.index]}
                        ranges={undefined}
                        side="L"
                        wrap
                      />
                      <SplitCellView
                        cell={{ index: row.index, line }}
                        tokens={tokens?.[row.index]}
                        ranges={undefined}
                        side="R"
                        wrap
                      />
                    </div>
                    {threadBlock(threadsFor(line), false)}
                  </div>
                );
              }
              const attached = [
                ...(row.left ? threadsFor(row.left.line, true) : []),
                ...(row.right ? threadsFor(row.right.line) : []),
              ];
              return (
                <div key={i}>
                  <div className="grid grid-cols-2">
                    <SplitCellView
                      cell={row.left}
                      tokens={row.left ? tokens?.[row.left.index] : undefined}
                      ranges={
                        row.left ? wordRanges.get(row.left.index) : undefined
                      }
                      side="L"
                      wrap
                    />
                    <SplitCellView
                      cell={row.right}
                      tokens={row.right ? tokens?.[row.right.index] : undefined}
                      ranges={
                        row.right ? wordRanges.get(row.right.index) : undefined
                      }
                      side="R"
                      wrap
                    />
                  </div>
                  {threadBlock(attached, false)}
                </div>
              );
            })}
            {orphaned.length > 0 && (
              <OrphanBlock
                threads={orphaned}
                prId={prId}
                focusThreadId={focusThreadId}
              />
            )}
          </div>
        ) : (
          <div className="font-mono text-sm leading-5">
            {unifiedRows.map((row) => {
              if (row.kind === 'fold') {
                return (
                  <FoldRow key={`f${row.from}`} fold={row} onExpand={expand} />
                );
              }
              const line = lines[row.index];
              if (line.type === 'hunk-header')
                return <HunkRow key={row.index} line={line} />;
              return (
                <div key={row.index}>
                  <UnifiedRowView
                    line={line}
                    tokens={tokens?.[row.index]}
                    ranges={wordRanges.get(row.index)}
                    wrap={options.wrap}
                  />
                  {threadBlock(threadsFor(line))}
                </div>
              );
            })}
            {orphaned.length > 0 && (
              <OrphanBlock
                threads={orphaned}
                prId={prId}
                focusThreadId={focusThreadId}
              />
            )}
          </div>
        ))}
    </section>
  );
});

// ── Rows ─────────────────────────────────────────────────────────

function FoldRow({
  fold,
  onExpand,
}: {
  fold: { from: number; to: number };
  onExpand: (
    fold: { from: number; to: number },
    dir: 'up' | 'down' | 'all'
  ) => void;
}) {
  const count = fold.to - fold.from;
  return (
    <div className="flex h-7 items-center gap-1 border-y border-border bg-diff-hunk/60 px-2 font-sans text-xs text-muted-foreground">
      <Tip label="Show 20 more lines above">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onExpand(fold, 'up')}
          aria-label="Expand up"
        >
          <ChevronUpIcon />
        </Button>
      </Tip>
      <Tip label="Show 20 more lines below">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onExpand(fold, 'down')}
          aria-label="Expand down"
        >
          <ChevronDownIcon />
        </Button>
      </Tip>
      <button
        onClick={() => onExpand(fold, 'all')}
        className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
      >
        <ChevronsUpDownIcon className="size-3.5" />
        {count} unchanged line{count === 1 ? '' : 's'} hidden
      </button>
    </div>
  );
}

function HunkRow({ line }: { line: DiffLine }) {
  return (
    <div className="flex h-6 items-center bg-diff-hunk px-3 text-xs text-diff-hunk-fg">
      <span className="truncate">{line.content}</span>
    </div>
  );
}

const ROW_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add',
  remove: 'bg-diff-del',
  context: '',
  'hunk-header': '',
};
const GUTTER_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add-gutter',
  remove: 'bg-diff-del-gutter',
  context: 'bg-background',
  'hunk-header': '',
};
const SIGN: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
  'hunk-header': '',
};

function UnifiedRowView({
  line,
  tokens,
  ranges,
  wrap,
}: {
  line: DiffLine;
  tokens: LineTokens | undefined;
  ranges: CharRange[] | undefined;
  wrap: boolean;
}) {
  return (
    <div
      className={cn('flex', wrap ? 'w-full' : 'min-w-max', ROW_BG[line.type])}
    >
      <span
        className={cn(
          'sticky left-0 z-[1] flex shrink-0 select-none text-muted-foreground/70',
          GUTTER_BG[line.type]
        )}
      >
        <span className="w-11 pr-2 text-right tabular-nums">
          {line.oldLine ?? ''}
        </span>
        <span className="w-11 pr-2 text-right tabular-nums">
          {line.newLine ?? ''}
        </span>
        <span
          className={cn(
            'w-5 text-center',
            line.type === 'add' && 'text-success',
            line.type === 'remove' && 'text-destructive'
          )}
        >
          {SIGN[line.type]}
        </span>
      </span>
      <LineContent line={line} tokens={tokens} ranges={ranges} wrap={wrap} />
    </div>
  );
}

function SplitCellView({
  cell,
  tokens,
  ranges,
  side,
  wrap,
}: {
  cell: SplitCell | null;
  tokens: LineTokens | undefined;
  ranges: CharRange[] | undefined;
  side: 'L' | 'R';
  wrap: boolean;
}) {
  if (!cell) {
    return <div className="min-w-0 border-l border-border bg-muted/20" />;
  }
  const { line } = cell;
  const num = side === 'L' ? line.oldLine : line.newLine;
  return (
    <div
      className={cn(
        'flex min-w-0',
        side === 'R' && 'border-l border-border',
        ROW_BG[line.type]
      )}
    >
      <span
        className={cn(
          'flex shrink-0 select-none text-muted-foreground/70',
          GUTTER_BG[line.type]
        )}
      >
        <span className="w-11 pr-2 text-right tabular-nums">{num ?? ''}</span>
        <span
          className={cn(
            'w-5 text-center',
            line.type === 'add' && 'text-success',
            line.type === 'remove' && 'text-destructive'
          )}
        >
          {SIGN[line.type]}
        </span>
      </span>
      <LineContent line={line} tokens={tokens} ranges={ranges} wrap={wrap} />
    </div>
  );
}

/** Highlighted content with optional word-diff emphasis ranges. */
function LineContent({
  line,
  tokens,
  ranges,
  wrap,
}: {
  line: DiffLine;
  tokens: LineTokens | undefined;
  ranges: CharRange[] | undefined;
  wrap: boolean;
}) {
  const text = line.content || ' ';
  const emphasis =
    line.type === 'add'
      ? 'bg-success/25 rounded-[2px]'
      : line.type === 'remove'
      ? 'bg-destructive/25 rounded-[2px]'
      : '';
  const cls = cn(
    'min-w-0 pr-6',
    wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
  );

  if (!tokens) {
    return <span className={cls}>{splitRanges(text, ranges, emphasis)}</span>;
  }
  // Walk tokens and split them at emphasis boundaries.
  let pos = 0;
  const out: React.ReactNode[] = [];
  tokens.forEach((tok, j) => {
    const start = pos;
    const end = pos + tok.content.length;
    pos = end;
    const parts = splitRanges(
      tok.content,
      shiftRanges(ranges, start, end),
      emphasis,
      j
    );
    out.push(
      <span key={j} style={{ color: tok.color }}>
        {parts}
      </span>
    );
  });
  return <span className={cls}>{out}</span>;
}

function shiftRanges(
  ranges: CharRange[] | undefined,
  start: number,
  end: number
): CharRange[] | undefined {
  if (!ranges) return undefined;
  const out: CharRange[] = [];
  for (const r of ranges) {
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    if (s < e) out.push({ start: s - start, end: e - start });
  }
  return out.length ? out : undefined;
}

function splitRanges(
  text: string,
  ranges: CharRange[] | undefined,
  emphasis: string,
  keyPrefix: number | string = ''
): React.ReactNode {
  if (!ranges || ranges.length === 0) return text;
  const out: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start > pos) out.push(text.slice(pos, r.start));
    out.push(
      <mark key={`${keyPrefix}-${i}`} className={cn('text-inherit', emphasis)}>
        {text.slice(r.start, r.end)}
      </mark>
    );
    pos = r.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function OrphanBlock({
  threads,
  prId,
  focusThreadId,
}: {
  threads: RemoteCommentThread[];
  prId: number;
  focusThreadId: string | null;
}) {
  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3 font-sans">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Comments on lines not in this diff
      </p>
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          prId={prId}
          showLocation
          focused={t.id === focusThreadId}
        />
      ))}
    </div>
  );
}

export type { UnifiedRow };
