import { describe, expect, it } from 'vitest';
import { stepChoice } from './choice-keys.js';

describe('stepChoice', () => {
  it('moves down and up one at a time, wrapping at both ends', () => {
    expect(stepChoice('ArrowDown', 0, 3)).toBe(1);
    expect(stepChoice('ArrowDown', 2, 3)).toBe(0);
    expect(stepChoice('ArrowUp', 1, 3)).toBe(0);
    expect(stepChoice('ArrowUp', 0, 3)).toBe(2);
  });

  it('enters the list from the end the arrow points away from', () => {
    expect(stepChoice('ArrowDown', -1, 3)).toBe(0);
    expect(stepChoice('ArrowUp', -1, 3)).toBe(2);
  });

  it('jumps to either end', () => {
    expect(stepChoice('Home', 2, 3)).toBe(0);
    expect(stepChoice('End', 0, 3)).toBe(2);
  });

  it('is not movement for any other key, or with nothing to move over', () => {
    expect(stepChoice('Enter', 0, 3)).toBeNull();
    expect(stepChoice('Tab', 0, 3)).toBeNull();
    expect(stepChoice('ArrowDown', 0, 0)).toBeNull();
  });
});
