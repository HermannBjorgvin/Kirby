import { describe, it, expect } from 'vitest';
import { placementForImage } from './placement.js';

// Heuristic cell sizing without pixel-size queries: assume ~10px per
// column and cells twice as tall as wide.
describe('placementForImage', () => {
  it('maps pixels to columns at ~10px/col', () => {
    expect(placementForImage(40, 20, 76)).toEqual({ cols: 4, rows: 1 });
  });

  it('caps columns at the available width', () => {
    // 800px wide -> 80 natural cols, capped to 76; rows keep aspect:
    // ceil((600/800) * 76 / 2) = 29 -> above the 24-row cap, so both
    // shrink: rows 24, cols floor(24 * 2 * 800/600) = 64
    expect(placementForImage(800, 600, 76)).toEqual({ cols: 64, rows: 24 });
  });

  it('caps very tall images at 24 rows and shrinks cols to keep aspect', () => {
    expect(placementForImage(100, 1000, 76)).toEqual({ cols: 4, rows: 24 });
  });

  it('never returns zero cells', () => {
    expect(placementForImage(1, 1, 76)).toEqual({ cols: 1, rows: 1 });
    expect(placementForImage(2000, 2, 10)).toEqual({ cols: 10, rows: 1 });
  });

  it('respects a small maxCols', () => {
    expect(placementForImage(400, 400, 20)).toEqual({ cols: 20, rows: 10 });
  });
});
