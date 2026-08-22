import { describe, it, expect } from 'vitest';
import { computeScrollWindow } from './scroll-window.js';

describe('computeScrollWindow', () => {
  it('returns the full range when everything fits', () => {
    const w = computeScrollWindow({
      totalItems: 5,
      selectedIndex: 2,
      maxVisible: 10,
    });
    expect(w).toEqual({
      windowStart: 0,
      windowEnd: 10,
      aboveCount: 0,
      belowCount: 0,
    });
  });

  it('centers the selection when clipped', () => {
    const w = computeScrollWindow({
      totalItems: 20,
      selectedIndex: 10,
      maxVisible: 6,
    });
    expect(w.windowStart).toBe(7);
    expect(w.aboveCount).toBe(7);
    expect(w.belowCount).toBe(7);
  });

  it('clamps at the ends', () => {
    const top = computeScrollWindow({
      totalItems: 20,
      selectedIndex: 0,
      maxVisible: 6,
    });
    expect(top.windowStart).toBe(0);
    const bottom = computeScrollWindow({
      totalItems: 20,
      selectedIndex: 19,
      maxVisible: 6,
    });
    expect(bottom.windowStart).toBe(14);
    expect(bottom.belowCount).toBe(0);
  });
});
