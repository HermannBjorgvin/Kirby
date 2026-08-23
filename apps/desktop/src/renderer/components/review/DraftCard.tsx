import {
  BotIcon,
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CommentSeverity, ReviewComment } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useDeleteDraft,
  usePostDrafts,
  useUpdateDraft,
} from '../../lib/queries.js';
import { cn, errorMessage, relativeTime } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Textarea } from '../ui/textarea.js';
import { CommentMarkdown } from './CommentMarkdown.js';

export const SEVERITIES: CommentSeverity[] = [
  'critical',
  'major',
  'minor',
  'nit',
];

const SEVERITY_BADGE: Record<
  CommentSeverity,
  'destructive' | 'warning' | 'info' | 'outline'
> = {
  critical: 'destructive',
  major: 'warning',
  minor: 'info',
  nit: 'outline',
};

const SEVERITY_RAIL: Record<CommentSeverity, string> = {
  critical: 'border-l-destructive',
  major: 'border-l-warning',
  minor: 'border-l-info',
  nit: 'border-l-muted-foreground/40',
};

/**
 * A draft review comment written by the agent (`kirby util
 * add-comment`). Edit the text/severity, post it as a real review
 * comment, or discard it.
 */
export function DraftCard({
  draft,
  prId,
  headSha,
  showLocation = false,
  focused = false,
}: {
  draft: ReviewComment;
  prId: number;
  headSha?: string;
  showLocation?: boolean;
  focused?: boolean;
}) {
  const { repo } = useRepo();
  const update = useUpdateDraft(repo.cwd);
  const remove = useDeleteDraft(repo.cwd);
  const post = usePostDrafts(repo.cwd);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [severity, setSeverity] = useState<CommentSeverity>(draft.severity);
  const posting = draft.status === 'posting' || post.isPending;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused)
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  const save = () => {
    update.mutate(
      { prId, id: draft.id, patch: { body: body.trim(), severity } },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  };
  const doPost = () =>
    post.mutate(
      { prId, ids: [draft.id], headSha },
      {
        onSuccess: () => toast.success('Comment posted'),
        onError: (e) => toast.error(`Post failed: ${errorMessage(e)}`),
      }
    );
  const doDelete = () =>
    remove.mutate(
      { prId, id: draft.id },
      { onError: (e) => toast.error(errorMessage(e)) }
    );

  const location = `${draft.file}:${draft.lineStart}${
    draft.lineEnd !== draft.lineStart ? `-${draft.lineEnd}` : ''
  }`;

  return (
    <div
      ref={ref}
      data-draft={draft.id}
      className={cn(
        'max-w-[900px] overflow-hidden rounded-lg border border-dashed border-border border-l-[3px] bg-card text-card-foreground shadow-xs transition-shadow',
        SEVERITY_RAIL[draft.severity],
        focused && 'ring-2 ring-primary/50'
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-sm">
        <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">Draft</span>
        <Badge variant={SEVERITY_BADGE[draft.severity]}>{draft.severity}</Badge>
        {showLocation && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {location}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {relativeTime(draft.createdAt)}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2 px-3 py-2">
          <Textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            className="min-h-24 bg-background"
          />
          <div className="flex items-center gap-2">
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as CommentSeverity)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              <XIcon /> Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={update.isPending || !body.trim()}
            >
              <CheckIcon /> Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2">
          <CommentMarkdown markdown={draft.body} />
        </div>
      )}

      {!editing && (
        <div className="flex items-center gap-1.5 border-t border-border bg-muted/20 px-3 py-1.5">
          <span className="text-xs text-muted-foreground">
            Not posted yet — only you can see this.
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBody(draft.body);
              setSeverity(draft.severity);
              setEditing(true);
            }}
            disabled={posting}
          >
            <PencilIcon /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={doDelete}
            disabled={posting || remove.isPending}
          >
            <Trash2Icon /> Discard
          </Button>
          <Button size="sm" onClick={doPost} disabled={posting}>
            {posting ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {posting ? 'Posting…' : 'Post'}
          </Button>
        </div>
      )}
    </div>
  );
}
