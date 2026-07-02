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
 * - every item is wrapped in a flexShrink={0} box FIXED to its span
 *   (height + overflow="hidden"), so an item whose real rendered
 *   height disagrees with its estimate clips (or gaps) within its own
 *   slot instead of shifting every item below it out of the geometry
 *   the scroll math believes in — a card usually loses its blank
 *   marginBottom row first, so a one-row miss is invisible
 * - the body is a fixed-height overflow="hidden" box as the outer
 *   guard against any remaining drift
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
        {visible.map(({ index, topClip }, i) => {
          const shifted = i === 0 && topClip > 0;
          return (
            <Box
              key={index}
              flexDirection="column"
              flexShrink={0}
              // Fix every fully-slotted item to its span so a
              // real-vs-estimate height miss clips (or gaps) inside
              // its own slot instead of shifting the items below it.
              // The negative-margin-shifted first item must NOT carry
              // its own overflow clip — Ink mispaints a clipping box
              // that hangs outside its parent's clip region — so it
              // relies on the parent body clip alone.
              {...(shifted
                ? { marginTop: -topClip }
                : { height: spans[index], overflow: 'hidden' as const })}
            >
              {renderItem(index)}
            </Box>
          );
        })}
      </Box>
      {clipped && (
        <Text dimColor>
          {rowsBelow > 0 ? `↓ ${rowsBelow} rows below` : ' '}
        </Text>
      )}
    </>
  );
}
