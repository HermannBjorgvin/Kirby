import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { contentKey } from './content-key.js';

/**
 * `contentKey` stands in for a patch in the parsed-diff query key, so
 * the viewer never shows a parse of one patch against the text of
 * another. Everything below is that one property: two patches share a
 * key only if they are the same patch.
 *
 * The interesting cases are the ones a cheaper key would get wrong —
 * an edit that leaves the length alone, or leaves the ends alone, is
 * exactly what a poll of a worktree an agent is editing produces.
 */
const patch = (body: string) =>
  [
    'diff --git a/f.ts b/f.ts',
    '--- a/f.ts',
    '+++ b/f.ts',
    '@@ -1,3 +1,3 @@',
    body,
  ].join('\n');

describe('contentKey', () => {
  it('is the same for content assembled two different ways', () => {
    const once = patch(' const a = 1;');
    const twice = patch(' const ' + 'a = ' + '1;');
    expect(contentKey(twice)).toBe(contentKey(once));
  });

  it('changes when a single character in the middle changes', () => {
    expect(contentKey(patch('-const a = 1;'))).not.toBe(
      contentKey(patch('-const a = 2;'))
    );
  });

  it('changes when the same lines are reordered', () => {
    const up = patch('+alpha\n+beta');
    const down = patch('+beta\n+alpha');
    expect(contentKey(down)).not.toBe(contentKey(up));
  });

  it('distinguishes an empty patch from a whitespace one', () => {
    expect(contentKey('')).not.toBe(contentKey(' '));
  });

  it('never gives two different patches the same key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(contentKey(a)).not.toBe(contentKey(b));
      }),
      { numRuns: 500 }
    );
  });
});
