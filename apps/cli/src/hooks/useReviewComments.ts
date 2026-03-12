import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { watch } from 'node:fs';
import { readComments, commentDirPath } from '../utils/comment-store.js';
import type { ReviewComment } from '../types.js';

export function useReviewComments(prId: number | null): ReviewComment[] {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    setComments(prId !== null ? readComments(prId) : []);
  }, [prId]);

  // Initial load + reload on prId change
  const initialComments = useMemo(
    () => (prId !== null ? readComments(prId) : []),
    [prId]
  );

  useEffect(() => {
    setComments(initialComments);
   
  }, [initialComments]);

  useEffect(() => {
    if (prId === null) return;

    const dir = commentDirPath(prId);
    let watcher: ReturnType<typeof watch> | null = null;

    try {
      watcher = watch(dir, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(reload, 100);
      });
    } catch {
      // Directory may not exist yet
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      watcher?.close();
    };
  }, [prId, reload]);

  return comments;
}
