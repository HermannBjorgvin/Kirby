import { describe, it, expect, beforeEach } from 'vitest';
import type { LocalPlanItem, RemotePlanItem } from './plan-types.js';
import {
  add,
  annotate,
  clear,
  count,
  has,
  list,
  remove,
  toggle,
  __resetPlanStoreForTest,
} from './plan-store.js';

function remote(id: string, over: Partial<RemotePlanItem> = {}): RemotePlanItem {
  return {
    kind: 'remote',
    id,
    file: 'a.ts',
    line: 1,
    body: `body-${id}`,
    author: 'alice',
    replies: [],
    ...over,
  };
}

function local(id: string, over: Partial<LocalPlanItem> = {}): LocalPlanItem {
  return {
    kind: 'local',
    id,
    file: 'b.ts',
    line: 2,
    body: `body-${id}`,
    severity: 'minor',
    ...over,
  };
}

describe('plan-store', () => {
  beforeEach(() => __resetPlanStoreForTest());

  it('adds and lists items in insertion order', () => {
    add(1, remote('t1'));
    add(1, local('d1'));
    expect(list(1).map((i) => i.id)).toEqual(['t1', 'd1']);
    expect(count(1)).toBe(2);
  });

  it('dedupes by kind+id, re-snapshotting in place', () => {
    add(1, remote('t1', { body: 'old' }));
    add(1, local('t1')); // same id, different kind => distinct
    add(1, remote('t1', { body: 'new' }));
    const items = list(1);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'remote', body: 'new' });
    expect(items.map((i) => i.kind)).toEqual(['remote', 'local']);
  });

  it('toggle returns membership and flips it', () => {
    expect(toggle(1, remote('t1'))).toBe(true);
    expect(has(1, 'remote', 't1')).toBe(true);
    expect(toggle(1, remote('t1'))).toBe(false);
    expect(has(1, 'remote', 't1')).toBe(false);
    expect(count(1)).toBe(0);
  });

  it('remove is a no-op for a missing item', () => {
    add(1, remote('t1'));
    remove(1, 'remote', 'nope');
    expect(count(1)).toBe(1);
  });

  it('annotate sets and clears the note on an existing item', () => {
    add(1, remote('t1'));
    annotate(1, 'remote', 't1', '  use useMemo  ');
    expect(list(1)[0].annotation).toBe('use useMemo');
    annotate(1, 'remote', 't1', '   ');
    expect(list(1)[0].annotation).toBeUndefined();
  });

  it('annotate is a no-op for a missing item', () => {
    annotate(1, 'remote', 'nope', 'x');
    expect(count(1)).toBe(0);
  });

  it('isolates plans per PR id', () => {
    add(1, remote('t1'));
    add(2, remote('t2'));
    expect(list(1).map((i) => i.id)).toEqual(['t1']);
    expect(list(2).map((i) => i.id)).toEqual(['t2']);
    clear(1);
    expect(count(1)).toBe(0);
    expect(count(2)).toBe(1);
  });

  it('clear empties a PR plan', () => {
    add(1, remote('t1'));
    add(1, remote('t2'));
    clear(1);
    expect(list(1)).toEqual([]);
  });
});
