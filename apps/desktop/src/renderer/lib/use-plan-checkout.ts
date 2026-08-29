import { useCallback, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import {
  composePlanPrompt,
  planItemKey,
  snapshotLocal,
  snapshotRemote,
  type PlanItem,
} from '@kirby/core/plan';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../host/contract.js';
import { usePlan, type PlanApi } from './plan.js';
import { planSummary } from './plan-model.js';
import { useCheckoutPlan } from './queries.js';
import { estimateTerminalGrid } from './terminal-grid.js';
import { errorMessage } from './utils.js';

/**
 * Everything the review workspace needs in order to show a plan and
 * send it: the queue for this pull request, and the checkout call.
 *
 * A hook rather than inline wiring because the workspace component is
 * already the busiest thing in the renderer, and none of this is about
 * layout.
 */
/** A request to open one row's note composer. Identity is the signal. */
export interface NoteRequest {
  key: string;
}

export interface PlanPaneWiring {
  items: PlanItem[];
  agentRunning: boolean;
  sending: boolean;
  onRemove: (item: PlanItem) => void;
  onAnnotate: (item: PlanItem, note: string) => void;
  onShowInDiff: (item: PlanItem) => void;
  onClear: () => void;
  onSend: (mode: 'inject' | 'new-session') => void;
  /** Row whose note composer should open (a rail request). */
  openNoteFor: NoteRequest | null;
}

export function usePlanCheckout({
  cwd,
  pr,
  running,
  paneRef,
  threads,
  drafts,
  onSent,
  onShowInDiff,
  onOpenPlan,
}: {
  cwd: string;
  /** Absent on a bare worktree tab, which has no plan. */
  pr?: PullRequestInfo;
  running: boolean;
  /** Measured to size the PTY when the send starts an agent. */
  paneRef: RefObject<HTMLDivElement | null>;
  /** Every remote thread on the PR, inline and general — what a
   *  comment id from the rail has to be resolved against. */
  threads: readonly RemoteCommentThread[];
  drafts: readonly ReviewComment[];
  /** Called once the plan has reached the agent. */
  onSent: () => void;
  onShowInDiff: (item: PlanItem) => void;
  /** Show the plan pane — the rail has nowhere to compose a note. */
  onOpenPlan: () => void;
}): {
  count: number;
  noted: number;
  /** The bound queue, for callers that add and remove directly. */
  api: PlanApi;
  /** Right-click on a rail comment row. */
  onCommentContextMenu: (id: string) => void;
  wiring?: PlanPaneWiring;
} {
  const plan = usePlan(pr?.id ?? 0);
  const checkout = useCheckoutPlan(cwd);
  const { count, noted } = planSummary(plan.items);
  // A fresh object per request, not just the row's key: asking for a
  // note on the same row twice has to reopen the composer, and an
  // unchanged key would look like nothing happened.
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);

  /**
   * Queue a comment straight from the rail's list, without having to
   * find its card in the diff first. "with a note" has nowhere to
   * compose in the rail, so it opens the plan pane on that row.
   */
  const onCommentContextMenu = useCallback(
    (id: string) => {
      const thread = threads.find((t) => t.id === id);
      const draft = thread ? undefined : drafts.find((d) => d.id === id);
      const item = thread
        ? snapshotRemote(thread)
        : draft
        ? snapshotLocal(draft)
        : null;
      if (!item) return;
      const queued = plan.has(item.kind, item.id);
      void window.kirby
        .showContextMenu([
          { id: 'toggle', label: queued ? 'Remove from plan' : 'Add to plan' },
          {
            id: 'note',
            label: queued ? 'Edit note…' : 'Add to plan with a note…',
          },
        ])
        .then((chosen) => {
          if (chosen === 'toggle') {
            if (queued) plan.removeWithUndo(item);
            else plan.add(item);
          } else if (chosen === 'note') {
            plan.add(item);
            setNoteRequest({ key: planItemKey(item.kind, item.id) });
            onOpenPlan();
          }
        });
    },
    [threads, drafts, plan, onOpenPlan]
  );

  const send = useCallback(
    (mode: 'inject' | 'new-session') => {
      if (!pr || plan.items.length === 0) return;
      const rect = paneRef.current?.getBoundingClientRect();
      checkout.mutate(
        {
          pr,
          // Composed from the same items the pane just previewed.
          // Composing again on the host is how a preview and a
          // delivery drift apart.
          prompt: composePlanPrompt(plan.items),
          mode,
          ...(rect ? estimateTerminalGrid(rect, 0.6) : {}),
        },
        {
          onSuccess: (result) => {
            // Only on success: a failed send leaves the plan intact so
            // it can be retried without rebuilding it.
            plan.clear();
            onSent();
            toast.success(
              result === 'injected'
                ? 'Plan sent to the agent'
                : 'Agent started with the plan'
            );
          },
          onError: (e) => toast.error(errorMessage(e)),
        }
      );
    },
    [pr, plan, checkout, paneRef, onSent]
  );

  if (!pr) return { count: 0, noted: 0, api: plan, onCommentContextMenu };
  return {
    count,
    noted,
    api: plan,
    onCommentContextMenu,
    wiring: {
      items: plan.items,
      agentRunning: running,
      sending: checkout.isPending,
      onRemove: plan.removeWithUndo,
      onAnnotate: (item, note) => plan.annotate(item.kind, item.id, note),
      onShowInDiff,
      onClear: plan.clear,
      onSend: send,
      openNoteFor: noteRequest,
    },
  };
}
