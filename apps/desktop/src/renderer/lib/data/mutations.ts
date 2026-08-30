import { useMemo } from 'react';
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from './query-keys.js';
import { verdictDecision } from '../review/review-verdict.js';
import { errorMessage } from '../utils.js';
import type {
  PlanCheckoutRequest,
  PostDraftsRequest,
  PullRequestComments,
  ReplyRequest,
  ResolveRequest,
  ReviewComment,
  ReviewLaunchRequest,
  ReviewVerdict,
  SessionLaunchRequest,
  SidebarItem,
} from '../../../host/contract.js';

/**
 * The renderer's writes: every host call that changes something, with
 * the invalidation each one owes the queries in `queries.ts`.
 */

// ── Invalidation ─────────────────────────────────────────────────

function useInvalidator(cwd: string) {
  const qc = useQueryClient();
  return {
    sidebar: () => qc.invalidateQueries({ queryKey: keys.sidebar(cwd) }),
    sync: () => qc.invalidateQueries({ queryKey: keys.sync(cwd) }),
    branches: () => qc.invalidateQueries({ queryKey: keys.branches(cwd) }),
    sessions: () => qc.invalidateQueries({ queryKey: keys.sessions(cwd) }),
    settings: () => qc.invalidateQueries({ queryKey: keys.settings(cwd) }),
    threads: (prId: number) =>
      qc.invalidateQueries({ queryKey: keys.threads(cwd, prId) }),
    drafts: (prId: number) =>
      qc.invalidateQueries({ queryKey: keys.drafts(cwd, prId) }),
  };
}

// ── Mutations ────────────────────────────────────────────────────

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
    onSuccess: () => {
      void inv.sidebar();
      void inv.sessions();
    },
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
      void inv.sessions();
    },
  });
}

/**
 * Send a plan to the PR's agent. Invalidates the sidebar because a
 * spawn turns a review PR into a session row, and the branch list
 * because the checkout may have created the worktree.
 */
export function useCheckoutPlan(cwd: string) {
  const inv = useInvalidator(cwd);
  return useMutation({
    mutationFn: (req: PlanCheckoutRequest) => window.kirby.checkoutPlan(req),
    onSuccess: () => {
      void inv.sidebar();
      void inv.branches();
      void inv.sessions();
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
    onSuccess: () => {
      void inv.sidebar();
      void inv.sessions();
    },
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
