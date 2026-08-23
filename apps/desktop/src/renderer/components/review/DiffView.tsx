import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { DiffLine } from '@kirby/diff';
import type { RemoteCommentThread } from '../../../host/contract.js';
import { useHighlightedLines, type LineTokens } from '../../lib/highlight.js';
import { useTheme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';
import { ThreadCard } from './ThreadCard.js';

/**
 * One file's unified diff with a two-column line-number gutter,
 * syntax-highlighted content, and review threads interleaved right
 * after the line they anchor to (RIGHT side → new line numbers, LEFT
 * side → old). Threads whose anchor line isn't in the diff (outdated
 * or outside the hunks) are listed at the bottom of the file block.
 */
export const DiffView = memo(function DiffView({
  filename,
  lines,
  threads,
  prId,
}: {
  filename: string;
  lines: DiffLine[];
  threads: RemoteCommentThread[];
  prId: number;
}) {
  const [open, setOpen] = useState(true);
  const { resolved } = useTheme();
  const contents = useMemo(() => lines.map((l) => l.content), [lines]);
  const tokens = useHighlightedLines(filename, contents, resolved);

  const adds = lines.filter((l) => l.type === 'add').length;
  const dels = lines.filter((l) => l.type === 'remove').length;

  // Index threads by their anchor; track which get placed inline.
  const { inline, orphaned } = useMemo(() => {
    const inline = new Map<string, RemoteCommentThread[]>();
    const placed = new Set<string>();
    const present = new Set<string>();
    for (const l of lines) {
      if (l.newLine != null) present.add(`R${l.newLine}`);
      if (l.oldLine != null) present.add(`L${l.oldLine}`);
    }
    for (const t of threads) {
      if (t.lineStart == null) continue;
      const side = t.side === 'LEFT' ? 'L' : 'R';
      const anchor = `${side}${t.lineEnd ?? t.lineStart}`;
      if (present.has(anchor)) {
        const arr = inline.get(anchor) ?? [];
        arr.push(t);
        inline.set(anchor, arr);
        placed.add(t.id);
      }
    }
    const orphaned = threads.filter((t) => !placed.has(t.id));
    return { inline, orphaned };
  }, [lines, threads]);

  const openThreads = threads.filter((t) => !t.isResolved).length;

  return (
    <section data-file={filename} className="border-b border-border">
      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border bg-background/95 px-2 backdrop-blur">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-sm text-foreground">
            {filename}
          </span>
        </button>
        {openThreads > 0 && (
          <span className="rounded-full bg-warning/15 px-1.5 text-xs font-medium text-warning">
            {openThreads} open
          </span>
        )}
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-success">+{adds}</span>{' '}
          <span className="text-destructive">−{dels}</span>
        </span>
      </div>

      {open && (
        <div className="font-mono text-sm leading-5">
          {lines.map((line, i) => {
            const anchorR = line.newLine != null ? `R${line.newLine}` : null;
            const anchorL = line.oldLine != null ? `L${line.oldLine}` : null;
            const attached = [
              ...(anchorR ? inline.get(anchorR) ?? [] : []),
              ...(anchorL && line.type === 'remove'
                ? inline.get(anchorL) ?? []
                : []),
            ];
            return (
              <div key={i}>
                <Row line={line} tokens={tokens?.[i]} />
                {attached.length > 0 && (
                  <div className="space-y-2 border-y border-border bg-muted/30 py-2 pr-4 pl-[5.5rem] font-sans">
                    {attached.map((t) => (
                      <ThreadCard key={t.id} thread={t} prId={prId} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {orphaned.length > 0 && (
            <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3 font-sans">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Comments on lines not in this diff
              </p>
              {orphaned.map((t) => (
                <ThreadCard key={t.id} thread={t} prId={prId} showLocation />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
});

const ROW_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add',
  remove: 'bg-diff-del',
  context: '',
  'hunk-header': 'bg-diff-hunk text-diff-hunk-fg',
};
const GUTTER_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add-gutter',
  remove: 'bg-diff-del-gutter',
  context: '',
  'hunk-header': 'bg-diff-hunk',
};
const SIGN: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
  'hunk-header': '',
};

function Row({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: LineTokens | undefined;
}) {
  const isHunk = line.type === 'hunk-header';
  return (
    <div className={cn('flex min-w-max', ROW_BG[line.type])}>
      <span
        className={cn(
          'sticky left-0 flex shrink-0 select-none text-muted-foreground/70',
          GUTTER_BG[line.type] || 'bg-background'
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
      <span
        className={cn('whitespace-pre pr-6', isHunk && 'text-diff-hunk-fg')}
      >
        {!isHunk && tokens
          ? tokens.map((tok, j) => (
              <span key={j} style={{ color: tok.color }}>
                {tok.content}
              </span>
            ))
          : line.content || ' '}
      </span>
    </div>
  );
}
