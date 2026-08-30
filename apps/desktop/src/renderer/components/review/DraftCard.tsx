import {
  BotIcon,
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CommentSeverity, ReviewComment } from '../../../host/contract.js';
import { snapshotLocal } from '@kirby/core/plan';
import { usePlan, usePlanControls } from '../../lib/plan/plan.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useDeleteDraft,
  usePostDrafts,
  useUpdateDraft,
} from '../../lib/data/mutations.js';
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
import {
  SEVERITIES,
  SEVERITY_BADGE,
  SEVERITY_RAIL,
} from '../../lib/review/severity.js';
import { CommentMarkdown } from './CommentMarkdown.js';
import { PlanAttachment, PlanControls } from './PlanControls.js';

/**
 * The footer of a draft that is not being edited. Every button is
 * disabled while a post is in flight — the draft is server-bound at
 * that point and editing or discarding it would race the request.
 */
function DraftActions({
  posting,
  deleting,
  onEdit,
  onDelete,
  onPost,
}: {
  posting: boolean;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPost: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 border-t border-border bg-muted/20 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        Not posted yet — only you can see this.
      </span>
      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onEdit} disabled={posting}>
        <PencilIcon /> Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={posting || deleting}
      >
        <Trash2Icon /> Discard
      </Button>
      <Button size="sm" onClick={onPost} disabled={posting}>
        {posting ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        {posting ? 'Posting…' : 'Post'}
      </Button>
    </div>
  );
}

/**
 * The card in edit mode: body, severity, and the two ways out.
 * Cmd/Ctrl+Enter saves and Escape cancels, matching the reply editor.
 */
function DraftEditor({
  body,
  severity,
  saving,
  onBody,
  onSeverity,
  onSave,
  onCancel,
}: {
  body: string;
  severity: CommentSeverity;
  saving: boolean;
  onBody: (v: string) => void;
  onSeverity: (v: CommentSeverity) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 px-3 py-2">
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => onBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSave();
          }
          if (e.key === 'Escape') onCancel();
        }}
        className="min-h-24 bg-background"
      />
      <div className="flex items-center gap-2">
        <Select
          value={severity}
          onValueChange={(v) => onSeverity(v as CommentSeverity)}
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
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <XIcon /> Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || !body.trim()}>
          <CheckIcon /> Save
        </Button>
      </div>
    </div>
  );
}

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
  const plan = usePlan(prId);
  const planControls = usePlanControls(
    plan,
    'local',
    draft.id,
    useCallback(() => snapshotLocal(draft), [draft])
  );
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
        'group/card max-w-[900px] overflow-hidden rounded-lg border border-dashed border-l-[3px] bg-card text-card-foreground shadow-xs transition-shadow',
        planControls.inPlan ? 'border-primary/40' : 'border-border',
        SEVERITY_RAIL[draft.severity],
        focused && 'ring-2 ring-primary/50'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm',
          planControls.inPlan ? 'bg-primary/5' : 'bg-muted/40'
        )}
      >
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
        <PlanControls
          inPlan={planControls.inPlan}
          hasNote={planControls.note !== undefined}
          onToggle={planControls.toggleInPlan}
          onNote={planControls.startNote}
        />
      </div>

      {editing ? (
        <DraftEditor
          body={body}
          severity={severity}
          saving={update.isPending}
          onBody={setBody}
          onSeverity={setSeverity}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="px-3 py-2">
          <CommentMarkdown markdown={draft.body} />
        </div>
      )}

      {!editing && (
        <PlanAttachment
          composing={planControls.composing}
          note={planControls.note}
          onSave={planControls.saveNote}
          onCancel={planControls.cancelNote}
          onEdit={planControls.startNote}
        />
      )}

      {!editing && (
        <DraftActions
          posting={posting}
          deleting={remove.isPending}
          onEdit={() => {
            setBody(draft.body);
            setSeverity(draft.severity);
            setEditing(true);
          }}
          onDelete={doDelete}
          onPost={doPost}
        />
      )}
    </div>
  );
}
