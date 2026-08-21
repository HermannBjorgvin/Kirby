import { useCallback } from 'react';
import { useDiffData } from './useDiffData.js';
import { useReviewComments } from './useReviewComments.js';
import { useRemoteComments } from './useRemoteComments.js';
import { useConfig } from '../context/ConfigContext.js';
import { useSessionActions } from '../context/SessionContext.js';

// Single source of truth for PR diff data. Mounted once in MainContent
// and threaded to both DiffFileListContainer and DiffFileViewerContainer
// so they share the same `files`, per-file diff cache, and `fs.watch`-
// backed comment stream. Without this, each container mounted its own
// useDiffData + useReviewComments — the list and viewer would each
// re-fetch, and switching between them would clear in-memory caches.
export function useDiffBundle(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  const diff = useDiffData(prNumber, sourceBranch, targetBranch, headSha);
  const comments = useReviewComments(prNumber);
  const { provider, config } = useConfig();
  const { refreshPr, flashStatus } = useSessionActions();
  const onFetchError = useCallback(
    (msg: string) => flashStatus(`Failed to load comments: ${msg}`),
    [flashStatus]
  );
  const remote = useRemoteComments(
    prNumber,
    provider,
    config.vendorAuth,
    config.vendorProject,
    refreshPr,
    onFetchError
  );
  return { ...diff, comments, remote };
}

export type DiffBundle = ReturnType<typeof useDiffBundle>;
