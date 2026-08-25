import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import type {
  SlimToken,
  WorkerRequest,
  WorkerResponse,
} from '../workers/diff-worker.js';
import type { CharRange } from './diff-model.js';

export type { SlimToken };
export type LineTokens = SlimToken[];

/**
 * Promise API over the diff worker (parse / analyze / code fences).
 * One shared worker; requests are matched to responses by id.
 */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/diff-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.type === 'error') entry.reject(new Error(e.data.message));
      else entry.resolve(e.data);
    };
    worker.onerror = () => {
      // A crashed worker rejects everything in flight; callers show
      // unhighlighted content, and the next request restarts it.
      for (const { reject } of pending.values()) {
        reject(new Error('diff worker crashed'));
      }
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Omit that distributes over a union (plain Omit collapses variants). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

function request(
  msg: DistributiveOmit<WorkerRequest, 'id'>
): Promise<WorkerResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id });
  });
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
