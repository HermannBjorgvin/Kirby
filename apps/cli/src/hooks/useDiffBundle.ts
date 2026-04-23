import { useDiffData } from './useDiffData.js';
import { useReviewComments } from './useReviewComments.js';
import { useRemoteComments } from './useRemoteComments.js';
import { useConfig } from '../context/ConfigContext.js';

// Single source of truth for PR diff data. Mounted once in MainContent
// and threaded to both DiffFileListContainer and DiffFileViewerContainer
// so they share the same `diffText`, `files`, in-memory cache, and
// `fs.watch`-backed comment stream. Without this, each container mounted
// its own useDiffData + useReviewComments — loadDiffText() would populate
// the list's state, then the list would unmount and the viewer would
// remount with fresh (empty) state, showing "(no diff for this file)".
export function useDiffBundle(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string
) {
  const diff = useDiffData(prNumber, sourceBranch, targetBranch);
  const comments = useReviewComments(prNumber);
  const { provider, config } = useConfig();
  const remote = useRemoteComments(
    prNumber,
    provider,
    config.vendorAuth,
    config.vendorProject
  );
  return { ...diff, comments, remote };
}

export type DiffBundle = ReturnType<typeof useDiffBundle>;
