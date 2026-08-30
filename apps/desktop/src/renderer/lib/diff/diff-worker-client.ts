import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import type {
  SlimToken,
  WorkerRequest,
  WorkerResponse,
} from '../../workers/diff-worker.js';
import type { CharRange } from './word-diff.js';
import { WorkerPool, type WorkerLike } from './worker-pool.js';

export type { SlimToken };
export type LineTokens = SlimToken[];

/**
 * Promise API over the diff workers (parse / analyze / code fences).
 *
 * The scheduling — several workers, newest request first, parses ahead
 * of everything — lives in `worker-pool.ts`, where it can be tested
 * without a real Worker. This file is the diff-shaped adapter over it:
 * which message types exist, which of them jump the queue, and the
 * main-thread fallback for a parse.
 */

/**
 * Leave a core for the renderer itself — the UI thread still has to
 * paint the rows the workers are colouring. Capped low because each
 * worker is another shiki instance with its own copy of every grammar
 * it loads, so the fourth mostly buys memory rather than throughput.
 */
const MAX_WORKERS = Math.max(
  1,
  Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1)
);

const pool = new WorkerPool<WorkerRequest, WorkerResponse>({
  maxWorkers: MAX_WORKERS,
  idOf: (msg) => msg.id,
  spawn: () =>
    new Worker(new URL('../../workers/diff-worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike<WorkerRequest, WorkerResponse>,
});

let nextId = 1;

/** Omit that distributes over a union (plain Omit collapses variants). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * Round-trip timings, on the renderer's own performance timeline.
 *
 * The interesting number is not how long the worker computes but how
 * long the *caller* waits, queueing included — that is the gap between
 * a diff appearing and it becoming readable, and it is invisible from
 * inside the worker. Named `kirby:diff:<type>`, so devtools and the
 * perf harness both read them with no extra wiring.
 */
function measure(type: WorkerRequest['type'], startedAt: number): void {
  try {
    performance.measure(`kirby:diff:${type}`, {
      start: startedAt,
      end: performance.now(),
    });
  } catch {
    // Measuring must never break the thing being measured.
  }
}

async function request(
  msg: DistributiveOmit<WorkerRequest, 'id'>
): Promise<WorkerResponse> {
  const full = { ...msg, id: nextId++ } as WorkerRequest;
  const startedAt = performance.now();
  try {
    // A parse jumps the queue: a tab shows nothing at all until one
    // lands, where a missing highlight only costs colour.
    return await pool.run(full, full.type === 'parse');
  } finally {
    measure(full.type, startedAt);
  }
}

export async function parseDiffInWorker(
  text: string
): Promise<[string, DiffLine[]][]> {
  try {
    const r = await request({ type: 'parse', text });
    if (r.type === 'parse') return r.entries;
  } catch {
    // fall through to the main-thread parser
  }
  // Fallback: environments where the module worker can't start (e.g.
  // file:// quirks) must still show the diff — highlights can degrade,
  // the parse cannot. The parser itself is tiny.
  return [...parseUnifiedDiff(text).entries()];
}

export interface FileAnalysis {
  tokens: LineTokens[] | null;
  wordRanges: Map<number, CharRange[]>;
}

export async function analyzeFileInWorker(
  filename: string,
  lines: DiffLine[],
  theme: 'light' | 'dark'
): Promise<FileAnalysis> {
  const r = await request({ type: 'analyze', filename, lines, theme });
  if (r.type !== 'analyze') return { tokens: null, wordRanges: new Map() };
  return { tokens: r.tokens, wordRanges: new Map(r.wordRanges) };
}

export async function tokenizeCodeInWorker(
  code: string,
  tag: string,
  theme: 'light' | 'dark'
): Promise<LineTokens[] | null> {
  const r = await request({ type: 'code', code, tag, theme });
  return r.type === 'code' ? r.tokens : null;
}
