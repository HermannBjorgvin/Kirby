import { describe, it, expect } from 'vitest';
import { computeSpanScrollWindow } from './scroll-window.js';

describe('computeSpanScrollWindow', () => {
  it('returns the full range when everything fits the budget', () => {
    const w = computeSpanScrollWindow({
      spans: [5, 5, 5],
      selectedIndex: 0,
      budgetRows: 15,
    });
    expect(w).toEqual({ start: 0, end: 3, aboveCount: 0, belowCount: 0 });
  });

  it('handles an empty span list', () => {
    const w = computeSpanScrollWindow({
      spans: [],
      selectedIndex: 0,
      budgetRows: 10,
    });
    expect(w).toEqual({ start: 0, end: 0, aboveCount: 0, belowCount: 0 });
  });

  it('windows around the selected item when clipped', () => {
    // 5 cards of 5 rows, budget 12 → 2 reserved for indicators,
    // 10 usable → selected + one neighbour fit.
    const w = computeSpanScrollWindow({
      spans: [5, 5, 5, 5, 5],
      selectedIndex: 2,
      budgetRows: 12,
    });
    expect(w.start).toBeLessThanOrEqual(2);
    expect(w.end).toBeGreaterThan(2);
    expect(w.end - w.start).toBe(2);
    expect(w.aboveCount + w.belowCount).toBe(3);
  });

  it('keeps the last item visible when it is selected', () => {
    const w = computeSpanScrollWindow({
      spans: [5, 5, 5, 5],
      selectedIndex: 3,
      budgetRows: 12,
    });
    expect(w.end).toBe(4);
    expect(w.belowCount).toBe(0);
    expect(w.aboveCount).toBeGreaterThan(0);
  });

  it('clamps an out-of-range selected index', () => {
    const w = computeSpanScrollWindow({
      spans: [5, 5, 5],
      selectedIndex: 99,
      budgetRows: 7,
    });
    expect(w.end).toBe(3);
  });

  it('still includes a single item taller than the budget', () => {
    const w = computeSpanScrollWindow({
      spans: [3, 20, 3],
      selectedIndex: 1,
      budgetRows: 10,
    });
    expect(w.start).toBe(1);
    expect(w.end).toBe(2);
  });
});
