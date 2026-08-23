import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleDotIcon,
  ColumnsIcon,
  EyeOffIcon,
  Loader2Icon,
  MessageSquareIcon,
  RowsIcon,
  SendIcon,
  WrapTextIcon,
  XCircleIcon,
} from 'lucide-react';
import type { RefObject } from 'react';
import type { DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import { setDiffOptions, useDiffOptions } from '../../lib/diff-options.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { Tip } from '../ui/tooltip.js';
import { ConversationPanel } from './ConversationPanel.js';
import { DiffView } from './DiffView.js';

/**
 * The diff content pane: PR meta strip, the diff toolbar (view / wrap /
 * hide-resolved / post-drafts / comment navigation) and the scrolling
 * per-file diffs. The toolbar lives here — not in the tab header — so
 * it disappears when the terminal replaces this pane.
 */
export function DiffPane({
  pr,
  files,
  threadsByFile,
  draftsByFile,
  generalThreads,
  commentsLoading,
  diffLoading,
  diffError,
  focusThreadId,
  scrollRef,
  navCount,
  navIndex,
  onPrev,
  onNext,
  draftCount,
  postingAll,
  onPostAll,
}: {
  pr: PullRequestInfo;
  files: [string, DiffLine[]][];
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  diffLoading: boolean;
  diffError: string | null;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  draftCount: number;
  postingAll: boolean;
  onPostAll: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MetaStrip pr={pr} fileCount={files.length} />
      <Toolbar
        navCount={navCount}
        navIndex={navIndex}
        onPrev={onPrev}
        onNext={onNext}
        draftCount={draftCount}
        postingAll={postingAll}
        onPostAll={onPostAll}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {diffLoading && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        )}
        {diffError && (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {diffError}
          </div>
        )}
        {(generalThreads.length > 0 || commentsLoading) && (
          <ConversationPanel
            threads={generalThreads}
            loading={commentsLoading}
            prId={pr.id}
            focusThreadId={focusThreadId}
          />
        )}
        {!diffLoading && !diffError && files.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No changes between{' '}
            <span className="font-mono">{pr.targetBranch}</span> and{' '}
            <span className="font-mono">{pr.sourceBranch}</span>.
          </div>
        )}
        {files.map(([filename, lines]) => (
          <DiffView
            key={filename}
            filename={filename}
            lines={lines}
            threads={threadsByFile.get(filename) ?? []}
            drafts={draftsByFile.get(filename) ?? []}
            prId={pr.id}
            headSha={pr.headSha}
            focusThreadId={focusThreadId}
          />
        ))}
      </div>
    </div>
  );
}

function Toolbar({
  navCount,
  navIndex,
  onPrev,
  onNext,
  draftCount,
  postingAll,
  onPostAll,
}: {
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  draftCount: number;
  postingAll: boolean;
  onPostAll: () => void;
}) {
  const o = useDiffOptions();
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-sm">
      <div className="flex items-center rounded-md border border-border p-0.5">
        <Tip label="Unified view">
          <button
            onClick={() => setDiffOptions({ view: 'unified' })}
            className={cn(
              'flex h-5 items-center gap-1 rounded px-1.5 text-xs',
              o.view === 'unified'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <RowsIcon className="size-3.5" /> Unified
          </button>
        </Tip>
        <Tip label="Side-by-side view">
          <button
            onClick={() => setDiffOptions({ view: 'split' })}
            className={cn(
              'flex h-5 items-center gap-1 rounded px-1.5 text-xs',
              o.view === 'split'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ColumnsIcon className="size-3.5" /> Split
          </button>
        </Tip>
      </div>
      <Tip label={o.wrap ? 'Disable line wrapping' : 'Wrap long lines'}>
        <Button
          variant={o.wrap ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setDiffOptions({ wrap: !o.wrap })}
          aria-pressed={o.wrap}
        >
          <WrapTextIcon /> Wrap
        </Button>
      </Tip>
      <Tip
        label={
          o.hideResolved ? 'Show resolved threads' : 'Hide resolved threads'
        }
      >
        <Button
          variant={o.hideResolved ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setDiffOptions({ hideResolved: !o.hideResolved })}
          aria-pressed={o.hideResolved}
        >
          <EyeOffIcon /> Hide resolved
        </Button>
      </Tip>
      <div className="flex-1" />
      {draftCount > 0 && (
        <Tip label="Post every draft comment written by the review agent">
          <Button size="sm" onClick={onPostAll} disabled={postingAll}>
            {postingAll ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SendIcon />
            )}
            Post {draftCount} draft{draftCount === 1 ? '' : 's'}
          </Button>
        </Tip>
      )}
      {navCount > 0 && (
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
          <MessageSquareIcon className="size-3.5" />
          <span className="tabular-nums">
            {navIndex >= 0 ? navIndex + 1 : '–'}/{navCount}
          </span>
          <Tip label="Previous comment">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onPrev}
              aria-label="Previous comment"
            >
              <ChevronUpIcon />
            </Button>
          </Tip>
          <Tip label="Next comment">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNext}
              aria-label="Next comment"
            >
              <ChevronDownIcon />
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}

function MetaStrip({
  pr,
  fileCount,
}: {
  pr: PullRequestInfo;
  fileCount: number;
}) {
  const reviewers = pr.reviewers ?? [];
  const ci = pr.buildStatus;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-muted/40 px-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5">
        <Avatar name={pr.createdByDisplayName} size="xs" />
        <span className="truncate text-foreground">
          {pr.createdByDisplayName}
        </span>
      </span>
      {pr.isDraft && <Badge variant="outline">Draft</Badge>}
      {ci && ci !== 'none' && (
        <Badge
          variant={
            ci === 'succeeded'
              ? 'success'
              : ci === 'failed'
              ? 'destructive'
              : 'warning'
          }
        >
          {ci === 'succeeded' && <CheckCircle2Icon />}
          {ci === 'failed' && <XCircleIcon />}
          {ci === 'pending' && <CircleDotIcon />}
          CI {ci}
        </Badge>
      )}
      {reviewers.length > 0 && (
        <span className="flex items-center gap-1">
          {reviewers.slice(0, 6).map((r) => (
            <Tip
              key={r.identifier}
              label={`${r.displayName}: ${r.decision.replace('-', ' ')}`}
            >
              <span className="relative">
                <Avatar name={r.displayName} size="xs" />
                <span
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background',
                    r.decision === 'approved' && 'bg-success',
                    r.decision === 'changes-requested' && 'bg-destructive',
                    r.decision === 'no-response' && 'bg-muted-foreground/50',
                    r.decision === 'declined' && 'bg-muted-foreground'
                  )}
                />
              </span>
            </Tip>
          ))}
        </span>
      )}
      {(pr.activeCommentCount ?? 0) > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <MessageSquareIcon className="size-3.5" />
          {pr.activeCommentCount}
        </span>
      )}
      <span className="ml-auto shrink-0 text-muted-foreground">
        {fileCount} file{fileCount === 1 ? '' : 's'} changed
      </span>
    </div>
  );
}
