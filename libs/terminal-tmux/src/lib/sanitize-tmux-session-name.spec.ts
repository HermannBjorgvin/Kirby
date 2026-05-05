import { describe, it, expect } from 'vitest';
import { sanitizeTmuxSessionName } from './sanitize-tmux-session-name.js';

describe('sanitizeTmuxSessionName', () => {
  it('passes through plain alphanumeric names unchanged', () => {
    expect(sanitizeTmuxSessionName('feature-foo-bar')).toBe('feature-foo-bar');
  });

  it('replaces dots with dashes', () => {
    expect(sanitizeTmuxSessionName('release-v1.0.1')).toBe('release-v1-0-1');
  });

  it('replaces colons with dashes', () => {
    expect(sanitizeTmuxSessionName('bug:fix:42')).toBe('bug-fix-42');
  });

  it('replaces a mix of forbidden characters', () => {
    expect(sanitizeTmuxSessionName('release/v1.0:rc1')).toBe(
      'release/v1-0-rc1'
    );
  });

  it('handles the empty string', () => {
    expect(sanitizeTmuxSessionName('')).toBe('');
  });

  it('preserves slashes and underscores (they are valid in tmux names)', () => {
    expect(sanitizeTmuxSessionName('a/b_c-d')).toBe('a/b_c-d');
  });

  describe('length cap', () => {
    it('does not modify names at or below the cap', () => {
      const exact = 'x'.repeat(200);
      expect(sanitizeTmuxSessionName(exact)).toBe(exact);
      expect(sanitizeTmuxSessionName(exact)).toHaveLength(200);
    });

    it('truncates names over 200 characters and appends a stable hash', () => {
      const long = 'x'.repeat(250);
      const result = sanitizeTmuxSessionName(long);
      expect(result.length).toBe(200);
      // Result is deterministic for the same input.
      expect(sanitizeTmuxSessionName(long)).toBe(result);
    });

    it('produces different hashes for two long names sharing a prefix', () => {
      const a = 'kirby-' + 'a'.repeat(250);
      const b = 'kirby-' + 'a'.repeat(249) + 'b';
      // Both truncate to the same head but the trailing hashes differ.
      const sa = sanitizeTmuxSessionName(a);
      const sb = sanitizeTmuxSessionName(b);
      expect(sa).not.toBe(sb);
      expect(sa.length).toBe(200);
      expect(sb.length).toBe(200);
    });

    it('hashes the original (pre-replacement) input', () => {
      // Two inputs that differ only in their forbidden chars produce
      // different sanitized results — they must hash distinctly.
      const a = 'kirby-' + 'x'.repeat(250) + '.suffix';
      const b = 'kirby-' + 'x'.repeat(250) + ':suffix';
      const sa = sanitizeTmuxSessionName(a);
      const sb = sanitizeTmuxSessionName(b);
      expect(sa).not.toBe(sb);
    });
  });
});
