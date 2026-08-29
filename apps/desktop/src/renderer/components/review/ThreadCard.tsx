import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  RemoteCommentReply,
  RemoteCommentThread,
} from '../../../host/contract.js';
import { snapshotRemote } from '@kirby/core/plan';
import { usePlan, usePlanControls } from '../../lib/plan.js';
import { useRepo } from '../../lib/repo-context.js';
import { useReply, useSetResolved } from '../../lib/mutations.js';
import {
  firstNonEmptyLine,
  threadExpanded,
  threadLocation,
} from '../../lib/thread-model.js';
import { cn, errorMessage, relativeTime } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { CommentMarkdown } from './CommentMarkdown.js';
import { PlanAttachment, PlanControls } from './PlanControls.js';
import { ThreadFooter } from './ThreadFooter.js';

/**
 * One review thread. The root comment and every reply render as
 * distinct messages (own header, divider, replies tinted + indented)
 * inside one bordered card with a summary header and a reply footer.
 * Resolved threads start collapsed to the header; `focused` (thread
 * navigator / comment list) expands and outlines the card.
 */
export function ThreadCard({
  thread,
  prId,
  showLocation = false,
  focused = false,
}: {
  thread: RemoteCommentThread;
  prId: number;
  showLocation?: boolean;
  focused?: boolean;
}) {
  const { repo } = useRepo();
  const plan = usePlan(prId);
  const planControls = usePlanControls(
    plan,
    'remote',
    thread.id,
    useCallback(() => snapshotRemote(thread), [thread])
  );
  const reply = useReply(repo.cwd);
  const resolve = useSetResolved(repo.cwd);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  // Expansion: user toggles win until the card is (re)focused, at
  // which point it always opens. Resolved threads start collapsed.
  const [override, setOverride] = useState<boolean | null>(null);
  const [prevFocused, setPrevFocused] = useState(focused);
  if (focused !== prevFocused) {
    setPrevFocused(focused);
    if (focused) setOverride(null);
  }
  const expanded = threadExpanded(override, focused, thread.isResolved);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused)
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  const root = thread.comments[0];
  if (!root) return null;
  const replies = thread.comments.slice(1);

  const send = (alsoResolve = false) => {
    const body = draft.trim();
    if (!body) return;
    reply.mutate(
      { prId, thread, body },
      {
        onSuccess: () => {
          setDraft('');
          setComposing(false);
          if (alsoResolve && thread.canResolve && !thread.isResolved) {
            resolve.mutate(
              { prId, thread, resolved: true },
              { onError: (e) => toast.error(errorMessage(e)) }
            );
          }
        },
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  };

  const toggleResolved = () =>
    resolve.mutate(
      { prId, thread, resolved: !thread.isResolved },
      { onError: (e) => toast.error(errorMessage(e)) }
    );

  const location = threadLocation(thread);

  return (
    <div
      ref={ref}
      data-thread={thread.id}
      className={cn(
        'group/card max-w-[900px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-shadow',
        planControls.inPlan
          ? 'border-primary/40'
          : thread.isResolved
          ? 'border-success/30'
          : 'border-border',
        focused && 'ring-2 ring-primary/50'
      )}
    >
      <ThreadSummary
        thread={thread}
        author={root.author}
        preview={root.body}
        location={showLocation ? location : null}
        expanded={expanded}
        onToggle={() => setOverride(!expanded)}
        inPlan={planControls.inPlan}
        hasNote={planControls.note !== undefined}
        onTogglePlan={planControls.toggleInPlan}
        onNote={() => {
          setOverride(true);
          planControls.startNote();
        }}
      />

      {expanded && (
        <>
          <div className="divide-y divide-border">
            <Message comment={root} />
            {replies.map((r) => (
              <Message key={r.id} comment={r} reply />
            ))}
          </div>

          <PlanAttachment
            composing={planControls.composing}
            note={planControls.note}
            onSave={planControls.saveNote}
            onCancel={planControls.cancelNote}
            onEdit={planControls.startNote}
          />

          <ThreadFooter
            canResolve={thread.canResolve}
            isResolved={thread.isResolved}
            composing={composing}
            setComposing={setComposing}
            draft={draft}
            setDraft={setDraft}
            sending={reply.isPending}
            resolving={resolve.isPending}
            onSend={send}
            onToggleResolved={toggleResolved}
          />
        </>
      )}
    </div>
  );
}

/**
 * The card's collapsed-state row: disclosure, author, location, a
 * one-line preview while closed, and the outdated/resolved badges.
 */
function ThreadSummary({
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
            — {firstNonEmptyLine(preview)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {thread.comments.length} comment
          {thread.comments.length === 1 ? '' : 's'}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
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

/** One comment in a thread: author line, then the markdown body. */
function Message({
  comment,
  reply = false,
}: {
  comment: RemoteCommentReply;
  reply?: boolean;
}) {
  return (
    <article
      className={cn(
        'px-3 py-2.5',
        reply && 'border-l-[3px] border-l-border bg-muted/15 pl-4'
      )}
    >
      <header className="mb-1 flex items-center gap-2 text-sm">
        {reply && (
          <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Avatar name={comment.author} size="sm" />
        <span className="font-medium">{comment.author}</span>
        <span className="text-muted-foreground">
          {reply ? 'replied' : 'commented'} {relativeTime(comment.createdAt)}
        </span>
        {comment.isMinimized && (
          <Badge variant="outline" className="ml-auto">
            Hidden
          </Badge>
        )}
      </header>
      <div
        className={cn(reply ? 'pl-[calc(1.25rem+0.875rem+0.5rem)]' : 'pl-7')}
      >
        <CommentMarkdown markdown={comment.body} />
      </div>
    </article>
  );
}
