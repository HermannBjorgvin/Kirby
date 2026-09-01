import { CornerDownRightIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  RemoteCommentReply,
  RemoteCommentThread,
} from '../../../../host/contract.js';
import { snapshotRemote } from '@kirby/core/plan';
import { usePlan, usePlanControls } from '../../../lib/plan/plan.js';
import { useRepo } from '../../../lib/repo-context.js';
import { useReply, useSetResolved } from '../../../lib/data/mutations.js';
import {
  threadExpanded,
  threadLocation,
} from '../../../lib/diff/thread-model.js';
import { cn, errorMessage, relativeTime } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { Badge } from '../../ui/badge.js';
import { CommentBody } from './CommentBody.js';
import { ThreadSummary } from './ThreadSummary.js';
import { PlanAttachment } from '../PlanControls.js';
import { ThreadFooter } from './ThreadFooter.js';
import { useComposerRefresh } from './use-composer-refresh.js';

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
  // Opening the box refetches the thread, so a reply is never written
  // against a conversation that has already moved on.
  const refresh = useComposerRefresh(prId, thread.comments.length);
  const openComposer = (next: boolean) => {
    setComposing(next);
    if (next) refresh.begin();
    else refresh.end();
  };
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

  // The notice belongs to a composer the reader can actually see. The
  // footer lives inside the expanded branch while `composing` and the
  // baseline live out here, so collapsing a card mid-reply would leave
  // the baseline armed — and any later refetch of this pull request
  // would greet the reader, on re-expanding, with news of a check they
  // never asked for.
  const composerVisible = expanded && composing;
  const { end: endRefresh } = refresh;
  useEffect(() => {
    if (!composerVisible) endRefresh();
  }, [composerVisible, endRefresh]);

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
          openComposer(false);
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
            setComposing={openComposer}
            notice={refresh.notice}
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
        <CommentBody markdown={comment.body} />
      </div>
    </article>
  );
}
