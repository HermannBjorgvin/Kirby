import { memo } from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';
import type { DiffLine } from '@kirby/diff';

// Per-row diff renderer. Replaces the older ANSI-string pipeline in
// `libs/diff/src/lib/diff-renderer.ts`: the gutter, prefix, and content
// are all Ink primitives now, and syntax highlighting runs through
// `cli-highlight` when a language is known.
//
// Selected-comment highlight (the yellow background on referenced
// lines) used to be an ANSI splice in `interleaveComments`; now it's
// a prop on the Box. Clean and no more splice-boundary bugs.

const CONTENT_CACHE = new Map<string, string>();

function highlightContent(
  content: string,
  language: string | undefined
): string {
  if (!language || content.length === 0) return content;
  const key = `${language}:${content}`;
  const cached = CONTENT_CACHE.get(key);
  if (cached !== undefined) return cached;
  try {
    const result = highlight(content, { language, ignoreIllegals: true });
    // Unbounded caches leak. 2000 entries ≈ most real-world files.
    if (CONTENT_CACHE.size > 2000) {
      const firstKey = CONTENT_CACHE.keys().next().value;
      if (firstKey !== undefined) CONTENT_CACHE.delete(firstKey);
    }
    CONTENT_CACHE.set(key, result);
    return result;
  } catch {
    return content;
  }
}

function formatGutter(line: DiffLine): string {
  const old = line.oldLine != null ? String(line.oldLine).padStart(4) : '    ';
  const nw = line.newLine != null ? String(line.newLine).padStart(4) : '    ';
  return `${old}:${nw}`;
}

export interface DiffRowProps {
  line: DiffLine;
  highlighted: boolean;
  language: string | undefined;
  paneCols: number;
}

export const DiffRow = memo(function DiffRow({
  line,
  highlighted,
  language,
  paneCols,
}: DiffRowProps) {
  if (line.type === 'hunk-header') {
    return (
      <Text color="cyan" wrap="truncate">
        {line.content}
      </Text>
    );
  }

  const gutter = formatGutter(line);
  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
  const prefixColor =
    line.type === 'add' ? 'green' : line.type === 'remove' ? 'red' : undefined;

  // Budget: gutter(9) + space + prefix(1) + content. Truncate content to
  // fit in `paneCols`. We measure in visible chars because cli-highlight
  // emits ANSI colors that don't occupy columns.
  const contentBudget = Math.max(1, paneCols - gutter.length - 3);
  const trimmed =
    line.content.length > contentBudget
      ? line.content.slice(0, contentBudget - 1) + '…'
      : line.content;
  const highlightedContent = highlightContent(trimmed, language);

  // `highlighted` (selected-comment reference) used to be a yellow ANSI
  // splice. Now it's just a bolder gutter — avoids ANSI bg conflicts
  // with the syntax-highlighted content, and the highlighting is still
  // visible at a glance.
  return (
    <Box>
      <Text
        color={highlighted ? 'yellow' : undefined}
        dimColor={!highlighted}
        bold={highlighted}
      >
        {gutter}
      </Text>
      <Text color={prefixColor}> {prefix}</Text>
      <Text wrap="truncate">{highlightedContent}</Text>
    </Box>
  );
});
