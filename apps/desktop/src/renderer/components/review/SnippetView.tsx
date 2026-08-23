import type { DiffLine } from '@kirby/diff';
import { useHighlightedLines } from '../../lib/highlight.js';
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

/**
 * A compact, read-only code snippet for the review walkthrough: a few
 * diff lines with a two-column gutter and shiki highlighting, with the
 * anchored line(s) marked.
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

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card font-mono text-sm leading-5">
      {rows.map(({ line, anchored }, i) => (
        <div
          key={i}
          className={cn(
            'flex min-w-max',
            ROW_BG[line.type],
            anchored && 'ring-1 ring-inset ring-primary/40'
          )}
        >
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
            {tokens?.[i]
              ? tokens[i].map((tok, j) => (
                  <span key={j} style={{ color: tok.color }}>
                    {tok.content}
                  </span>
                ))
              : line.content || ' '}
          </span>
        </div>
      ))}
    </div>
  );
}
