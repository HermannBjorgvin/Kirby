import {
  BookOpenIcon,
  BotIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PlayIcon,
  SendIcon,
  SquareIcon,
} from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import { formatSeverityBreakdown } from '../../lib/severity.js';
import { severityCounts } from '../../lib/diff-model.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { CommentsList, type CommentListItem } from './CommentsList.js';
import { FileTree, type FileEntry } from './FileTree.js';

export function ReviewRail({
  hasPr,
  overviewActive,
  onOverview,
  running,
  busy,
  hasSession,
  agentActive,
  onSelectAgent,
  onLaunch,
  onStop,
  onHide,
  drafts,
  reviewActive,
  onReview,
  postingAll,
  onPostAll,
  planCount,
  planNoted,
  planActive,
  onPlan,
  entries,
  diffLoading,
  selectedFile,
  onSelectFile,
  commentItems,
  activeCommentId,
  onJumpComment,
}: {
  hasPr: boolean;
  overviewActive: boolean;
  onOverview: () => void;
  running: boolean;
  busy: boolean;
  hasSession: boolean;
  agentActive: boolean;
  onSelectAgent: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onHide: () => void;
  drafts: ReviewComment[];
  reviewActive: boolean;
  onReview: () => void;
  postingAll: boolean;
  onPostAll: () => void;
  /** Comments queued for the agent; the entry hides at zero. */
  planCount: number;
  planNoted: number;
  planActive: boolean;
  onPlan: () => void;
  entries: FileEntry[];
  diffLoading: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  commentItems: CommentListItem[];
  activeCommentId: string | null;
  onJumpComment: (item: CommentListItem) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/60">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1 pl-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Review
        </span>
        <Tip label="Hide review sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
            aria-label="Hide review sidebar"
          >
            <PanelLeftCloseIcon />
          </Button>
        </Tip>
      </div>

      {/* Overview — the PR's title, description and verdict actions. */}
      {hasPr && (
        <div className="shrink-0 px-2 pb-1">
          <button
            onClick={onOverview}
            className={cn(
              'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-base transition-colors',
              overviewActive
                ? 'bg-sidebar-active text-foreground'
                : 'hover:bg-sidebar-accent'
            )}
          >
            <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">Overview</span>
          </button>
        </div>
      )}

      {/* Agent — a running row you can select to view the terminal, or
          a launch button (opening the session/review menu) otherwise. */}
      <div className="shrink-0 border-b border-border px-2 pb-2">
        {running ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onSelectAgent}
              className={cn(
                'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-base transition-colors',
                agentActive
                  ? 'bg-sidebar-active text-foreground'
                  : 'hover:bg-sidebar-accent'
              )}
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <BotIcon className="size-4 text-muted-foreground" />
                <span className="absolute -right-0.5 -bottom-0.5 flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-success ring-2 ring-sidebar" />
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-left">Agent</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                running
              </span>
            </button>
            <Tip label="Stop agent">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onStop}
                aria-label="Stop agent"
              >
                <SquareIcon />
              </Button>
            </Tip>
          </div>
        ) : (
          <Button
            className="w-full"
            size="sm"
            onClick={onLaunch}
            disabled={busy}
          >
            <PlayIcon />{' '}
            {busy ? 'Working…' : hasSession ? 'Relaunch agent' : 'Launch agent'}
          </Button>
        )}
      </div>

      {/* Review ready — enter the draft walkthrough */}
      {drafts.length > 0 && (
        <div className="shrink-0 border-b border-border px-2 py-2">
          <button
            onClick={onReview}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
              reviewActive
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-sidebar-accent'
            )}
          >
            <ClipboardCheckIcon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium">Review ready</span>
              <span className="block text-xs text-muted-foreground">
                {formatSeverityBreakdown(severityCounts(drafts))}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
              {drafts.length}
            </span>
          </button>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={onPostAll}
            disabled={postingAll}
          >
            {postingAll ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <SendIcon />
            )}
            Post all {drafts.length} draft{drafts.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      {/* Plan — the comments queued for the agent, and the way in to
          sending them. Hidden at zero, like "Review ready" above it:
          an empty cart is not a thing to look at. */}
      {planCount > 0 && (
        <div className="shrink-0 border-b border-border px-2 py-2">
          <button
            type="button"
            onClick={onPlan}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
              planActive
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-sidebar-accent'
            )}
          >
            <ClipboardListIcon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium">Plan</span>
              <span className="block text-xs text-muted-foreground">
                {planCount} comment{planCount === 1 ? '' : 's'}
                {planNoted > 0 && ` · ${planNoted} with a note`}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
              {planCount}
            </span>
          </button>
        </div>
      )}

      {/* Files + Comments */}
      <ScrollArea className="min-h-0 flex-1">
        <FileTree
          entries={entries}
          loading={diffLoading}
          selected={selectedFile}
          onSelect={onSelectFile}
        />
        <CommentsList
          items={commentItems}
          activeId={activeCommentId}
          onJump={onJumpComment}
        />
      </ScrollArea>
    </div>
  );
}
