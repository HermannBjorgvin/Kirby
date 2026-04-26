import { describe, it, expect } from 'vitest';
import { sanitizeBody } from './sanitize.js';

describe('sanitizeBody', () => {
  it('strips clear-screen + cursor-home', () => {
    expect(sanitizeBody('BEFORE\x1b[2J\x1b[HAFTER')).toBe('BEFOREAFTER');
  });

  it('strips SGR color/attribute sequences', () => {
    expect(sanitizeBody('\x1b[31mred\x1b[0m text')).toBe('red text');
  });

  it('strips the hide-attribute sequence', () => {
    expect(sanitizeBody('visible\x1b[8mhidden\x1b[0m')).toBe('visiblehidden');
  });

  it('strips OSC sequences terminated with BEL', () => {
    // \x1b]0;title\x07 — set window title
    expect(sanitizeBody('a\x1b]0;Title\x07b')).toBe('ab');
  });

  it('strips a 256-color SGR sequence', () => {
    expect(sanitizeBody('\x1b[38;5;202morange\x1b[0m')).toBe('orange');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizeBody('just a comment with no escapes')).toBe(
      'just a comment with no escapes'
    );
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeBody('')).toBe('');
  });

  it('is idempotent', () => {
    const once = sanitizeBody('\x1b[2Jhello');
    expect(sanitizeBody(once)).toBe(once);
  });
});
