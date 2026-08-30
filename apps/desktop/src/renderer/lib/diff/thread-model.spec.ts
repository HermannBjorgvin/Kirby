import { describe, expect, it } from 'vitest';
import {
  firstNonEmptyLine,
  threadExpanded,
  threadLocation,
} from './thread-model.js';

describe('threadExpanded', () => {
  it('opens an unresolved thread and collapses a resolved one', () => {
    expect(threadExpanded(null, false, false)).toBe(true);
    expect(threadExpanded(null, false, true)).toBe(false);
  });

  it('opens a resolved thread that the navigator jumped to', () => {
    expect(threadExpanded(null, true, true)).toBe(true);
  });

  /** `false` is an answer, not an absent one: a card the reader
   *  collapsed by hand stays collapsed even though it is unresolved. */
  it('lets a hand-collapsed card stay collapsed', () => {
    expect(threadExpanded(false, false, false)).toBe(false);
    expect(threadExpanded(false, true, false)).toBe(false);
    expect(threadExpanded(false, true, true)).toBe(false);
  });

  it('lets a hand-opened card stay open', () => {
    expect(threadExpanded(true, false, true)).toBe(true);
  });
});

describe('threadLocation', () => {
  /** The card has the width for a path; the comment list does not, and
   *  shows the basename instead. These two must not converge. */
  it('shows the whole path, not the basename', () => {
    expect(threadLocation({ file: 'src/deep/a.ts', lineStart: 12 })).toBe(
      'src/deep/a.ts:12'
    );
  });

  it('drops the suffix when the thread has no line', () => {
    expect(threadLocation({ file: 'src/a.ts', lineStart: null })).toBe(
      'src/a.ts'
    );
  });

  /** Null, not an empty string: the caller renders the location only
   *  when there is one, and '' would render an empty slot. */
  it('has no location for a general comment', () => {
    expect(threadLocation({ file: null, lineStart: null })).toBeNull();
    expect(threadLocation({ file: null, lineStart: 4 })).toBeNull();
  });

  it('keeps line zero rather than treating it as absent', () => {
    expect(threadLocation({ file: 'src/a.ts', lineStart: 0 })).toBe(
      'src/a.ts:0'
    );
  });
});

describe('firstNonEmptyLine', () => {
  it('skips lines that are blank or only whitespace', () => {
    expect(firstNonEmptyLine('\n   \n\t\nreal content\nmore')).toBe(
      'real content'
    );
  });

  it('keeps the line exactly as written, indentation included', () => {
    expect(firstNonEmptyLine('\n    indented')).toBe('    indented');
  });

  it('is empty when the body has nothing in it', () => {
    expect(firstNonEmptyLine('')).toBe('');
    expect(firstNonEmptyLine('\n \n\t')).toBe('');
  });
});
