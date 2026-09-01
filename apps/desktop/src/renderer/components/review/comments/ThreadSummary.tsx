import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { commentBodyParts } from '@kirby/review-comments/conventional';
import type { RemoteCommentThread } from '../../../../host/contract.js';
import { firstNonEmptyLine } from '../../../lib/diff/thread-model.js';
import { cn } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { PlanControls } from '../PlanControls.js';

/**
 * The thread's id, to copy.
 *
 * This is the string the provider knows the conversation by — a GitHub
 * review-thread node id, an Azure DevOps thread id — and the same one
 * an agent is given in a plan prompt and hands back through
 * `kirby util add-comment --thread=…`. Having it on the card is what
 * lets a reader point an agent at *this* conversation rather than
 * describing where it is.
 *
 * Shown truncated, because it is an identifier and not prose; the full
 * value is in the tooltip and on the clipboard.
 */
export function ThreadIdButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      title={`Thread id: ${id} — click to copy`}
      aria-label={`Copy thread id ${id}`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(id);
        toast.success('Thread id copied');
      }}
      className="hidden shrink-0 items-center gap-1 rounded px-1 font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/card:opacity-100 focus-visible:opacity-100 sm:flex"
    >
      <span className="max-w-24 truncate">{id}</span>
      <CopyIcon className="size-3 shrink-0" />
    </button>
  );
}

/**
 * The card's collapsed-state row: disclosure, author, location, a
 * one-line preview while closed, and the outdated/resolved badges.
 */
export function ThreadSummary({
  thread,
  author,
  preview,
  location,
  expanded,
  onToggle,
  inPlan,
  hasNote,
  onTogglePlan,
  onNote,
}: {
  thread: RemoteCommentThread;
  author: string;
  preview: string;
  /** Already null when the caller does not want it shown. */
  location: string | null;
  expanded: boolean;
  onToggle: () => void;
  inPlan: boolean;
  hasNote: boolean;
  onTogglePlan: () => void;
  onNote: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm',
        inPlan
          ? 'bg-primary/5'
          : thread.isResolved
          ? 'bg-success/5'
          : 'bg-muted/40',
        expanded && 'border-b border-border'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{author}</span>
        {location && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {location}
          </span>
        )}
        {!expanded && (
          <span className="min-w-0 truncate text-muted-foreground">
            {/* The prose, not the raw header: a collapsed card has one
                line to say what the comment is about, and spending it
                on "issue (blocking):" says only what the badge does. */}
            — {firstNonEmptyLine(commentBodyParts(preview).body)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {thread.comments.length} comment
          {thread.comments.length === 1 ? '' : 's'}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        <ThreadIdButton id={thread.id} />
        <PlanControls
          inPlan={inPlan}
          hasNote={hasNote}
          onToggle={onTogglePlan}
          onNote={onNote}
        />
        {thread.isOutdated && <Badge variant="outline">Outdated</Badge>}
        {thread.isResolved && (
          <Badge variant="success">
            <CheckCircle2Icon /> Resolved
          </Badge>
        )}
      </span>
    </div>
  );
}
