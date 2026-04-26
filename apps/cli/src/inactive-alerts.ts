// Module-level FIFO queue of session names that have transitioned from
// active → idle and not yet been visited (acked) by the user.
//
// Pure module: no React. Subscribers (a hook) translate changes to
// re-renders. Tests can drive the queue directly via the public API
// and use __resetForTests to isolate.

const queue: string[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of [...subscribers]) fn();
}

export function enqueue(name: string): void {
  if (queue.includes(name)) return;
  queue.push(name);
  notify();
}

export function dequeueOldest(): string | null {
  const next = queue.shift();
  if (next === undefined) return null;
  notify();
  return next;
}

export function remove(name: string): void {
  const idx = queue.indexOf(name);
  if (idx === -1) return;
  queue.splice(idx, 1);
  notify();
}

export function peekAll(): readonly string[] {
  return queue;
}

export function size(): number {
  return queue.length;
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function __resetForTests(): void {
  queue.length = 0;
  subscribers.clear();
}
