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
    settings: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.settings(cwd) }),
        // The picker's default row follows the configured agent.
        qc.invalidateQueries({ queryKey: keys.agentOptions(cwd) }),
      ]),
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
    // The host already re-read the pull request list as part of
    // submitting the verdict — plain invalidation would refetch the
    // sidebar from a TTL cache (prPollInterval, a minute by default)
    // and hand back pre-verdict reviewers, reverting the optimistic
    // patch a frame later. Asking for a *refresh* here as well would
    // spend a second forced cycle, and tell the provider to forget
    // rows a vote changed nothing about.
    onSettled: () => {
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

// A babysat pull request's status rides on its sidebar item, so the
// row's badge appears — and goes — with the sidebar's refetch.
export function useStartBabysit(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => window.kirby.startBabysit(prId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
    },
  });
}

export function useStopBabysit(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => window.kirby.stopBabysit(prId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
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

/**
 * Refetch a pull request's comment threads, as an action rather than a
 * cadence.
 *
 * Opening a reply box is the moment being stale actually costs
 * something: `useThreads` serves a cache up to half a minute old, and
 * answering a question somebody already answered is how a review
 * thread turns into two conversations. Invalidating that one query is
 * enough — the cards read from it, so anything that arrived paints
 * itself; the caller only has to know when the round trip is done, and
 * a mutation is what carries that `isPending`.
 *
 * `refetchType: 'active'` so the returned promise settles on the
 * mounted query's refetch, not on the whole cache going stale.
 */
export function useRefreshThreads(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) =>
      qc.invalidateQueries({
        queryKey: keys.threads(cwd, prId),
        refetchType: 'active',
      }),
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
