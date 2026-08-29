import { useCallback, type RefObject } from 'react';
import { toast } from 'sonner';
import { composePlanPrompt, type PlanItem } from '@kirby/core/plan';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { usePlan } from './plan.js';
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
export interface PlanPaneWiring {
  items: PlanItem[];
  agentRunning: boolean;
  sending: boolean;
  onRemove: (item: PlanItem) => void;
  onAnnotate: (item: PlanItem, note: string) => void;
  onShowInDiff: (item: PlanItem) => void;
  onClear: () => void;
  onSend: (mode: 'inject' | 'new-session') => void;
}

export function usePlanCheckout({
  cwd,
  pr,
  running,
  paneRef,
  onSent,
  onShowInDiff,
}: {
  cwd: string;
  /** Absent on a bare worktree tab, which has no plan. */
  pr?: PullRequestInfo;
  running: boolean;
  /** Measured to size the PTY when the send starts an agent. */
  paneRef: RefObject<HTMLDivElement | null>;
  /** Called once the plan has reached the agent. */
  onSent: () => void;
  onShowInDiff: (item: PlanItem) => void;
}): { count: number; noted: number; wiring?: PlanPaneWiring } {
  const plan = usePlan(pr?.id ?? 0);
  const checkout = useCheckoutPlan(cwd);
  const { count, noted } = planSummary(plan.items);

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

  if (!pr) return { count: 0, noted: 0 };
  return {
    count,
    noted,
    wiring: {
      items: plan.items,
      agentRunning: running,
      sending: checkout.isPending,
      onRemove: plan.removeWithUndo,
      onAnnotate: (item, note) => plan.annotate(item.kind, item.id, note),
      onShowInDiff,
      onClear: plan.clear,
      onSend: send,
    },
  };
}
