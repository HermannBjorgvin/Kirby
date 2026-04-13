import { useState, useRef, useCallback } from 'react';

export type OperationName =
  | 'sync'
  | 'rebase'
  | 'fetch-branches'
  | 'create-worktree'
  | 'delete'
  | 'check-delete'
  | 'start-session'
  | 'open-editor'
  | 'refresh-pr'
  | 'post-comment';

export function useAsyncOperation() {
  const [inFlight, setInFlight] = useState<Set<OperationName>>(new Set());
  const inFlightRef = useRef<Set<OperationName>>(new Set());

  const run = useCallback(
    async (name: OperationName, fn: () => Promise<void>) => {
      if (inFlightRef.current.has(name)) return;
      inFlightRef.current = new Set([...inFlightRef.current, name]);
      setInFlight(new Set(inFlightRef.current));
      try {
        await fn();
      } finally {
        const next = new Set(inFlightRef.current);
        next.delete(name);
        inFlightRef.current = next;
        setInFlight(new Set(next));
      }
    },
    []
  );

  const isRunning = useCallback(
    (name: OperationName) => inFlightRef.current.has(name),
    []
  );

  return { run, isRunning, inFlight };
}
