import { describe, expect, it } from 'vitest';
import type { RemoteCommentThread } from '../../../host/contract.js';
import {
  composerRefreshNotice,
  firstNonEmptyLine,
  threadExpanded,
  threadLocation,
  totalCommentCount,
} from './thread-model.js';

function thread(id: string, bodies: string[]): RemoteCommentThread {
  return {
    id,
    file: 'a.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: bodies.map((body, i) => ({
      id: `${id}-${i}`,
      author: 'alice',
      body,
      createdAt: '2026-01-01T00:00:00Z',
    })),
  };
}

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

describe('composerRefreshNotice', () => {
  it('reports the refetch while it is in flight', () => {
    expect(
      composerRefreshNotice({ checking: true, baseline: 2, current: 2 })
    ).toEqual({ kind: 'checking', text: 'Checking for new comments…' });
  });

  /** The in-flight state wins: mid-refetch the count is whatever the
   *  cache still holds, so counting against it would announce an
   *  arrival that has not been read back yet. */
  it('says it is checking even once the count has grown', () => {
    expect(
      composerRefreshNotice({ checking: true, baseline: 2, current: 3 })
    ).toEqual({ kind: 'checking', text: 'Checking for new comments…' });
  });

  it('names how many comments landed while the composer opened', () => {
    expect(
      composerRefreshNotice({ checking: false, baseline: 2, current: 3 })
    ).toEqual({
      kind: 'arrived',
      text: '1 new comment arrived — read it before replying.',
    });
    expect(
      composerRefreshNotice({ checking: false, baseline: 2, current: 5 })
    ).toEqual({
      kind: 'arrived',
      text: '3 new comments arrived — read them before replying.',
    });
  });

  it('says nothing when the thread is unchanged', () => {
    expect(
      composerRefreshNotice({ checking: false, baseline: 2, current: 2 })
    ).toBeNull();
  });

  /** A comment deleted upstream is not news the replier has to act on,
   *  and "-1 new comments" would be worse than saying nothing. */
  it('says nothing when the thread shrank', () => {
    expect(
      composerRefreshNotice({ checking: false, baseline: 4, current: 2 })
    ).toBeNull();
  });

  it('says nothing before a composer has opened', () => {
    expect(
      composerRefreshNotice({ checking: false, baseline: null, current: 9 })
    ).toBeNull();
  });
});

describe('totalCommentCount', () => {
  /** Replies count, not just roots: a thread that grew by an answer is
   *  exactly the arrival the composer has to announce. */
  it('counts every comment in every thread and general comment', () => {
    expect(
      totalCommentCount({
        threads: [thread('t1', ['a', 'b']), thread('t2', ['c'])],
        generalComments: [thread('g1', ['d'])],
      })
    ).toBe(4);
  });

  it('is zero before the query has answered', () => {
    expect(totalCommentCount(undefined)).toBe(0);
    expect(totalCommentCount({ threads: [], generalComments: [] })).toBe(0);
  });
});
