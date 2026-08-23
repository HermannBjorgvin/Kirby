import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { RemoteCommentThread } from '../../../host/contract.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';

/**
 * Overview of every thread on the PR (inline + general), open ones
 * first, as a jump list under the file tree.
 */
export function CommentsList({
  threads,
  general,
  activeId,
  onJump,
}: {
  threads: RemoteCommentThread[];
  general: RemoteCommentThread[];
  activeId: string | null;
  onJump: (thread: RemoteCommentThread) => void;
}) {
  const [open, setOpen] = useState(true);
  const all = [...general, ...threads];
  const sorted = [...all].sort(
    (a, b) => Number(a.isResolved) - Number(b.isResolved)
  );
  const openCount = all.filter((t) => !t.isResolved).length;
  if (all.length === 0) return null;

  return (
    <div className="flex min-h-0 flex-col border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        <MessageSquareIcon className="size-3.5" />
        Comments
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums">
          {openCount} open · {all.length}
        </span>
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {sorted.map((t) => {
            const root = t.comments[0];
            if (!root) return null;
            const where =
              t.file != null
                ? `${t.file.split('/').pop()}${
                    t.lineStart != null ? `:${t.lineStart}` : ''
                  }`
                : 'Conversation';
            return (
              <button
                key={t.id}
                onClick={() => onJump(t)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent',
                  activeId === t.id && 'bg-sidebar-active',
                  t.isResolved && 'opacity-60'
                )}
              >
                <Avatar name={root.author} size="xs" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {root.author}
                    </span>
                    <span className="truncate font-mono">{where}</span>
                    {t.isResolved && (
                      <CheckCircle2Icon className="ml-auto size-3 shrink-0 text-success" />
                    )}
                  </span>
                  <span className="line-clamp-2 text-sm leading-snug">
                    {root.body}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
