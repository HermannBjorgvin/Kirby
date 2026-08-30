import { describe, it, expect } from 'vitest';
import {
  SGR_SCROLL_DOWN,
  SGR_SCROLL_UP,
  sgrMouseMatcher,
} from './sgr-mouse.js';

describe('sgrMouseMatcher', () => {
  it('reads button, column, row and press/release from a report', () => {
    const m = sgrMouseMatcher().exec('\x1b[<64;12;34M');
    expect(m?.slice(1)).toEqual(['64', '12', '34', 'M']);
  });

  it('matches a release as well as a press', () => {
    expect(sgrMouseMatcher().exec('\x1b[<0;1;1m')?.[4]).toBe('m');
  });

  it('finds every report in a chunk that carries several', () => {
    const chunk = `\x1b[<${SGR_SCROLL_UP};1;1M\x1b[<${SGR_SCROLL_DOWN};2;2M`;
    const buttons = [...chunk.matchAll(sgrMouseMatcher())].map((m) => m[1]);
    expect(buttons).toEqual([String(SGR_SCROLL_UP), String(SGR_SCROLL_DOWN)]);
  });

  // The reason this is a factory rather than a module-level constant: a
  // global regex keeps `lastIndex` between calls, so a shared one would
  // resume mid-string and miss the first event of the next chunk. Two
  // calls must behave identically.
  it('starts from the beginning on every call', () => {
    const chunk = '\x1b[<64;1;1M';
    expect(sgrMouseMatcher().exec(chunk)?.index).toBe(0);
    expect(sgrMouseMatcher().exec(chunk)?.index).toBe(0);
  });

  it('ignores text that is not a mouse report', () => {
    expect(sgrMouseMatcher().exec('\x1b[2J plain text')).toBeNull();
  });
});
