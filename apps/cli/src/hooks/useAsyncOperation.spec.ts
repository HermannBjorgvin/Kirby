import { describe, it, expect, beforeEach } from 'vitest';
import {
  run,
  isRunning,
  __resetAsyncOperationsForTest,
} from './useAsyncOperation.js';

describe('useAsyncOperation (module store)', () => {
  beforeEach(() => {
    __resetAsyncOperationsForTest();
  });

  it('isRunning reflects state before, during, and after a run', async () => {
    expect(isRunning('sync')).toBe(false);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = run('sync', () => gate);

    // Between the `await gate` inside fn and our call here, the op
    // is enqueued and the set has been updated.
    expect(isRunning('sync')).toBe(true);

    release();
    await running;

    expect(isRunning('sync')).toBe(false);
  });

  it('collapses a second concurrent run of the same op', async () => {
    let firstFnCalls = 0;
    let secondFnCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = run('sync', () => {
      firstFnCalls++;
      return gate;
    });

    // Second call while the first is mid-flight — should return
    // immediately without invoking fn again.
    await run('sync', async () => {
      secondFnCalls++;
    });

    expect(firstFnCalls).toBe(1);
    expect(secondFnCalls).toBe(0);
    expect(isRunning('sync')).toBe(true);

    release();
    await first;

    expect(isRunning('sync')).toBe(false);
  });

  it('different op names run concurrently', async () => {
    let releaseSync!: () => void;
    let releaseRebase!: () => void;
    const syncGate = new Promise<void>((r) => {
      releaseSync = r;
    });
    const rebaseGate = new Promise<void>((r) => {
      releaseRebase = r;
    });

    const syncRun = run('sync', () => syncGate);
    const rebaseRun = run('rebase', () => rebaseGate);

    expect(isRunning('sync')).toBe(true);
    expect(isRunning('rebase')).toBe(true);

    releaseSync();
    await syncRun;
    expect(isRunning('sync')).toBe(false);
    expect(isRunning('rebase')).toBe(true);

    releaseRebase();
    await rebaseRun;
    expect(isRunning('rebase')).toBe(false);
  });

  it('finally runs even when fn throws', async () => {
    await expect(
      run('sync', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(isRunning('sync')).toBe(false);
  });
});
