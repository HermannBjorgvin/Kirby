import type { ReactNode } from 'react';
import type { DiffLine } from '@kirby/diff';
import { useHighlightedLines, type LineTokens } from '../../lib/highlight.js';
import { useTheme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';

const ROW_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add',
  remove: 'bg-diff-del',
  context: '',
  'hunk-header': 'bg-diff-hunk',
};
const SIGN: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
  'hunk-header': '',
};

function SnippetRow({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: LineTokens | undefined;
}) {
  return (
    <div className={cn('flex min-w-max', ROW_BG[line.type])}>
      <span className="flex shrink-0 select-none bg-background/40 text-muted-foreground/70">
        <span className="w-10 pr-2 text-right tabular-nums">
          {line.oldLine ?? ''}
        </span>
        <span className="w-10 pr-2 text-right tabular-nums">
          {line.newLine ?? ''}
        </span>
        <span
          className={cn(
            'w-4 text-center',
            line.type === 'add' && 'text-success',
            line.type === 'remove' && 'text-destructive'
          )}
        >
          {SIGN[line.type]}
        </span>
      </span>
      <span className="whitespace-pre pr-4">
        {tokens
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

/**
 * A compact, read-only code snippet for the review walkthrough: a few
 * diff lines with a two-column gutter and shiki highlighting. The rows
 * the comment anchors to are wrapped in a single outline (a highlighted
 * block) rather than each row being individually boxed.
 */
export function SnippetView({
  filename,
  rows,
}: {
  filename: string;
  rows: { line: DiffLine; anchored: boolean }[];
}) {
  const { resolved } = useTheme();
  const tokens = useHighlightedLines(
    filename,
    rows.map((r) => r.line.content),
    resolved
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        This comment's lines aren't in the current diff (outdated or outside the
        changed hunks).
      </div>
    );
  }

  // The anchored rows are contiguous; a single wrapping border around
  // that run reads as "this is the commented block".
  const firstAnchored = rows.findIndex((r) => r.anchored);
  const lastAnchored = rows.reduce((acc, r, i) => (r.anchored ? i : acc), -1);

  const out: ReactNode[] = [];
  let i = 0;
  while (i < rows.length) {
    if (firstAnchored >= 0 && i === firstAnchored) {
      out.push(
        <div
          key="anchored-block"
          className="border-y border-primary/40 bg-primary/5"
        >
          {rows.slice(firstAnchored, lastAnchored + 1).map(({ line }, k) => (
            <SnippetRow
              key={firstAnchored + k}
              line={line}
              tokens={tokens?.[firstAnchored + k]}
            />
          ))}
        </div>
      );
      i = lastAnchored + 1;
    } else {
      out.push(<SnippetRow key={i} line={rows[i].line} tokens={tokens?.[i]} />);
      i += 1;
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card font-mono text-sm leading-5">
      {out}
    </div>
  );
}
