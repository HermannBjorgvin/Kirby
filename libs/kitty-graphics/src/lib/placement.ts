import type { PlacementSize } from './kitty-graphics.js';

// Cell-size heuristics. Kirby never queries the terminal's pixel cell
// size; ~10px per column and 2:1 cell height:width is close enough for
// sizing screenshots, and the terminal scales the image to the
// placement rectangle regardless.
const PX_PER_COL = 10;
const CELL_HEIGHT_RATIO = 2;
const MAX_ROWS = 24;

/**
 * Choose a placement rectangle (in cells) for an image of the given
 * pixel size, constrained to `maxCols` columns and MAX_ROWS rows,
 * preserving aspect ratio.
 */
export function placementForImage(
  pxWidth: number,
  pxHeight: number,
  maxCols: number
): PlacementSize {
  const naturalCols = Math.ceil(pxWidth / PX_PER_COL);
  let cols = Math.max(1, Math.min(maxCols, naturalCols));
  let rows = Math.max(
    1,
    Math.ceil(((pxHeight / pxWidth) * cols) / CELL_HEIGHT_RATIO)
  );
  if (rows > MAX_ROWS) {
    rows = MAX_ROWS;
    cols = Math.max(
      1,
      Math.min(
        cols,
        Math.floor((rows * CELL_HEIGHT_RATIO * pxWidth) / pxHeight)
      )
    );
  }
  return { rows, cols };
}
