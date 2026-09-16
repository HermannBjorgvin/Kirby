import { describe, expect, it } from 'vitest';
import { commentAnchor, describeAnchor } from './comment-anchor.js';

/**
 * The three shapes a draft comes in, read off the same nullable fields
 * a remote thread uses. Every surface that decides "where does this
 * go" goes through these two, so the rules are pinned once.
 */
describe('commentAnchor', () => {
  it('is a line anchor when file and both lines are set', () => {
    expect(commentAnchor({ file: 'src/a.ts', lineStart: 3, lineEnd: 5 })).toBe(
      'line'
    );
  });

  it('is a file anchor when the lines are null', () => {
    expect(
      commentAnchor({ file: 'src/a.ts', lineStart: null, lineEnd: null })
    ).toBe('file');
  });

  it('is a pull-request anchor when there is no file', () => {
    expect(commentAnchor({ file: null, lineStart: null, lineEnd: null })).toBe(
      'pr'
    );
  });
});

describe('describeAnchor', () => {
  it('names a single line, a range, a file, or the conversation', () => {
    expect(describeAnchor({ file: 'src/a.ts', lineStart: 3, lineEnd: 3 })).toBe(
      'src/a.ts:3'
    );
    expect(describeAnchor({ file: 'src/a.ts', lineStart: 3, lineEnd: 5 })).toBe(
      'src/a.ts:3-5'
    );
    expect(
      describeAnchor({ file: 'src/a.ts', lineStart: null, lineEnd: null })
    ).toBe('src/a.ts');
    expect(describeAnchor({ file: null, lineStart: null, lineEnd: null })).toBe(
      'Conversation'
    );
  });
});
