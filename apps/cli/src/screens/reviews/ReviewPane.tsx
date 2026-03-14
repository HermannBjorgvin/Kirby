import { memo } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { DiffFile, ReviewComment } from '../../types.js';
import type { AnnotatedLine } from '../../utils/comment-renderer.js';
import { ReviewConfirmPane } from './ReviewConfirmPane.js';
import { ReviewDetailPane } from './ReviewDetailPane.js';
import { DiffFileList } from './DiffFileList.js';
import { DiffViewer } from './DiffViewer.js';
import { TerminalView } from '../../components/TerminalView.js';

export const ReviewPane = memo(function ReviewPane({
  reviewConfirm,
  reviewPane,
  selectedReviewPr,
  reviewSessionStarted,
  terminalContent,
  reviewInstruction,
  focused,
  diffFiles,
  diffFileIndex,
  diffViewFile,
  diffScrollOffset,
  diffLoading,
  diffTextLoading,
  diffError,
  showSkipped,
  paneRows,
  paneCols,
  comments,
  annotatedLines,
}: {
  reviewConfirm: { pr: PullRequestInfo; selectedOption: number } | null;
  reviewPane: string;
  selectedReviewPr: PullRequestInfo | undefined;
  reviewSessionStarted: Set<number>;
  terminalContent: string;
  reviewInstruction: string;
  focused: boolean;
  diffFiles: DiffFile[];
  diffFileIndex: number;
  diffViewFile: string | null;
  diffScrollOffset: number;
  diffLoading: boolean;
  diffTextLoading: boolean;
  diffError: string | null;
  showSkipped: boolean;
  paneRows: number;
  paneCols: number;
  comments: ReviewComment[];
  annotatedLines: AnnotatedLine[];
}) {
  if (reviewConfirm) {
    return (
      <ReviewConfirmPane
        pr={reviewConfirm.pr}
        selectedOption={reviewConfirm.selectedOption}
        instruction={reviewInstruction}
      />
    );
  }
  if (reviewPane === 'diff') {
    return (
      <DiffFileList
        files={diffFiles}
        selectedIndex={diffFileIndex}
        paneRows={paneRows}
        paneCols={paneCols}
        loading={diffLoading}
        error={diffError}
        showSkipped={showSkipped}
        comments={comments}
      />
    );
  }
  if (reviewPane === 'diff-file' && diffViewFile) {
    return (
      <DiffViewer
        filename={diffViewFile}
        annotatedLines={annotatedLines}
        scrollOffset={diffScrollOffset}
        paneRows={paneRows}
        paneCols={paneCols}
        loading={diffTextLoading}
      />
    );
  }
  if (
    reviewPane === 'terminal' ||
    (selectedReviewPr && reviewSessionStarted.has(selectedReviewPr.id))
  ) {
    return <TerminalView content={terminalContent} focused={focused} />;
  }
  return <ReviewDetailPane pr={selectedReviewPr} />;
});
