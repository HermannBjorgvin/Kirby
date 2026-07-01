import { describe, it, expect } from 'vitest';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { ReviewComment } from '@kirby/review-comments';
import { planItemKey, snapshotLocal, snapshotRemote } from './plan-types.js';

function thread(over: Partial<RemoteCommentThread> = {}): RemoteCommentThread {
  return {
    id: 't1',
    file: 'a.ts',
    lineStart: 10,
    lineEnd: 10,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      { id: 'c1', author: 'alice', body: 'root', createdAt: '2026-01-01' },
      { id: 'c2', author: 'bob', body: 'reply', createdAt: '2026-01-02' },
    ],
    ...over,
  };
}

function draft(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'd1',
    file: 'b.ts',
    lineStart: 5,
    lineEnd: 5,
    severity: 'major',
    body: 'draft body',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01',
    ...over,
  };
}

describe('planItemKey', () => {
  it('composes kind:id', () => {
    expect(planItemKey('remote', 't1')).toBe('remote:t1');
    expect(planItemKey('local', 'd1')).toBe('local:d1');
  });
});

describe('snapshotRemote', () => {
  it('copies root body/author and replies by value', () => {
    const item = snapshotRemote(thread());
    expect(item).toMatchObject({
      kind: 'remote',
      id: 't1',
      file: 'a.ts',
      line: 10,
      body: 'root',
      author: 'alice',
      replies: [{ author: 'bob', body: 'reply' }],
    });
    expect(item.annotation).toBeUndefined();
  });

  it('does not mutate when the source thread changes afterwards', () => {
    const t = thread();
    const item = snapshotRemote(t);
    t.comments[0].body = 'CHANGED';
    t.comments.push({ id: 'c3', author: 'carol', body: 'late', createdAt: 'x' });
    expect(item.body).toBe('root');
    expect(item.replies).toHaveLength(1);
  });

  it('attaches annotation when provided', () => {
    expect(snapshotRemote(thread(), 'note').annotation).toBe('note');
  });

  it('handles an empty comments array', () => {
    const item = snapshotRemote(thread({ comments: [] }));
    expect(item.body).toBe('');
    expect(item.author).toBe('unknown');
    expect(item.replies).toEqual([]);
  });
});

describe('snapshotLocal', () => {
  it('copies body/severity/file/line', () => {
    const item = snapshotLocal(draft());
    expect(item).toMatchObject({
      kind: 'local',
      id: 'd1',
      file: 'b.ts',
      line: 5,
      body: 'draft body',
      severity: 'major',
    });
  });

  it('does not mutate when the source draft changes afterwards', () => {
    const d = draft();
    const item = snapshotLocal(d);
    d.body = 'CHANGED';
    expect(item.body).toBe('draft body');
  });
});
