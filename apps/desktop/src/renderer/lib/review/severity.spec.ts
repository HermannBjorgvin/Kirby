import { describe, expect, it } from 'vitest';
import { conventionalBadge, SEVERITY_BADGE } from './severity.js';

/**
 * A Conventional Comments header and an agent's severity are the same
 * claim in two vocabularies — how much this remark binds — so they have
 * to look the same on screen. Giving them different colours would
 * invent a distinction the reader then has to learn.
 */
describe('conventionalBadge', () => {
  it('paints a blocking issue the way a critical draft is painted', () => {
    expect(
      conventionalBadge({ label: 'issue', decorations: ['blocking'] })
    ).toBe(SEVERITY_BADGE.critical);
  });

  it('paints a plain issue as a major finding', () => {
    expect(conventionalBadge({ label: 'issue', decorations: [] })).toBe(
      SEVERITY_BADGE.major
    );
  });

  it('paints a suggestion as a minor one', () => {
    expect(conventionalBadge({ label: 'suggestion', decorations: [] })).toBe(
      SEVERITY_BADGE.minor
    );
  });

  it('paints the quiet labels the way a nit is painted', () => {
    for (const label of ['nitpick', 'praise', 'note', 'thought'] as const) {
      expect(conventionalBadge({ label, decorations: [] })).toBe(
        SEVERITY_BADGE.nit
      );
    }
  });

  /** Saying a remark does not block is not the same as retracting it. */
  it('does not let non-blocking quieten a label', () => {
    expect(
      conventionalBadge({ label: 'issue', decorations: ['non-blocking'] })
    ).toBe(SEVERITY_BADGE.major);
  });
});
