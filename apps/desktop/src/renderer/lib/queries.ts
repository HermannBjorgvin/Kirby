import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  PostDraftsRequest,
  ReplyRequest,
  ResolveRequest,
  ReviewComment,
  ReviewLaunchRequest,
  SessionLaunchRequest,
} from '../../host/contract.js';

/**
 * The renderer's data layer: every host call is a TanStack Query so
 * refetch cadence, caching, dedupe and invalidation live in one place
 * instead of ad-hoc setInterval/useEffect pairs in components.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export const keys = {
  repo: ['repo'] as const,
  version: ['version'] as const,
  recents: ['recents'] as const,
  sidebar: (cwd: string) => ['sidebar', cwd] as const,
  sync: (cwd: string) => ['sync', cwd] as const,
  branches: (cwd: string) => ['branches', cwd] as const,
  settings: (cwd: string) => ['settings', cwd] as const,
  sessions: (cwd: string) => ['sessions', cwd] as const,
  diff: (cwd: string, source: string, target: string) =>
    ['diff', cwd, source, target] as const,
  threads: (cwd: string, prId: number) => ['threads', cwd, prId] as const,
  commentImage: (url: string) => ['comment-image', url] as const,
  drafts: (cwd: string, prId: number) => ['drafts', cwd, prId] as const,
};

// ── Queries ──────────────────────────────────────────────────────

export function useVersion() {
  return useQuery({
    queryKey: keys.version,
    queryFn: () => window.kirby.getVersion(),
    staleTime: Infinity,
  });
}

export function useRecentRepos() {
  return useQuery({
    queryKey: keys.recents,
    queryFn: () => window.kirby.listRecentRepos(),
    staleTime: 0,
  });
}

/** Sidebar model. Local state (worktrees, alive PTYs) is cheap so we
 *  poll it every few seconds; remote PR data is cached host-side and
 *  only re-fetched on its own interval or an explicit refresh. */
export function useSidebarModel(cwd: string) {
  return useQuery({
    queryKey: keys.sidebar(cwd),
    queryFn: () => window.kirby.getSidebarModel(),
    refetchInterval: 4_000,
    placeholderData: (prev) => prev,
  });
}

export function useSyncState(cwd: string) {
  return useQuery({
    queryKey: keys.sync(cwd),
    queryFn: () => window.kirby.getSyncState(),
    refetchInterval: 4_000,
    placeholderData: (prev) => prev,
  });
}

export function useAllBranches(cwd: string, enabled = true) {
  return useQuery({
    queryKey: keys.branches(cwd),
    queryFn: () => window.kirby.listAllBranches(),
    enabled,
    staleTime: 30_000,
  });
}

export function useSettingsView(cwd: string) {
  return useQuery({
    queryKey: keys.settings(cwd),
    queryFn: () => window.kirby.getSettingsView(),
  });
}

export function useDiff(cwd: string, source: string, target: string) {
  return useQuery({
    queryKey: keys.diff(cwd, source, target),
    queryFn: () => window.kirby.fetchDiffText(source, target),
    staleTime: 60_000,
  });
}

export function useThreads(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.threads(cwd, prId),
    queryFn: () => window.kirby.fetchCommentThreads(prId),
    staleTime: 30_000,
    // prId 0 = a worktree without a PR: nothing to fetch.
    enabled: prId > 0,
  });
}

/** Comment image bytes (as a data URL), fetched host-side with auth. */
export function useCommentImage(url: string) {
  return useQuery({
    queryKey: keys.commentImage(url),
    queryFn: () => window.kirby.fetchCommentImage(url),
    enabled: url.length > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}

/** Draft review comments written by the review agent; polled so they
 *  show up in the diff while the agent is still working. */
export function useDraftComments(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.drafts(cwd, prId),
    queryFn: () => window.kirby.listDraftComments(prId),
    refetchInterval: 2_000,
    placeholderData: (prev) => prev,
    enabled: prId > 0,
  });
}

// ── Mutations ────────────────────────────────────────────────────

function useInvalidator(cwd: string) {
  const qc = useQueryClient();
  return {
    sidebar: () => qc.invalidateQueries({ queryKey: keys.sidebar(cwd) }),
    sync: () => qc.invalidateQueries({ queryKey: keys.sync(cwd) }),
    branches: () => qc.invalidateQueries({ queryKey: keys.branches(cwd) }),
    settings: () => qc.invalidateQueries({ queryKey: keys.settings(cwd) }),
    threads: (prId: number) =>
      qc.invalidateQueries({ queryKey: keys.threads(cwd, prId) }),
    drafts: (prId: number) =>
      qc.invalidateQueries({ queryKey: keys.drafts(cwd, prId) }),
  };
}

export function useCreateWorktree(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (branch: string) => window.kirby.createWorktree(branch),
    onSuccess: () => {
      void inv.sidebar();
      void inv.branches();
    },
  });
}

export function useRemoveWorktree(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: ({ branch, force }: { branch: string; force: boolean }) =>
      window.kirby.removeWorktree(branch, force),
    onSuccess: () => {
      void inv.sidebar();
      void inv.branches();
    },
  });
}

export function useLaunchAgent(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: SessionLaunchRequest) => window.kirby.launchAgent(req),
    onSuccess: () => void inv.sidebar(),
  });
}

export function useLaunchReview(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: ReviewLaunchRequest) =>
      window.kirby.launchReviewAgent(req),
    onSuccess: () => {
      void inv.sidebar();
      void inv.branches();
    },
  });
}

export function useUpdateDraft(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: ({
      prId,
      id,
      patch,
    }: {
      prId: number;
      id: string;
      patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>;
    }) => window.kirby.updateDraftComment(prId, id, patch),
    onSettled: (_r, _e, v) => void inv.drafts(v.prId),
  });
}

export function useDeleteDraft(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: ({ prId, id }: { prId: number; id: string }) =>
      window.kirby.deleteDraftComment(prId, id),
    onSettled: (_r, _e, v) => void inv.drafts(v.prId),
  });
}

export function usePostDrafts(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: PostDraftsRequest) => window.kirby.postDraftComments(req),
    onSettled: (_r, _e, v) => {
      void inv.drafts(v.prId);
      // The posted comments become remote threads.
      void inv.threads(v.prId);
    },
  });
}

export function useKillSession(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (name: string) => window.kirby.killSession(name),
    onSuccess: () => void inv.sidebar(),
  });
}

export function useRefreshRemote(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: () => window.kirby.refreshRemote(),
    onSettled: () => {
      void inv.sidebar();
      void inv.sync();
    },
  });
}

export function useReply(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: ReplyRequest) => window.kirby.replyToThread(req),
    onSuccess: (_r, req) => void inv.threads(req.prId),
  });
}

export function useSetResolved(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: ResolveRequest) => window.kirby.setThreadResolved(req),
    onSuccess: (_r, req) => void inv.threads(req.prId),
  });
}

export function useUpdateSetting(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: ({
      ref,
      value,
    }: {
      ref: { label: string; key: string };
      value: string;
    }) => window.kirby.updateSettingsField(ref, value),
    onSettled: () => void inv.settings(),
  });
}
