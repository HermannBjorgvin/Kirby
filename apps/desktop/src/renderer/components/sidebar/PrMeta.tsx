import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  CircleSlashIcon,
  MessageSquareIcon,
  XCircleIcon,
} from 'lucide-react';
import {
  isBlockingDecision,
  type PullRequestInfo,
} from '@kirby/vcs-core/types';
import {
  prStatusIndicator,
  type StatusGlyph,
  type StatusTone,
  unresolvedCommentsLabel,
} from '../../lib/sidebar-model.js';
import { cn } from '../../lib/utils.js';
import { Tip } from '../ui/tooltip.js';

/**
 * Right-aligned status cluster. One circle carries both axes — its
 * colour is the worst thing standing in the way, its glyph says which
 * axis that is — followed by the approval count, which keeps approvals
 * legible even while the glyph is showing CI, and the unresolved
 * comment count.
 */
const TONE_CLASS: Record<StatusTone, string | undefined> = {
  red: 'text-destructive',
  yellow: 'text-warning',
  green: 'text-success',
  muted: undefined,
};

function StatusGlyphIcon({
  glyph,
  filled,
}: {
  glyph: StatusGlyph;
  filled: boolean;
}) {
  const size = 'size-3.5';
  switch (glyph) {
    case 'rejected':
      return <CircleSlashIcon className={size} />;
    case 'waiting':
      return <CircleAlertIcon className={size} />;
    case 'ci-failed':
      return <XCircleIcon className={size} />;
    case 'ci-running':
      return <CircleDotIcon className={cn(size, 'animate-pulse')} />;
    case 'ci-absent':
      return <CircleDashedIcon className={size} />;
    case 'partial':
      return <CircleIcon className={size} />;
    default:
      return (
        <CheckCircle2Icon className={cn(size, filled && 'fill-current')} />
      );
  }
}

export function PrMeta({ pr }: { pr: PullRequestInfo }) {
  const status = prStatusIndicator(
    pr.reviewers ?? [],
    pr.buildStatus,
    isBlockingDecision
  );
  const comments = pr.activeCommentCount ?? 0;

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Tip label={status.label}>
        <span
          className={cn(
            'flex items-center gap-0.5 tabular-nums',
            TONE_CLASS[status.tone]
          )}
        >
          <StatusGlyphIcon glyph={status.glyph} filled={status.filled} />
          {status.total > 0 && (
            <>
              {status.approved}/{status.total}
            </>
          )}
        </span>
      </Tip>
      {comments > 0 && (
        <Tip label={unresolvedCommentsLabel(comments)}>
          <span className="flex items-center gap-0.5 tabular-nums">
            <MessageSquareIcon className="size-3" />
            {comments}
          </span>
        </Tip>
      )}
    </div>
  );
}
