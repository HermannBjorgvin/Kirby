import {
  ChevronDownIcon,
  ChevronUpIcon,
  ColumnsIcon,
  EyeOffIcon,
  MessageSquareIcon,
  RowsIcon,
  WrapTextIcon,
} from 'lucide-react';
import {
  startTransition,
  useEffect,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../../host/contract.js';
import { setDiffOptions, useDiffOptions } from '../../../lib/diff/diff-options.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';
import { Tip } from '../../ui/tooltip.js';
import { VirtualDiffList, type DiffJumpHandle } from './VirtualDiffList.js';

/**
 * The diff content pane: the diff *settings* toolbar (view / wrap /
 * hide-resolved / post-drafts / comment navigation) and the scrolling
 * per-file diffs. Only diff-specific controls live here — the PR meta
 * (author, CI, reviewers, files changed) is in the tab header — so this
 * bar is gone when the terminal replaces the pane.
 */
export function DiffPane({
  prId,
  headSha,
  sourceBranch,
  targetBranch,
  files,
  threadsByFile,
  draftsByFile,
  generalThreads,
  commentsLoading,
  diffLoading,
  diffError,
  focusThreadId,
  scrollRef,
  jumpRef,
  navCount,
  navIndex,
  onPrev,
  onNext,
}: {
  prId: number;
  headSha?: string;
  sourceBranch: string;
  targetBranch: string;
  files: [string, DiffLine[]][];
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  diffLoading: boolean;
  diffError: string | null;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef?: Ref<DiffJumpHandle>;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Terminal-first: the workspace's first frame (header, rail,
  // terminal) must never wait on the diff. The list mounts in a
  // follow-up low-priority render; virtualization keeps that render
  // small, this gate keeps it out of frame one entirely.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      startTransition(() => setWarm(true))
    );
    return () => cancelAnimationFrame(id);
  }, []);
  const loading = diffLoading || !warm;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        navCount={navCount}
        navIndex={navIndex}
        onPrev={onPrev}
        onNext={onNext}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {loading && (
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
        {!loading && !diffError && files.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No changes between <span className="font-mono">{targetBranch}</span>{' '}
            and <span className="font-mono">{sourceBranch}</span>.
          </div>
        )}
        {!loading && (
          <VirtualDiffList
            files={files}
            threadsByFile={threadsByFile}
            draftsByFile={draftsByFile}
            generalThreads={generalThreads}
            commentsLoading={commentsLoading}
            prId={prId}
            headSha={headSha}
            focusThreadId={focusThreadId}
            scrollRef={scrollRef}
            jumpRef={jumpRef}
          />
        )}
      </div>
    </div>
  );
}

function Toolbar({
  navCount,
  navIndex,
  onPrev,
  onNext,
}: {
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const o = useDiffOptions();
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 text-sm">
      <div className="flex items-center rounded-md border border-border p-0.5">
        <Tip label="Unified view">
          <button
            type="button"
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
            type="button"
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
