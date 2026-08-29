import type { DiffLine } from '@kirby/diff';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { Ref, RefObject } from 'react';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import { type Mode } from '../../lib/review-model.js';
import { cn } from '../../lib/utils.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { DiffPane } from './DiffPane.js';
import { type DiffJumpHandle } from './VirtualDiffList.js';
import { OverviewPane } from './OverviewPane.js';
import { ReviewStepper } from './ReviewStepper.js';

/**
 * The single content pane, with every mode's view stacked in it. The
 * terminal and the walkthrough stay mounted and are hidden rather than
 * unmounted, so switching modes never costs their scrollback or their
 * scroll position.
 */
export function ContentPane({
  effMode,
  pr,
  prId,
  branch,
  baseBranch,
  sessionName,
  active,
  files,
  filesByName,
  fileOrder,
  threadsByFile,
  draftsByFile,
  general,
  hideResolved,
  drafts,
  hasDrafts,
  commentsLoading,
  diffPending,
  diffError,
  focusThreadId,
  scrollRef,
  jumpRef,
  navCount,
  navIndex,
  onPrev,
  onNext,
  onExitReview,
  onOpenInDiff,
}: {
  effMode: Mode;
  pr?: PullRequestInfo;
  prId: number;
  branch: string;
  baseBranch: string;
  sessionName?: string;
  active: boolean;
  files: [string, DiffLine[]][];
  filesByName: Map<string, DiffLine[]>;
  fileOrder: Map<string, number>;
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  general: RemoteCommentThread[];
  hideResolved: boolean;
  drafts: ReviewComment[];
  hasDrafts: boolean;
  commentsLoading: boolean;
  diffPending: boolean;
  diffError: Error | null;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef: Ref<DiffJumpHandle>;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onExitReview: () => void;
  onOpenInDiff: (file: string) => void;
}) {
  return (
    <div className="relative h-full min-h-0">
      {sessionName && (
        <div
          className={cn('absolute inset-0', effMode !== 'agent' && 'invisible')}
        >
          <SessionTerminal
            name={sessionName}
            active={active && effMode === 'agent'}
          />
        </div>
      )}
      {hasDrafts && (
        <div
          className={cn(
            'absolute inset-0',
            effMode !== 'review' && 'invisible'
          )}
        >
          {effMode === 'review' && (
            <ReviewStepper
              prId={prId}
              headSha={pr?.headSha}
              drafts={drafts}
              filesByName={filesByName}
              fileOrder={fileOrder}
              active={active}
              onExit={onExitReview}
              onOpenInDiff={onOpenInDiff}
            />
          )}
        </div>
      )}
      {pr && effMode === 'overview' && (
        <div className="absolute inset-0">
          <OverviewPane pr={pr} />
        </div>
      )}
      <div
        className={cn('absolute inset-0', effMode !== 'diff' && 'invisible')}
      >
        <DiffPane
          prId={prId}
          headSha={pr?.headSha}
          sourceBranch={branch}
          targetBranch={baseBranch}
          files={files}
          threadsByFile={threadsByFile}
          draftsByFile={draftsByFile}
          generalThreads={
            hideResolved ? general.filter((t) => !t.isResolved) : general
          }
          commentsLoading={commentsLoading}
          diffLoading={diffPending}
          diffError={diffError ? String(diffError.message) : null}
          focusThreadId={focusThreadId}
          scrollRef={scrollRef}
          jumpRef={jumpRef}
          navCount={navCount}
          navIndex={navIndex}
          onPrev={onPrev}
          onNext={onNext}
        />
      </div>
    </div>
  );
}
