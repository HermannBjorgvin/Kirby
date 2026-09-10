import { describe, it, expect } from 'vitest';
import { isMouseSequence } from './mouse-sequence.js';

describe('isMouseSequence', () => {
  it('matches a single click press (ESC stripped by Ink)', () => {
    expect(isMouseSequence('[<0;33;12M')).toBe(true);
  });

  it('matches a release', () => {
    expect(isMouseSequence('[<0;33;12m')).toBe(true);
  });

  it('matches a sequence with the leading ESC intact', () => {
    expect(isMouseSequence('\x1b[<0;33;12M')).toBe(true);
  });

  it('matches a batched chunk of several reports', () => {
    expect(isMouseSequence('[<65;1;1M\x1b[<65;1;1M\x1b[<0;2;2m')).toBe(true);
  });

  it('rejects ordinary text', () => {
    expect(isMouseSequence('hello')).toBe(false);
    expect(isMouseSequence('[')).toBe(false);
    expect(isMouseSequence('')).toBe(false);
  });

  it('rejects text that merely contains a mouse report', () => {
    expect(isMouseSequence('a[<0;1;1M')).toBe(false);
  });
});
