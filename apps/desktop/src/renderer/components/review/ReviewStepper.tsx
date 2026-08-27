import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileIcon,
  Loader2Icon,
  PencilIcon,
  SendIcon,
  SkipForwardIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { DiffLine } from '@kirby/diff';
import type { CommentSeverity, ReviewComment } from '../../../host/contract.js';
import {
  orderDraftsForReview,
  severityCounts,
  snippetAround,
} from '../../lib/diff-model.js';
import {
  useDeleteDraft,
  usePostDrafts,
  useUpdateDraft,
} from '../../lib/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { cn, errorMessage } from '../../lib/utils.js';
import {
  SEVERITIES,
  SEVERITY_BADGE,
  SEVERITY_DOT,
} from '../../lib/severity.js';
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
import { Tip } from '../ui/tooltip.js';
import { CommentMarkdown } from './CommentMarkdown.js';
import { SnippetView } from './SnippetView.js';

/**
 * "Review ready" walkthrough: steps through the agent's draft comments
 * one at a time, in severity order, each with the code snippet it
 * anchors to. Post / edit / discard / skip per draft; posting advances
 * to the next. A final screen offers to post everything that's left.
 */
export function ReviewStepper({
  prId,
  headSha,
  drafts,
  filesByName,
  fileOrder,
  active,
  onExit,
  onOpenInDiff,
}: {
  prId: number;
  headSha?: string;
  drafts: ReviewComment[];
  filesByName: Map<string, DiffLine[]>;
  fileOrder: Map<string, number>;
  /** Whether this stepper's tab is the visible one. Its shortcuts are
   *  bound on `window`, and the pane stays mounted while the tab is in
   *  the background (a live agent keeps its terminal alive), so without
   *  this a keypress meant for another tab would post or discard a
   *  draft here. */
  active: boolean;
  onExit: () => void;
  onOpenInDiff: (file: string) => void;
}) {
  const { repo } = useRepo();
  const update = useUpdateDraft(repo.cwd);
  const remove = useDeleteDraft(repo.cwd);
  const post = usePostDrafts(repo.cwd);

  const ordered = useMemo(
    () => orderDraftsForReview(drafts, fileOrder),
    [drafts, fileOrder]
  );
  const [index, setIndex] = useState(0);
  const clamped = Math.min(index, Math.max(0, ordered.length - 1));
  if (clamped !== index) setIndex(clamped);

  const current = ordered[clamped];
  const done = ordered.length === 0;

  if (done) {
    return <FinishScreen onExit={onExit} />;
  }

  return (
    <StepCard
      key={current.id}
      draft={current}
      pos={clamped + 1}
      total={ordered.length}
      counts={severityCounts(ordered)}
      snippet={snippetAround(
        filesByName.get(current.file) ?? [],
        current.side,
        current.lineStart,
        current.lineEnd
      )}
      filesByName={filesByName}
      active={active}
      busy={post.isPending || update.isPending || remove.isPending}
      atStart={clamped === 0}
      atEnd={clamped >= ordered.length - 1}
      onPrev={() => setIndex((i) => Math.max(0, i - 1))}
      onNext={() => setIndex((i) => Math.min(ordered.length - 1, i + 1))}
      onExit={onExit}
      onOpenInDiff={() => onOpenInDiff(current.file)}
      onPost={() =>
        post.mutate(
          { prId, ids: [current.id], headSha },
          {
            // The posted draft leaves the list, shifting the next one
            // into this index — keep index where it is.
            onSuccess: () => toast.success('Comment posted'),
            onError: (e) => toast.error(`Post failed: ${errorMessage(e)}`),
          }
        )
      }
      onDiscard={() =>
        remove.mutate(
          { prId, id: current.id },
          { onError: (e) => toast.error(errorMessage(e)) }
        )
      }
      onSave={(body, severity) =>
        update.mutate(
          { prId, id: current.id, patch: { body, severity } },
          { onError: (e) => toast.error(errorMessage(e)) }
        )
      }
    />
  );
}

function StepCard({
  draft,
  pos,
  total,
  counts,
  snippet,
  active,
  busy,
  atStart,
  atEnd,
  onPrev,
  onNext,
  onExit,
  onOpenInDiff,
  onPost,
  onDiscard,
  onSave,
}: {
  draft: ReviewComment;
  pos: number;
  total: number;
  counts: Record<CommentSeverity, number>;
  snippet: { line: DiffLine; anchored: boolean }[];
  filesByName: Map<string, DiffLine[]>;
  active: boolean;
  busy: boolean;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onOpenInDiff: () => void;
  onPost: () => void;
  onDiscard: () => void;
  onSave: (body: string, severity: CommentSeverity) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [severity, setSeverity] = useState<CommentSeverity>(draft.severity);

  // Keyboard shortcuts (ignored while editing the textarea, and while
  // this tab is in the background — `d` discards and `Enter` posts, so
  // a stray keypress elsewhere in the app must not reach them).
  useEffect(() => {
    if (editing || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault();
        onNext();
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft' ||
        e.key === 'k'
      ) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'e') {
        e.preventDefault();
        setBody(draft.body);
        setSeverity(draft.severity);
        setEditing(true);
      } else if (e.key === 'p' || e.key === 'Enter') {
        e.preventDefault();
        onPost();
      } else if (e.key === 'd') {
        e.preventDefault();
        onDiscard();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, active, draft, onNext, onPrev, onPost, onDiscard, onExit]);

  const save = () => {
    onSave(body.trim(), severity);
    setEditing(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: progress + severity legend + exit */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="text-sm font-medium">Review ready</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {pos} / {total}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={cn('size-2 rounded-full', SEVERITY_DOT[s])} />
              {counts[s]} {s}
            </span>
          ))}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Tip label="Previous comment (← / ↑)">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onPrev}
              disabled={atStart}
              aria-label="Previous comment"
            >
              <ChevronLeftIcon />
            </Button>
          </Tip>
          <Tip label="Next comment (→ / ↓)">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNext}
              disabled={atEnd}
              aria-label="Next comment"
            >
              <ChevronRightIcon />
            </Button>
          </Tip>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <XIcon /> Close
        </Button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 shrink-0 bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(pos / total) * 100}%` }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-3 p-4">
          {/* Location */}
          <button
            onClick={onOpenInDiff}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            title="Open this file in the diff"
          >
            <FileIcon className="size-3.5" />
            <span className="font-mono">
              {draft.file}:{draft.lineStart}
              {draft.lineEnd !== draft.lineStart ? `-${draft.lineEnd}` : ''}
            </span>
            <ArrowRightIcon className="size-3" />
          </button>

          {/* Snippet */}
          <SnippetView filename={draft.file} rows={snippet} />

          {/* Draft */}
          <div className="rounded-lg border border-dashed border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <Badge variant={SEVERITY_BADGE[draft.severity]}>
                {draft.severity}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Draft comment
              </span>
            </div>
            {editing ? (
              <div className="space-y-2 p-3">
                <Textarea
                  autoFocus
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      save();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditing(false);
                    }
                  }}
                  className="min-h-28 bg-background"
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={!body.trim()}>
                    <CheckIcon /> Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-3">
                <CommentMarkdown markdown={draft.body} />
              </div>
            )}
            {/* Actions — part of the card, next to the comment. */}
            {!editing && (
              <div className="flex items-center gap-1.5 border-t border-border bg-muted/20 px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBody(draft.body);
                    setSeverity(draft.severity);
                    setEditing(true);
                  }}
                  disabled={busy}
                >
                  <PencilIcon /> Edit <Kbd>e</Kbd>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDiscard}
                  disabled={busy}
                >
                  <Trash2Icon /> Discard <Kbd>d</Kbd>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onNext}
                  disabled={atEnd}
                >
                  <SkipForwardIcon /> Skip
                </Button>
                <div className="flex-1" />
                <Button size="sm" onClick={onPost} disabled={busy}>
                  {busy ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <SendIcon />
                  )}
                  Post{' '}
                  <Kbd className="border-primary-foreground/30 text-primary-foreground/80">
                    ↵
                  </Kbd>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FinishScreen({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-success/15">
        <CheckIcon className="size-6 text-success" />
      </span>
      <div>
        <p className="text-lg font-semibold">All drafts handled</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every draft comment has been posted or discarded.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onExit}>
        Back to diff
      </Button>
    </div>
  );
}

function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded border border-border px-1 font-sans text-[10px] text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  );
}
