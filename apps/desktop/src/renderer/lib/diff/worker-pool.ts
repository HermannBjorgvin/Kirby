/**
 * A tiny scheduler over a handful of workers, with two disciplines the
 * diff viewer depends on.
 *
 * **Parallel, because highlighting does not get cheaper.** Shiki
 * tokenizes a 600-line TypeScript file in roughly 300 ms, and the
 * desktop fetches whole files (`-U99999`), so a 40-file pull request
 * is around 28 seconds of tokenizing. On one worker that is 28 seconds
 * however many cores the machine has.
 *
 * **Newest first, because the queue is a history of where the user has
 * been.** The viewer asks for a file when it scrolls into view, so
 * after a flick through a diff the queue holds every file passed on the
 * way and its *last* entry is the one on screen. Serving oldest first
 * made the visible file wait behind all of them: measured at 1288 ms
 * before a flicked-to screen became readable, against 38 ms newest
 * first. Nothing starves — stop scrolling and the queue drains — and
 * `priority` jobs still go ahead of all of it, which is what a parse
 * needs, since a tab shows nothing at all until one lands.
 *
 * Workers are spawned only when work is queued behind a busy one, so
 * the common case (open a tab, read one file) still runs exactly one.
 *
 * The pool owns no knowledge of diffs; `spawn` and the message types
 * come from the caller, which is what lets its scheduling be tested
 * against a fake worker instead of a real one.
 */

/** The rejection a dropped job gets, matching the DOM's own name so a
 *  caller can tell "you cancelled this" from "this failed". */
function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

/** The part of `Worker` a pool needs — so a test can supply a fake. */
export interface WorkerLike<Req, Res> {
  postMessage(msg: Req): void;
  terminate(): void;
  onmessage: ((e: { data: Res }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface PoolOptions<Req, Res> {
  /** Create a worker. Called lazily, at most `maxWorkers` times over. */
  spawn: () => WorkerLike<Req, Res>;
  /** Upper bound on live workers. */
  maxWorkers: number;
  /** The id carried by a request, used to match its response. */
  idOf: (msg: Req | Res) => number;
}

interface Job<Req, Res> {
  msg: Req;
  resolve: (r: Res) => void;
  reject: (e: Error) => void;
  /** Detach the abort listener once the job is settled. */
  release?: () => void;
}

export interface RunOptions {
  /** Put this job ahead of all ordinary queued work. */
  priority?: boolean;
  /**
   * Drop the job if it is still queued when this aborts.
   *
   * Only *queued* work is cancellable: a worker mid-tokenize cannot be
   * interrupted without terminating it and throwing away its warmed-up
   * grammars, which would cost more than it saves. That is not a
   * limitation in practice — after a flick through a diff nearly
   * everything is queued rather than running, and it is the queue that
   * holds the files nobody is looking at any more.
   */
  signal?: AbortSignal;
}

interface Slot<Req, Res> {
  worker: WorkerLike<Req, Res>;
  /** The job this worker is busy with, or null when idle. */
  current: number | null;
}

export class WorkerPool<Req, Res> {
  private readonly slots: Slot<Req, Res>[] = [];
  private readonly jobs = new Map<number, Job<Req, Res>>();
  /** Jumps the queue; oldest first among themselves. */
  private readonly priority: number[] = [];
  /** Ordinary work, oldest first — taken from the end. */
  private readonly queue: number[] = [];

  constructor(private readonly opts: PoolOptions<Req, Res>) {}

  /** Run `msg` on the pool. See {@link RunOptions}. */
  run(msg: Req, opts: RunOptions = {}): Promise<Res> {
    const id = this.opts.idOf(msg);
    return new Promise<Res>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(abortError());
        return;
      }
      const job: Job<Req, Res> = { msg, resolve, reject };
      this.jobs.set(id, job);
      (opts.priority ? this.priority : this.queue).push(id);

      if (opts.signal) {
        const onAbort = () => this.dropIfQueued(id);
        opts.signal.addEventListener('abort', onAbort, { once: true });
        job.release = () => opts.signal?.removeEventListener('abort', onAbort);
      }
      this.pump();
    });
  }

  /**
   * Forget a job that has not started yet. A job already handed to a
   * worker is left alone — see {@link RunOptions.signal}.
   */
  private dropIfQueued(id: number): void {
    const at = this.queue.indexOf(id);
    if (at < 0) return;
    this.queue.splice(at, 1);
    this.settle(id, (job) => job.reject(abortError()));
  }

  /** How many workers exist, and how much is waiting. */
  stats(): { workers: number; queued: number; running: number } {
    return {
      workers: this.slots.length,
      queued: this.priority.length + this.queue.length,
      running: this.slots.filter((s) => s.current !== null).length,
    };
  }

  private nextId(): number | undefined {
    return this.priority.shift() ?? this.queue.pop();
  }

  private pump(): void {
    while (this.priority.length > 0 || this.queue.length > 0) {
      const slot = this.freeSlot();
      if (!slot) return;
      const id = this.nextId();
      if (id === undefined) return;
      const job = this.jobs.get(id);
      // Already settled (a crashed worker rejected it) — skip.
      if (!job) continue;
      slot.current = id;
      slot.worker.postMessage(job.msg);
    }
  }

  private freeSlot(): Slot<Req, Res> | null {
    const idle = this.slots.find((s) => s.current === null);
    if (idle) return idle;
    return this.slots.length < this.opts.maxWorkers ? this.grow() : null;
  }

  private grow(): Slot<Req, Res> {
    const worker = this.opts.spawn();
    const slot: Slot<Req, Res> = { worker, current: null };

    worker.onmessage = (e) => {
      slot.current = null;
      this.settle(this.opts.idOf(e.data), (job) => job.resolve(e.data));
      this.pump();
    };

    // A crashed worker takes its own job down with it. Retire the slot
    // rather than the pool: the others are still fine, and the next
    // queued job spawns a replacement.
    worker.onerror = () => {
      const failed = slot.current;
      slot.current = null;
      const at = this.slots.indexOf(slot);
      if (at >= 0) this.slots.splice(at, 1);
      worker.terminate();
      if (failed !== null) {
        this.settle(failed, (job) => job.reject(new Error('worker crashed')));
      }
      this.pump();
    };

    this.slots.push(slot);
    return slot;
  }

  private settle(id: number, finish: (job: Job<Req, Res>) => void): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    job.release?.();
    finish(job);
  }
}
