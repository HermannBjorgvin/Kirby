import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { CommentSeverity } from '../../../host/contract.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';

export interface CommentListItem {
  id: string;
  /** 'thread' = a real (remote) comment; 'draft' = an agent draft. */
  kind: 'thread' | 'draft';
  author: string;
  /** "file:line" or "Conversation" for general PR comments. */
  where: string;
  preview: string;
  resolved: boolean;
  severity?: CommentSeverity;
}

const SEVERITY_DOT: Record<CommentSeverity, string> = {
  critical: 'bg-destructive',
  major: 'bg-warning',
  minor: 'bg-info',
  nit: 'bg-muted-foreground/50',
};

/**
 * Jump list of every comment on the PR — remote threads (inline +
 * general) and the agent's drafts — under the file tree. Click to
 * scroll the diff to it. Open items first; drafts flagged.
 */
export function CommentsList({
  items,
  activeId,
  onJump,
}: {
  items: CommentListItem[];
  activeId: string | null;
  onJump: (item: CommentListItem) => void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const openCount = items.filter((i) => !i.resolved).length;
  const draftCount = items.filter((i) => i.kind === 'draft').length;

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
          {draftCount > 0 && `${draftCount} draft · `}
          {openCount} open
        </span>
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onJump(item)}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent',
                activeId === item.id && 'bg-sidebar-active',
                item.resolved && 'opacity-60'
              )}
            >
              {item.kind === 'draft' ? (
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      item.severity ? SEVERITY_DOT[item.severity] : 'bg-primary'
                    )}
                  />
                </span>
              ) : (
                <Avatar name={item.author} size="xs" className="mt-0.5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {item.kind === 'draft' ? (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <BotIcon className="size-3" /> Draft
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">
                      {item.author}
                    </span>
                  )}
                  <span className="truncate font-mono">{item.where}</span>
                  {item.resolved && (
                    <CheckCircle2Icon className="ml-auto size-3 shrink-0 text-success" />
                  )}
                </span>
                <span className="line-clamp-2 text-sm leading-snug">
                  {item.preview}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
