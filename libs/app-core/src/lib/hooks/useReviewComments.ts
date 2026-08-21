import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { watch } from 'node:fs';
import {
  readComments,
  commentDirPath,
  type ReviewComment,
} from '@kirby/review-comments';

export function useReviewComments(prId: number | null): ReviewComment[] {
  // Revision counter bumped by file watcher to trigger re-reads
  const [revision, setRevision] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpRevision = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    if (prId === null) return;

    const dir = commentDirPath(prId);
    let watcher: ReturnType<typeof watch> | null = null;

    try {
      watcher = watch(dir, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(bumpRevision, 100);
      });
    } catch {
      // Directory may not exist yet
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      watcher?.close();
    };
  }, [prId, bumpRevision]);

  // Derive comments from prId + revision (re-reads on file change or prId change)
  return useMemo(
    () => (prId !== null ? readComments(prId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers re-read
    [prId, revision]
  );
}
