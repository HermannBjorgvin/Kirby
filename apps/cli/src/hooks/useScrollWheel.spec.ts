import { describe, it, expect } from 'vitest';
import { parseWheelTicks } from './useScrollWheel.js';

// SGR wheel events: \x1b[<64;x;yM = wheel up, \x1b[<65;x;yM = wheel down.
// Terminals batch rapid wheel spins into a single stdin chunk, so the
// parser must consume every event in the chunk, not just the first.
describe('parseWheelTicks', () => {
  it('returns +1 for a single wheel-down event', () => {
    expect(parseWheelTicks('\x1b[<65;10;5M')).toBe(1);
  });

  it('returns -1 for a single wheel-up event', () => {
    expect(parseWheelTicks('\x1b[<64;10;5M')).toBe(-1);
  });

  it('accumulates every event in a batched chunk', () => {
    expect(parseWheelTicks('\x1b[<65;10;5M\x1b[<65;10;5M\x1b[<65;12;6M')).toBe(
      3
    );
  });

  it('nets opposing events in one chunk', () => {
    expect(parseWheelTicks('\x1b[<64;1;1M\x1b[<65;1;1M')).toBe(0);
  });

  it('ignores click press/release events', () => {
    expect(parseWheelTicks('\x1b[<0;3;4M\x1b[<0;3;4m')).toBe(0);
  });

  it('ignores drag/motion events', () => {
    expect(parseWheelTicks('\x1b[<32;4;5M')).toBe(0);
  });

  it('counts wheel events mixed with clicks', () => {
    expect(parseWheelTicks('\x1b[<0;1;1M\x1b[<65;1;1M\x1b[<0;1;1m')).toBe(1);
  });

  it('returns 0 for plain keyboard input', () => {
    expect(parseWheelTicks('jjk')).toBe(0);
  });

  it('returns 0 for an empty chunk', () => {
    expect(parseWheelTicks('')).toBe(0);
  });
});

describe('parseWheelTicks with a column region', () => {
  // SGR events carry the pointer column; region filtering routes the
  // sidebar (x <= 48) separately from the main pane (x > 48).
  it('counts events inside xMax', () => {
    expect(parseWheelTicks('\x1b[<65;10;5M', { xMax: 48 })).toBe(1);
  });

  it('ignores events beyond xMax', () => {
    expect(parseWheelTicks('\x1b[<65;60;5M', { xMax: 48 })).toBe(0);
  });

  it('counts events at or above xMin', () => {
    expect(parseWheelTicks('\x1b[<65;60;5M', { xMin: 49 })).toBe(1);
    expect(parseWheelTicks('\x1b[<64;49;5M', { xMin: 49 })).toBe(-1);
  });

  it('ignores events below xMin', () => {
    expect(parseWheelTicks('\x1b[<65;10;5M', { xMin: 49 })).toBe(0);
  });

  it('filters a mixed chunk per region', () => {
    const chunk = '\x1b[<65;10;5M\x1b[<65;60;5M\x1b[<65;61;6M';
    expect(parseWheelTicks(chunk, { xMax: 48 })).toBe(1);
    expect(parseWheelTicks(chunk, { xMin: 49 })).toBe(2);
    expect(parseWheelTicks(chunk)).toBe(3);
  });
});
