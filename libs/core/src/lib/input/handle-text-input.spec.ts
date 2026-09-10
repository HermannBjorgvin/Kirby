import { describe, it, expect, vi } from 'vitest';
import type { KeyPress } from './key-press.js';
import { handleTextInput } from './handle-text-input.js';

const key = (overrides: Partial<KeyPress> = {}): KeyPress => ({
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
  ...overrides,
});

function run(input: string, k: KeyPress = key()) {
  let value = 'abc';
  const setter = vi.fn((fn: (prev: string) => string) => {
    value = fn(value);
  });
  const handled = handleTextInput(input, k, setter);
  return { handled, value };
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

  it('ignores ctrl / meta chords', () => {
    expect(run('c', key({ ctrl: true })).handled).toBe(false);
    expect(run('v', key({ meta: true })).handled).toBe(false);
  });

  // Mouse tracking is on for wheel/click support, so Ink delivers SGR
  // reports to useInput as printable input like "[<0;33;12M" (leading
  // ESC stripped). They must never land in a compose buffer.
  describe('SGR mouse noise', () => {
    it.each([
      ['click press', '[<0;33;12M'],
      ['click release', '[<0;33;12m'],
      ['leading ESC intact', '\x1b[<0;33;12M'],
      ['batched chunk', '[<65;1;1M\x1b[<65;1;1M\x1b[<0;2;2m'],
      ['drag / motion', '[<32;4;5M'],
    ])('drops a %s sequence', (_label, seq) => {
      const r = run(seq);
      expect(r.handled).toBe(false);
      expect(r.value).toBe('abc');
    });

    it('still appends a bare bracket', () => {
      const r = run('[');
      expect(r.handled).toBe(true);
      expect(r.value).toBe('abc[');
    });
  });
});
