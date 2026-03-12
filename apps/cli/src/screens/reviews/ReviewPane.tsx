import { memo } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { DiffFile, ReviewComment } from '../../types.js';
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
  diffText,
  diffScrollOffset,
  diffLoading,
  diffTextLoading,
  diffError,
  showSkipped,
  paneRows,
  paneCols,
  comments,
  selectedCommentId,
  pendingDeleteCommentId,
  editingCommentId,
  editBuffer,
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
  diffText: string | null;
  diffScrollOffset: number;
  diffLoading: boolean;
  diffTextLoading: boolean;
  diffError: string | null;
  showSkipped: boolean;
  paneRows: number;
  paneCols: number;
  comments: ReviewComment[];
  selectedCommentId: string | null;
  pendingDeleteCommentId: string | null;
  editingCommentId: string | null;
  editBuffer: string;
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
        diffText={diffText}
        scrollOffset={diffScrollOffset}
        paneRows={paneRows}
        paneCols={paneCols}
        loading={diffTextLoading}
        comments={comments}
        selectedCommentId={selectedCommentId}
        pendingDeleteCommentId={pendingDeleteCommentId}
        editingCommentId={editingCommentId}
        editBuffer={editBuffer}
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
