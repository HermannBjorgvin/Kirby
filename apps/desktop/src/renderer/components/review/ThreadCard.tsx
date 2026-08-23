import { CheckIcon, CornerDownRightIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
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
    <div className="prose prose-sm dark:prose-invert max-w-none text-base leading-snug prose-p:my-1 prose-pre:my-2 prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none prose-a:text-primary prose-headings:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}

/**
 * One review thread (root + replies) with an inline reply composer and
 * resolve/reopen. Markdown rendered; links open externally via the
 * window-open handler in main.
 */
export function ThreadCard({
  thread,
  prId,
  showLocation = false,
}: {
  thread: RemoteCommentThread;
  prId: number;
  showLocation?: boolean;
}) {
  const { repo } = useRepo();
  const reply = useReply(repo.cwd);
  const resolve = useSetResolved(repo.cwd);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const root = thread.comments[0];
  if (!root) return null;

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    reply.mutate(
      { prId, thread, body },
      {
        onSuccess: () => {
          setDraft('');
          setComposing(false);
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
      className={cn(
        'rounded-md border bg-card text-card-foreground shadow-xs',
        thread.isResolved ? 'border-success/30' : 'border-border'
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-2 text-sm">
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
        <span className="ml-auto flex items-center gap-1">
          {thread.isOutdated && <Badge variant="outline">Outdated</Badge>}
          {thread.isResolved && <Badge variant="success">Resolved</Badge>}
        </span>
      </div>
      <div className="px-3 pb-2">
        <Body markdown={root.body} />
      </div>

      {thread.comments.length > 1 && (
        <div className="mx-3 mb-2 space-y-2 border-l-2 border-border pl-3">
          {thread.comments.slice(1).map((r) => (
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
              placeholder="Write a reply… (⌘/Ctrl+Enter to send)"
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
              <Button
                size="sm"
                onClick={send}
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
    </div>
  );
}
