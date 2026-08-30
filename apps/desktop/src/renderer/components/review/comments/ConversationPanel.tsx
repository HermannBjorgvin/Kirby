import {
  ChevronDownIcon,
  ChevronRightIcon,
  MessagesSquareIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { RemoteCommentThread } from '../../../../host/contract.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ThreadCard } from './ThreadCard.js';

/** General (non-inline) PR comments, collapsible above the diff. */
export function ConversationPanel({
  threads,
  loading,
  prId,
  focusThreadId,
}: {
  threads: RemoteCommentThread[];
  loading: boolean;
  prId: number;
  focusThreadId: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-1.5 px-2 text-sm hover:bg-accent/60"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        )}
        <MessagesSquareIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Conversation</span>
        {!loading && (
          <span className="text-muted-foreground">({threads.length})</span>
        )}
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-3">
          {loading && threads.length === 0 && (
            <Skeleton className="h-16 w-full" />
          )}
          {threads.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              prId={prId}
              focused={t.id === focusThreadId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
