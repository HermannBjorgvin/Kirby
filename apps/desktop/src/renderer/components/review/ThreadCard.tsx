import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  MessageSquareIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  RemoteCommentReply,
  RemoteCommentThread,
} from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useReply, useSetResolved } from '../../lib/queries.js';
import { cn, errorMessage, relativeTime } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';
import { CommentMarkdown } from './CommentMarkdown.js';

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
  const expanded = override ?? (focused || !thread.isResolved);
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

  const location =
    thread.file != null
      ? `${thread.file}${
          thread.lineStart != null ? `:${thread.lineStart}` : ''
        }`
      : null;

  return (
    <div
      ref={ref}
      data-thread={thread.id}
      className={cn(
        'max-w-[900px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-shadow',
        thread.isResolved ? 'border-success/30' : 'border-border',
        focused && 'ring-2 ring-primary/50'
      )}
    >
      {/* Summary header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-sm',
          thread.isResolved ? 'bg-success/5' : 'bg-muted/40',
          expanded && 'border-b border-border'
        )}
      >
        <button
          onClick={() => setOverride(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">{root.author}</span>
          {showLocation && location && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {location}
            </span>
          )}
          {!expanded && (
            <span className="min-w-0 truncate text-muted-foreground">
              — {root.body.split('\n').find((l) => l.trim()) ?? ''}
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {thread.comments.length} comment
            {thread.comments.length === 1 ? '' : 's'}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1">
          {thread.isOutdated && <Badge variant="outline">Outdated</Badge>}
          {thread.isResolved && (
            <Badge variant="success">
              <CheckCircle2Icon /> Resolved
            </Badge>
          )}
        </span>
      </div>

      {expanded && (
        <>
          <div className="divide-y divide-border">
            <Message comment={root} />
            {replies.map((r) => (
              <Message key={r.id} comment={r} reply />
            ))}
          </div>

          {/* Footer: reply + resolve */}
          <div className="flex items-start gap-2 border-t border-border bg-muted/20 px-3 py-2">
            {composing ? (
              <div className="flex flex-1 flex-col gap-2">
                <Textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      send();
                    }
                    if (e.key === 'Escape') setComposing(false);
                  }}
                  placeholder="Write a reply… Markdown supported. ⌘/Ctrl+Enter to send."
                  className="min-h-20 bg-background"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setComposing(false)}
                  >
                    Cancel
                  </Button>
                  {thread.canResolve && !thread.isResolved && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => send(true)}
                      disabled={reply.isPending || !draft.trim()}
                    >
                      <CheckIcon /> Reply & resolve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => send()}
                    disabled={reply.isPending || !draft.trim()}
                  >
                    {reply.isPending ? 'Sending…' : 'Reply'}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setComposing(true)}
                className="flex h-7 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm text-muted-foreground hover:border-ring"
              >
                <CornerDownRightIcon className="size-3.5" />
                Reply…
              </button>
            )}
            {thread.canResolve && !composing && (
              <Button
                variant={thread.isResolved ? 'ghost' : 'outline'}
                size="sm"
                onClick={toggleResolved}
                disabled={resolve.isPending}
              >
                {thread.isResolved ? (
                  <>
                    <RotateCcwIcon /> Reopen
                  </>
                ) : (
                  <>
                    <CheckIcon /> Resolve
                  </>
                )}
              </Button>
            )}
          </div>
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
        <CommentMarkdown markdown={comment.body} />
      </div>
    </article>
  );
}
