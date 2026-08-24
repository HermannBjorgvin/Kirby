/**
 * Estimate a terminal's column/row grid from its pane in pixels. Char
 * metrics mirror the `.wterm` styles in styles.css (13px mono ≈ 7.8px
 * wide, 18px rows, 8/12px padding). Used to size the PTY at launch and
 * to fit the rendered terminal to its pane.
 */
const CHAR_WIDTH = 7.8;
const ROW_HEIGHT = 18;
const PAD_X = 24;
const PAD_Y = 16;

export interface Grid {
  cols: number;
  rows: number;
}

export function estimateTerminalGrid(
  rect: { width: number; height: number },
  /** Fraction of the width the terminal will occupy (e.g. 0.6 in a
   *  split layout where the diff takes the rest). */
  widthFraction = 1
): Grid {
  const cols = Math.max(
    20,
    Math.floor((rect.width * widthFraction - PAD_X) / CHAR_WIDTH)
  );
  const rows = Math.max(5, Math.floor((rect.height - PAD_Y) / ROW_HEIGHT));
  return { cols, rows };
}
