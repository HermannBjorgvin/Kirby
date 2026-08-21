import { describe, it, expect, vi } from 'vitest';
import type { Key } from 'ink';
import { handleTextInput } from './handle-text-input.js';

const key = (overrides: Partial<Key> = {}): Key =>
  ({
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  } as Key);

function run(input: string, k: Key = key()) {
  let value = 'abc';
  const setter = vi.fn((fn: (prev: string) => string) => {
    value = fn(value);
  });
  const handled = handleTextInput(input, k, setter);
  return { handled, value, setter };
}

describe('handleTextInput', () => {
  it('appends printable input', () => {
    const r = run('x');
    expect(r.handled).toBe(true);
    expect(r.value).toBe('abcx');
  });

  it('backspace deletes the last char', () => {
    const r = run('', key({ backspace: true }));
    expect(r.handled).toBe(true);
    expect(r.value).toBe('ab');
  });

  // When SGR mouse tracking is on (diff viewer wheel scrolling), Ink
  // delivers mouse clicks to useInput as garbage printable input like
  // "[<0;33;12M" (leading ESC stripped). Those bytes must never land
  // in a compose buffer.
  describe('SGR mouse noise', () => {
    it('ignores a click press sequence', () => {
      const r = run('[<0;33;12M');
      expect(r.handled).toBe(false);
      expect(r.value).toBe('abc');
    });

    it('ignores a click release sequence', () => {
      const r = run('[<0;33;12m');
      expect(r.handled).toBe(false);
      expect(r.value).toBe('abc');
    });

    it('ignores a sequence with the leading ESC intact', () => {
      const r = run('\x1b[<0;33;12M');
      expect(r.handled).toBe(false);
      expect(r.value).toBe('abc');
    });

    it('ignores a batched chunk of mouse events', () => {
      const r = run('[<65;1;1M\x1b[<65;1;1M\x1b[<0;2;2m');
      expect(r.handled).toBe(false);
      expect(r.value).toBe('abc');
    });

    it('ignores drag/motion sequences', () => {
      const r = run('[<32;4;5M');
      expect(r.handled).toBe(false);
      expect(r.value).toBe('abc');
    });

    it('still appends bracket-y text that is not a mouse sequence', () => {
      const r = run('[');
      expect(r.handled).toBe(true);
      expect(r.value).toBe('abc[');
    });
  });
});
