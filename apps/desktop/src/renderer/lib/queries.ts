import { useMemo } from 'react';
import {
  QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from './utils.js';
import type { ReviewDecision } from '@kirby/vcs-core/types';
import type {
  PostDraftsRequest,
  PullRequestComments,
  ReplyRequest,
  ResolveRequest,
  ReviewComment,
  ReviewLaunchRequest,
  ReviewVerdict,
  SessionLaunchRequest,
  SidebarItem,
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
  worktreeDiff: (cwd: string, branch: string, target: string) =>
    ['worktree-diff', cwd, branch, target] as const,
  threads: (cwd: string, prId: number) => ['threads', cwd, prId] as const,
  prDescription: (cwd: string, prId: number) =>
    ['pr-description', cwd, prId] as const,
  activity: (cwd: string) => ['session-activity', cwd] as const,
  commentImage: (url: string) => ['comment-image', url] as const,
  drafts: (cwd: string, prId: number) => ['drafts', cwd, prId] as const,
  reviewViewer: (cwd: string) => ['review-viewer', cwd] as const,
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

export function useDiff(
  cwd: string,
  source: string,
  target: string,
  opts: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: keys.diff(cwd, source, target),
    queryFn: () => window.kirby.fetchDiffText(source, target),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}

/**
 * The working state of a worktree, refreshed while its agent runs so
 * the diff tracks what the agent is doing instead of what it last
 * committed.
 *
 * This is deliberately a different query from `useDiff`, not a mode of
 * it. A pull request is reviewed against its commits — that is what the
 * comments anchor to and what the author asked to have read — so a PR
 * tab must not start showing somebody's uncommitted scratch work. Only
 * a worktree without a PR gets the live view.
 *
 * Polled rather than watched: a recursive `fs.watch` over a checkout
 * means an inotify handle per directory, and `node_modules` alone
 * exhausts the default budget on Linux. The interval matches the draft
 * comment poll, and stops when the agent does — an idle worktree only
 * changes when the user does something the app already invalidates on.
 */
export function useWorktreeDiff(
  cwd: string,
  branch: string,
  target: string,
  opts: { enabled: boolean; live: boolean }
) {
  return useQuery({
    queryKey: keys.worktreeDiff(cwd, branch, target),
    queryFn: () => window.kirby.fetchWorktreeDiffText(branch, target),
    enabled: opts.enabled,
    refetchInterval: opts.live ? 2_000 : false,
    // Keep the previous patch on screen while the next one is in
    // flight, so a poll does not blank the viewer every two seconds.
    placeholderData: (prev) => prev,
    staleTime: 0,
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

/** Debounced per-session agent activity (spinner/blink source). The
 *  snapshot is an in-memory read host-side, so a 1s poll is cheap. */
export function useSessionActivity(cwd: string) {
  return useQuery({
    queryKey: keys.activity(cwd),
    queryFn: () => window.kirby.getSessionActivity(),
    refetchInterval: 1_000,
    placeholderData: (prev) => prev,
  });
}

export function usePrDescription(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.prDescription(cwd, prId),
    queryFn: () => window.kirby.fetchPrDescription(prId),
    staleTime: 5 * 60_000,
    enabled: prId > 0,
  });
}

/** What the viewer's reviewer entry becomes for a cast verdict. GitHub
 *  folds the whole negative side into a changes-requested review. */
function verdictDecision(
  verdict: ReviewVerdict,
  providerId: string | undefined
): ReviewDecision {
  if (verdict === 'approve' || verdict === 'approve-with-suggestions')
    return 'approved';
  if (providerId === 'github') return 'changes-requested';
  return verdict === 'wait-for-author' ? 'waiting-for-author' : 'rejected';
}

export function useSubmitVerdict(cwd: string, providerId?: string) {
  const qc = useQueryClient();
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: ({ prId, verdict }: { prId: number; verdict: ReviewVerdict }) =>
      window.kirby.submitReviewVerdict(prId, verdict),
    // Optimistic: the vote succeeds virtually always, so reflect it in
    // the cached sidebar model immediately (reviewer dots, PR bar and
    // row badges all derive from it) and roll back only on error.
    onMutate: async ({ prId, verdict }) => {
      const viewer = await qc
        .fetchQuery({
          queryKey: keys.reviewViewer(cwd),
          queryFn: () => window.kirby.getReviewViewer(),
          staleTime: Infinity,
        })
        .catch(() => null);
      if (!viewer) return { prev: undefined };
      const key = keys.sidebar(cwd);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<SidebarItem[]>(key);
      if (prev) {
        const decision = verdictDecision(verdict, providerId);
        const me = viewer.identifier.toLowerCase();
        qc.setQueryData<SidebarItem[]>(
          key,
          prev.map((item) => {
            if (item.pr?.id !== prId) return item;
            const reviewers = item.pr.reviewers ?? [];
            const mine = reviewers.some(
              (r) => r.identifier.toLowerCase() === me
            );
            const next = mine
              ? reviewers.map((r) =>
                  r.identifier.toLowerCase() === me ? { ...r, decision } : r
                )
              : [
                  ...reviewers,
                  {
                    identifier: viewer.identifier,
                    displayName: 'You',
                    decision,
                  },
                ];
            return { ...item, pr: { ...item.pr, reviewers: next } };
          })
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.sidebar(cwd), ctx.prev);
    },
    // Re-read the PR from the provider, not from the host's cache.
    // Plain invalidation refetches the sidebar, but that path serves
    // remote data from a TTL cache (prPollInterval, a minute by
    // default) — it would hand back pre-verdict reviewers and revert
    // the optimistic patch a frame later, every time.
    onSettled: async () => {
      try {
        await window.kirby.refreshRemote();
      } catch {
        // Offline or provider hiccup: keep the optimistic state and let
        // the next poll reconcile rather than reverting to stale data.
      }
      void inv.sidebar();
    },
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

/** Mutation key for worktree removal, so `useRemovingBranches` can see
 *  which removals are in flight. */
const REMOVE_WORKTREE_KEY = ['remove-worktree'] as const;

export function useRemoveWorktree(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationKey: REMOVE_WORKTREE_KEY,
    mutationFn: ({ branch, force }: { branch: string; force: boolean }) =>
      window.kirby.removeWorktree(branch, force),
    // Reported here rather than through `mutate`'s own callbacks: the
    // confirm dialog closes as soon as it fires, and per-call callbacks
    // are dropped when their component unmounts. Mutation-level ones run
    // either way, so the outcome is never swallowed.
    onSuccess: (_r, { branch }) => toast.success(`Removed worktree ${branch}`),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => {
      void inv.sidebar();
      void inv.branches();
    },
  });
}

/**
 * Branches whose worktree removal is in flight. The sidebar hides their
 * rows so the list reacts the moment the user confirms, instead of after
 * the kill-session + git round-trip.
 *
 * Derived from mutation state rather than patched into the query cache:
 * the sidebar re-polls every few seconds, and a poll landing mid-removal
 * would put the row straight back. This filter also needs no rollback —
 * a failed removal stops being pending, so its row simply returns.
 */
export function useRemovingBranches(): Set<string> {
  const pending = useMutationState({
    filters: { mutationKey: REMOVE_WORKTREE_KEY, status: 'pending' },
    select: (m) =>
      (m.state.variables as { branch: string } | undefined)?.branch,
  });
  return useMemo(
    () => new Set(pending.filter((b): b is string => Boolean(b))),
    [pending]
  );
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

export function useOpenInEditor() {
  return useMutation({
    mutationFn: (branch: string) => window.kirby.openInEditor(branch),
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
  const qc = useQueryClient();
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: ResolveRequest) => window.kirby.setThreadResolved(req),
    // Optimistic: resolving succeeds virtually always, so flip the
    // thread in the cache immediately and roll back only on error.
    onMutate: async (req) => {
      const key = keys.threads(cwd, req.prId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PullRequestComments>(key);
      if (prev) {
        qc.setQueryData<PullRequestComments>(key, {
          ...prev,
          threads: prev.threads.map((t) =>
            t.id === req.thread.id ? { ...t, isResolved: req.resolved } : t
          ),
        });
      }
      return { prev };
    },
    onError: (_e, req, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.threads(cwd, req.prId), ctx.prev);
    },
    onSettled: (_r, _e, req) => void inv.threads(req.prId),
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
