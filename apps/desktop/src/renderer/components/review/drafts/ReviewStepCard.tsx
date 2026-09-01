import {
  ArrowRightIcon,
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
import { useState } from 'react';
import type { DiffLine } from '@kirby/diff';
import type {
  CommentSeverity,
  ReviewComment,
} from '../../../../host/contract.js';
import { useThreads } from '../../../lib/data/queries.js';
import { totalCommentCount } from '../../../lib/diff/thread-model.js';
import { useRepo } from '../../../lib/repo-context.js';
import { cn } from '../../../lib/utils.js';
import {
  SEVERITIES,
  SEVERITY_BADGE,
  SEVERITY_DOT,
} from '../../../lib/review/severity.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { CommentBody } from '../comments/CommentBody.js';
import { ComposerNoticeLine } from '../comments/ComposerNotice.js';
import { useComposerRefresh } from '../comments/use-composer-refresh.js';
import { DraftEditor } from './DraftEditor.js';
import { SnippetView } from '../diff/SnippetView.js';
import { useStepperShortcuts } from './use-stepper-shortcuts.js';

/**
 * One step of the walkthrough: where the draft anchors, the code it
 * anchors to, the draft itself, and what can be done with it.
 */
export function StepCard({
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
  prId,
}: {
  draft: ReviewComment;
  /** The pull request the draft belongs to, for the freshness check. */
  prId: number;
  pos: number;
  total: number;
  counts: Record<CommentSeverity, number>;
  snippet: { line: DiffLine; anchored: boolean }[];
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
  // The walkthrough edits the same drafts the diff pane does, so it
  // gets the same freshness check: whatever landed on the pull request
  // while the reader was stepping through is worth knowing before they
  // rewrite a comment about it.
  const { repo } = useRepo();
  const threads = useThreads(repo.cwd, prId);
  const refresh = useComposerRefresh(
    prId,
    threads.data ? totalCommentCount(threads.data) : null
  );

  const startEditing = () => {
    setBody(draft.body);
    setSeverity(draft.severity);
    setEditing(true);
    refresh.begin();
  };

  useStepperShortcuts(!editing && active, {
    onNext,
    onPrev,
    onEdit: startEditing,
    onPost,
    onDiscard,
    onExit,
  });

  const save = () => {
    onSave(body.trim(), severity);
    setEditing(false);
    refresh.end();
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
            type="button"
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
              <DraftEditor
                body={body}
                severity={severity}
                onBodyChange={setBody}
                onSeverityChange={setSeverity}
                onSave={save}
                notice={<ComposerNoticeLine notice={refresh.notice} />}
                onCancel={() => {
                  setEditing(false);
                  refresh.end();
                }}
              />
            ) : (
              <div className="p-3">
                <CommentBody markdown={draft.body} />
              </div>
            )}
            {/* Actions — part of the card, next to the comment. */}
            {!editing && (
              <div className="flex items-center gap-1.5 border-t border-border bg-muted/20 px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={startEditing}
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

/** A tighter key hint than `ui/kbd`: it rides inside a button's label
 *  rather than standing on its own, so it is smaller and unfilled. */
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
