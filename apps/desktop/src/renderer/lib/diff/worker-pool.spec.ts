import { describe, expect, it } from 'vitest';
import { WorkerPool, type WorkerLike } from './worker-pool.js';

/**
 * The pool exists for two properties the diff viewer measurably needs:
 * more than one file highlighting at a time, and the file on screen
 * going first. Both are scheduling, both are invisible from the
 * outside, and both are exactly the kind of thing that gets undone by
 * a plausible-looking edit — so they are asserted here against a fake
 * worker rather than left to the benchmark to notice.
 */

interface Msg {
  id: number;
}

/** A worker that never answers until the test says so. */
class FakeWorker implements WorkerLike<Msg, Msg> {
  onmessage: ((e: { data: Msg }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readonly received: number[] = [];
  terminated = false;

  postMessage(msg: Msg): void {
    this.received.push(msg.id);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answer the job this worker is holding. */
  reply(id: number): void {
    this.onmessage?.({ data: { id } });
  }
  crash(): void {
    this.onerror?.(new Error('boom'));
  }
}

function makePool(maxWorkers: number) {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool<Msg, Msg>({
    maxWorkers,
    idOf: (m) => m.id,
    spawn: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  return { pool, workers };
}

describe('WorkerPool', () => {
  it('runs one job on one worker rather than spawning a pool', () => {
    const { pool, workers } = makePool(4);
    void pool.run({ id: 1 });
    // Reading a single file must not cost four shiki instances.
    expect(workers).toHaveLength(1);
    expect(workers[0].received).toEqual([1]);
  });

  it('spreads concurrent jobs across workers up to the cap', () => {
    const { pool, workers } = makePool(3);
    for (const id of [1, 2, 3, 4, 5]) void pool.run({ id });

    expect(workers).toHaveLength(3);
    expect(workers.map((w) => w.received)).toEqual([[1], [2], [3]]);
    expect(pool.stats()).toEqual({ workers: 3, queued: 2, running: 3 });
  });

  it('serves the newest queued job first', async () => {
    const { pool, workers } = makePool(1);
    const done: number[] = [];
    for (const id of [1, 2, 3, 4]) {
      void pool.run({ id }).then((r) => done.push(r.id));
    }

    // 1 went straight to the worker; 2, 3 and 4 are waiting. The user
    // is looking at 4 — it is the file that just scrolled into view.
    expect(workers[0].received).toEqual([1]);
    workers[0].reply(1);
    expect(workers[0].received).toEqual([1, 4]);
    workers[0].reply(4);
    expect(workers[0].received).toEqual([1, 4, 3]);

    workers[0].reply(3);
    workers[0].reply(2);
    await Promise.resolve();
    expect(done).toEqual([1, 4, 3, 2]);
  });

  it('lets a priority job jump the whole queue', () => {
    const { pool, workers } = makePool(1);
    void pool.run({ id: 1 });
    void pool.run({ id: 2 });
    void pool.run({ id: 3 });
    // A parse: the tab shows nothing until it lands.
    void pool.run({ id: 99 }, { priority: true });

    workers[0].reply(1);
    expect(workers[0].received).toEqual([1, 99]);
  });

  it('keeps priority jobs in the order they arrived', () => {
    const { pool, workers } = makePool(1);
    void pool.run({ id: 1 });
    void pool.run({ id: 98 }, { priority: true });
    void pool.run({ id: 99 }, { priority: true });

    workers[0].reply(1);
    workers[0].reply(98);
    expect(workers[0].received).toEqual([1, 98, 99]);
  });

  it('drains everything once the queue stops growing', async () => {
    const { pool, workers } = makePool(1);
    const done: number[] = [];
    for (const id of [1, 2, 3]) {
      void pool.run({ id }).then((r) => done.push(r.id));
    }
    // Newest-first must not mean oldest-never.
    for (let i = 0; i < 3; i++) {
      workers[0].reply(workers[0].received[workers[0].received.length - 1]);
    }
    await Promise.resolve();
    expect(done.sort()).toEqual([1, 2, 3]);
    expect(pool.stats().queued).toBe(0);
  });

  it('rejects only the crashed worker’s job and carries on', async () => {
    const { pool, workers } = makePool(2);
    const a = pool.run({ id: 1 });
    const b = pool.run({ id: 2 });
    void pool.run({ id: 3 });

    workers[0].crash();

    await expect(a).rejects.toThrow('worker crashed');
    expect(workers[0].terminated).toBe(true);
    // The survivor keeps its job, and the queued one gets a
    // replacement worker rather than being stranded.
    workers[1].reply(2);
    await expect(b).resolves.toEqual({ id: 2 });
    expect(workers).toHaveLength(3);
    expect(workers[2].received).toEqual([3]);
  });

  it('drops a queued job when its caller loses interest', async () => {
    const { pool, workers } = makePool(1);
    const stale = new AbortController();
    void pool.run({ id: 1 });
    const dropped = pool.run({ id: 2 }, { signal: stale.signal });
    void pool.run({ id: 3 });

    // The file scrolled out of view. Nothing should tokenize it.
    stale.abort();
    await expect(dropped).rejects.toThrow(/abort/i);
    expect(pool.stats().queued).toBe(1);

    workers[0].reply(1);
    expect(workers[0].received).toEqual([1, 3]);
  });

  it('leaves a job already running alone', async () => {
    const { pool, workers } = makePool(1);
    const started = new AbortController();
    const running = pool.run({ id: 1 }, { signal: started.signal });

    // Interrupting a busy worker means terminating it and losing its
    // warmed-up grammars, which costs more than letting it finish.
    started.abort();
    expect(workers[0].terminated).toBe(false);
    workers[0].reply(1);
    await expect(running).resolves.toEqual({ id: 1 });
  });

  it('refuses a job whose signal is already aborted', async () => {
    const { pool, workers } = makePool(1);
    const gone = new AbortController();
    gone.abort();
    await expect(pool.run({ id: 1 }, { signal: gone.signal })).rejects.toThrow(
      /abort/i
    );
    expect(workers).toHaveLength(0);
  });

  it('ignores a response for a job it does not have', () => {
    const { pool, workers } = makePool(1);
    void pool.run({ id: 1 });
    expect(() => workers[0].reply(404)).not.toThrow();
  });
});
