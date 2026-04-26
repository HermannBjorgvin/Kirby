import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  dequeueOldest,
  enqueue,
  peekAll,
  remove,
  size,
  subscribe,
} from './inactive-alerts.js';

afterEach(() => __resetForTests());

describe('inactive-alerts queue', () => {
  it('enqueues and dequeues in FIFO order', () => {
    enqueue('a');
    enqueue('b');
    enqueue('c');
    expect(dequeueOldest()).toBe('a');
    expect(dequeueOldest()).toBe('b');
    expect(dequeueOldest()).toBe('c');
    expect(dequeueOldest()).toBeNull();
  });

  it('deduplicates: enqueueing an existing name is a no-op', () => {
    enqueue('a');
    enqueue('b');
    enqueue('a');
    expect(peekAll()).toEqual(['a', 'b']);
  });

  it('remove() drops a specific name from the middle of the queue', () => {
    enqueue('a');
    enqueue('b');
    enqueue('c');
    remove('b');
    expect(peekAll()).toEqual(['a', 'c']);
  });

  it('remove() of a non-queued name is a no-op', () => {
    enqueue('a');
    remove('zzz');
    expect(peekAll()).toEqual(['a']);
  });

  it('size() reflects the queue length', () => {
    expect(size()).toBe(0);
    enqueue('a');
    enqueue('b');
    expect(size()).toBe(2);
    dequeueOldest();
    expect(size()).toBe(1);
  });

  it('notifies subscribers on enqueue / dequeue / remove', () => {
    const cb = vi.fn();
    subscribe(cb);
    enqueue('a');
    expect(cb).toHaveBeenCalledTimes(1);
    dequeueOldest();
    expect(cb).toHaveBeenCalledTimes(2);
    enqueue('b');
    remove('b');
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('does not notify on dedup or no-op remove', () => {
    enqueue('a');
    const cb = vi.fn();
    subscribe(cb);
    enqueue('a'); // dup
    remove('zzz'); // not present
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribe returns a teardown that detaches', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    enqueue('a');
    off();
    enqueue('b');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
