import { BotIcon } from 'lucide-react';
import type { ReviewComment } from '../../../../host/contract.js';
import type { usePlanControls } from '../../../lib/plan/plan.js';
import { cn, relativeTime } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { SEVERITY_BADGE } from '../../../lib/review/severity.js';
import { PlanControls } from '../PlanControls.js';

/**
 * The draft's identity row: who wrote it, how bad it is, where it goes,
 * and — when the agent wrote it in answer to an existing review thread
 * — which conversation it is about. `threadId` is the provider's own
 * id, the same string the plan prompt hands the agent, so a reader can
 * tell at a glance that a draft belongs to a discussion rather than
 * opening a new one.
 */
export function DraftHeader({
  draft,
  location,
  plan,
}: {
  draft: ReviewComment;
  /** Already null when the caller does not want it shown. */
  location: string | null;
  plan: ReturnType<typeof usePlanControls>;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm',
        plan.inPlan ? 'bg-primary/5' : 'bg-muted/40'
      )}
    >
      <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">Draft</span>
      <Badge variant={SEVERITY_BADGE[draft.severity]}>{draft.severity}</Badge>
      {location && (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {location}
        </span>
      )}
      {draft.threadId && (
        <span
          className="shrink-0 rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground"
          title={`Answers review thread ${draft.threadId}`}
        >
          ↩ {draft.threadId}
        </span>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        {relativeTime(draft.createdAt)}
      </span>
      <PlanControls
        inPlan={plan.inPlan}
        hasNote={plan.note !== undefined}
        onToggle={plan.toggleInPlan}
        onNote={plan.startNote}
      />
    </div>
  );
}
