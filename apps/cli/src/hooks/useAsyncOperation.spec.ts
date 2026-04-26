import { describe, it, expect, beforeEach } from 'vitest';
import {
  run,
  isRunning,
  beginOp,
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

describe('beginOp (refcounted)', () => {
  beforeEach(() => {
    __resetAsyncOperationsForTest();
  });

  it('marks op in flight, end() clears it', () => {
    expect(isRunning('load-pr-files')).toBe(false);
    const end = beginOp('load-pr-files');
    expect(isRunning('load-pr-files')).toBe(true);
    end();
    expect(isRunning('load-pr-files')).toBe(false);
  });

  it('two concurrent beginOp calls keep the op in flight until both end', () => {
    // Regression guard — the previous `runAsyncOp('load-pr-files', fn)`
    // dedup'd this case and silently dropped the second call, leaving
    // the post-headSha-arrival cache key with no fetched data and
    // showing "0 files". `beginOp` must allow overlap.
    const end1 = beginOp('load-pr-files');
    const end2 = beginOp('load-pr-files');
    expect(isRunning('load-pr-files')).toBe(true);

    end1();
    // First end shouldn't clear — second caller is still active.
    expect(isRunning('load-pr-files')).toBe(true);

    end2();
    expect(isRunning('load-pr-files')).toBe(false);
  });

  it('end() called twice is a no-op', () => {
    // Async finally blocks can run twice in pathological cases (e.g.
    // both a thrown error path and a manual cleanup). Idempotent end
    // protects the refcount from going negative.
    const end1 = beginOp('load-pr-files');
    const end2 = beginOp('load-pr-files');
    end1();
    end1(); // double-end on the first
    expect(isRunning('load-pr-files')).toBe(true);
    end2();
    expect(isRunning('load-pr-files')).toBe(false);
  });

  it('different op names refcount independently', () => {
    const endA = beginOp('load-pr-files');
    const endB = beginOp('refresh-pr');
    expect(isRunning('load-pr-files')).toBe(true);
    expect(isRunning('refresh-pr')).toBe(true);

    endA();
    expect(isRunning('load-pr-files')).toBe(false);
    expect(isRunning('refresh-pr')).toBe(true);

    endB();
    expect(isRunning('refresh-pr')).toBe(false);
  });

  it('does not dedup like run() — both invocations succeed', async () => {
    // Mixing the two APIs in one test makes the contrast explicit:
    // run() drops the second concurrent call, beginOp() doesn't.
    let runFnCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = run('sync', () => {
      runFnCalls++;
      return gate;
    });
    await run('sync', async () => {
      runFnCalls++;
    });
    expect(runFnCalls).toBe(1); // run() dedup'd

    release();
    await first;

    // Now the same scenario with beginOp — both calls are accepted.
    const end1 = beginOp('load-pr-files');
    const end2 = beginOp('load-pr-files');
    expect(isRunning('load-pr-files')).toBe(true);
    end1();
    expect(isRunning('load-pr-files')).toBe(true);
    end2();
    expect(isRunning('load-pr-files')).toBe(false);
  });
});
