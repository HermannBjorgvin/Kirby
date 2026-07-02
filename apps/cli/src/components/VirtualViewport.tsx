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
 * - every fully-visible item is wrapped in a flexShrink={0} box FIXED
 *   to its span (height + overflow="hidden"), so an item whose real
 *   rendered height disagrees with its estimate clips (or gaps)
 *   within its own slot instead of shifting every item below it out
 *   of the geometry the scroll math believes in — a card usually
 *   loses its blank marginBottom row first, so a one-row miss is
 *   invisible. Items partially visible at either viewport edge get NO
 *   slot clip: Ink honours only the innermost clip, so a slot poking
 *   past the body box would let content escape the viewport entirely
 * - the body is a fixed-height overflow="hidden" box that clips the
 *   boundary items and guards against any remaining drift
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
          // Ink honours only the INNERMOST overflow clip — Output.get
          // consults clips.at(-1), never intersecting with ancestor
          // clips — so an item whose slot pokes past the body box
          // would clip to its OWN bounds and paint straight through
          // the viewport edge (over the ↓-indicator/hints below, or
          // the chrome above for the shifted first item). Give an
          // item its own span-fixed clip only when its slot lies
          // fully inside the viewport (containment makes
          // innermost-only equivalent to intersection); boundary
          // items rely on the parent body clip alone.
          const fullyInside =
            !shifted && (bounds[index]?.bottom ?? Infinity) <= bottom;
          return (
            <Box
              key={index}
              flexDirection="column"
              flexShrink={0}
              // Span-fixed slots make a real-vs-estimate height miss
              // clip (or gap) inside the item's own slot instead of
              // shifting the items below it out of the geometry.
              {...(shifted ? { marginTop: -topClip } : {})}
              {...(fullyInside
                ? { height: spans[index], overflow: 'hidden' as const }
                : {})}
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
