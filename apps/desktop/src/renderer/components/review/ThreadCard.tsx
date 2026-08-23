import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import type { RemoteCommentThread } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useReply, useSetResolved } from '../../lib/queries.js';
import { cn, errorMessage, relativeTime } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';

function Body({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-base leading-snug prose-p:my-1 prose-pre:my-2 prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none prose-a:text-primary prose-headings:my-2 prose-img:my-2 prose-img:max-h-80 prose-img:rounded">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}

/**
 * One review thread (root + replies) with an inline reply composer and
 * resolve/reopen. Resolved threads start collapsed to a one-line
 * summary; `focused` (thread navigator / comment list) expands and
 * flashes the card.
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
  const setExpanded = (next: boolean | ((e: boolean) => boolean)) =>
    setOverride(typeof next === 'function' ? next(expanded) : next);
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
        'rounded-md border bg-card text-card-foreground shadow-xs transition-shadow',
        thread.isResolved ? 'border-success/30' : 'border-border',
        focused && 'ring-2 ring-primary/50'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Avatar name={root.author} size="xs" />
          <span className="font-medium">{root.author}</span>
          <span className="text-muted-foreground">
            {relativeTime(root.createdAt)}
          </span>
          {showLocation && location && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {location}
            </span>
          )}
          {!expanded && (
            <span className="min-w-0 truncate text-muted-foreground">
              — {root.body.split('\n')[0]}
            </span>
          )}
          {replies.length > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}
            </span>
          )}
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
          <div className="px-3 pb-2 pl-9">
            <Body markdown={root.body} />
          </div>

          {replies.length > 0 && (
            <div className="mx-3 mb-2 ml-9 space-y-2 border-l-2 border-border pl-3">
              {replies.map((r) => (
                <div key={r.id}>
                  <div className="flex items-center gap-2 text-sm">
                    <Avatar name={r.author} size="xs" />
                    <span className="font-medium">{r.author}</span>
                    <span className="text-muted-foreground">
                      {relativeTime(r.createdAt)}
                    </span>
                  </div>
                  <Body markdown={r.body} />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 border-t border-border px-3 py-2">
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
                  className="min-h-16"
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
