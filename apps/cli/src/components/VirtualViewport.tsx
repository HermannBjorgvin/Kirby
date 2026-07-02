import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import {
  clampOffset,
  itemBounds,
  totalRows,
  viewportRowsForBudget,
} from '../utils/virtual-viewport.js';

/**
 * Row-granular viewport over variable-height items — the render half
 * of `utils/virtual-viewport.ts`, using the clipping recipe the diff
 * viewer proved out:
 *
 * - only items overlapping [offset, offset + viewport] are mounted
 * - the first (partially visible) item is shifted up with a negative
 *   marginTop so its already-scrolled rows land above the clip edge
 * - every item is wrapped in flexShrink={0} so Yoga can't squeeze it,
 *   and the body is a fixed-height overflow="hidden" box so any
 *   span-estimate miss clips cleanly instead of corrupting layout
 *
 * The component always occupies exactly `min(budgetRows, 2 + content)`
 * rows: while the content is clipped, the ↑/↓ indicator lines render
 * as placeholder rows even at the edges, so surrounding chrome (e.g.
 * a hints row below) never shifts while scrolling.
 */
export function VirtualViewport({
  spans,
  offset,
  budgetRows,
  renderItem,
}: {
  /** Estimated row height per item, in display order. */
  spans: number[];
  /** Top row of the viewport (clamped internally). */
  offset: number;
  /** Total rows available to this component, indicators included. */
  budgetRows: number;
  renderItem: (index: number) => ReactNode;
}) {
  const total = totalRows(spans);
  const clipped = total > budgetRows;
  const viewport = viewportRowsForBudget(total, budgetRows);
  const top = clampOffset(offset, total, viewport);
  const rowsAbove = top;
  const rowsBelow = Math.max(0, total - (top + viewport));

  const bounds = itemBounds(spans);
  const bottom = top + viewport;
  const visible: { index: number; topClip: number }[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]!;
    if (b.bottom <= top) continue;
    if (b.top >= bottom) break;
    visible.push({ index: i, topClip: Math.max(0, top - b.top) });
  }

  return (
    <>
      {clipped && (
        <Text dimColor>
          {rowsAbove > 0 ? `↑ ${rowsAbove} rows above` : ' '}
        </Text>
      )}
      <Box
        flexDirection="column"
        height={Math.min(viewport, total)}
        overflow="hidden"
        flexShrink={0}
      >
        {visible.map(({ index, topClip }, i) => (
          <Box
            key={index}
            flexShrink={0}
            {...(i === 0 && topClip > 0 ? { marginTop: -topClip } : {})}
          >
            {renderItem(index)}
          </Box>
        ))}
      </Box>
      {clipped && (
        <Text dimColor>
          {rowsBelow > 0 ? `↓ ${rowsBelow} rows below` : ' '}
        </Text>
      )}
    </>
  );
}
