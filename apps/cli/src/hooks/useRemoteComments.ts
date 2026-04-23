import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PullRequestComments,
  RemoteCommentThread,
  RemoteCommentReply,
  VcsProvider,
} from '@kirby/vcs-core';
import { logError } from '@kirby/logger';

const EMPTY_COMMENTS: PullRequestComments = {
  threads: [],
  generalComments: [],
};

export function useRemoteComments(
  prId: number | null,
  provider: VcsProvider | null,
  auth: Record<string, string>,
  project: Record<string, string>,
  onResolvedChange?: () => void
) {
  const [comments, setComments] = useState<PullRequestComments>(EMPTY_COMMENTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const cacheRef = useRef<Map<number, PullRequestComments>>(new Map());

  const fetchComments = useCallback(
    async (forceRefresh = false) => {
      if (!prId || !provider?.fetchCommentThreads) {
        setComments(EMPTY_COMMENTS);
        return;
      }

      // Use cache unless force-refreshing
      if (!forceRefresh) {
        const cached = cacheRef.current.get(prId);
        if (cached) {
          setComments(cached);
          return;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const result = await provider.fetchCommentThreads(auth, project, prId);
        if (mountedRef.current) {
          cacheRef.current.set(prId, result);
          setComments(result);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`fetchCommentThreads [${provider.id}]`, err as Error);
        if (mountedRef.current) {
          setError(msg);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [prId, provider, auth, project]
  );

  // Fetch when PR changes
  useEffect(() => {
    mountedRef.current = true;
    fetchComments();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchComments]);

  const refresh = useCallback(() => {
    fetchComments(true);
  }, [fetchComments]);

  const replyToThread = useCallback(
    async (threadId: string, body: string): Promise<RemoteCommentReply> => {
      if (!prId || !provider?.replyToThread) {
        throw new Error('Reply not available — no provider or PR');
      }
      try {
        const reply = await provider.replyToThread(
          auth,
          project,
          prId,
          threadId,
          body
        );
        // Optimistically update the local state
        const updateThreads = (
          threads: RemoteCommentThread[]
        ): RemoteCommentThread[] =>
          threads.map((t) =>
            t.id === threadId ? { ...t, comments: [...t.comments, reply] } : t
          );
        setComments((prev) => ({
          threads: updateThreads(prev.threads),
          generalComments: updateThreads(prev.generalComments),
        }));
        // Also update cache
        const cached = cacheRef.current.get(prId);
        if (cached) {
          cacheRef.current.set(prId, {
            threads: updateThreads(cached.threads),
            generalComments: updateThreads(cached.generalComments),
          });
        }
        return reply;
      } catch (err: unknown) {
        logError(`replyToThread [${provider.id}]`, err as Error);
        throw err;
      }
    },
    [prId, provider, auth, project]
  );

  const toggleResolved = useCallback(
    async (threadId: string, resolved: boolean): Promise<boolean> => {
      if (!prId || !provider?.setThreadResolved) return false;
      try {
        await provider.setThreadResolved(
          auth,
          project,
          prId,
          threadId,
          resolved
        );
        // Optimistically update the local state
        const updateThreads = (
          threads: RemoteCommentThread[]
        ): RemoteCommentThread[] =>
          threads.map((t) =>
            t.id === threadId ? { ...t, isResolved: resolved } : t
          );
        setComments((prev) => ({
          threads: updateThreads(prev.threads),
          generalComments: updateThreads(prev.generalComments),
        }));
        const cached = cacheRef.current.get(prId);
        if (cached) {
          cacheRef.current.set(prId, {
            threads: updateThreads(cached.threads),
            generalComments: updateThreads(cached.generalComments),
          });
        }
        // Notify caller so PR-level state (e.g. activeCommentCount on the
        // sidebar badge) can be refreshed without waiting for the next
        // PR poll tick.
        onResolvedChange?.();
        return true;
      } catch (err: unknown) {
        logError(`setThreadResolved [${provider.id}]`, err as Error);
        throw err;
      }
    },
    [prId, provider, auth, project, onResolvedChange]
  );

  return {
    threads: comments.threads,
    generalComments: comments.generalComments,
    loading,
    error,
    refresh,
    replyToThread,
    toggleResolved,
  };
}
