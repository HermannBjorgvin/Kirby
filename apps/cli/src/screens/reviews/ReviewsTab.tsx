import { useMemo, useRef, useEffect } from 'react';
import { useInput } from 'ink';
import { ReviewsSidebar } from './ReviewsSidebar.js';
import { ReviewPane } from './ReviewPane.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { useAppState } from '../../context/AppStateContext.js';
import { useSessionContext } from '../../context/SessionContext.js';
import { useReviewContext } from '../../context/ReviewContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useDiffData } from '../../hooks/useDiffData.js';
import { useReviewComments } from '../../hooks/useReviewComments.js';
import { partitionFiles } from '../../utils/file-classifier.js';
import { parseUnifiedDiff } from '../../utils/diff-parser.js';
import { renderDiffLines } from '../../utils/diff-renderer.js';
import { interleaveComments } from '../../utils/comment-renderer.js';
import { handleSettingsInput } from '../../input-handlers.js';
import {
  handleReviewConfirmInput,
  handleDiffFileListInput,
  handleDiffViewerInput,
  handleReviewsSidebarInput,
} from './reviews-input.js';

interface ReviewsTabProps {
  terminalFocused: boolean;
  reviewsTerminalContent: string;
  exit: () => void;
}

export function ReviewsTab({
  terminalFocused,
  reviewsTerminalContent,
  exit,
}: ReviewsTabProps) {
  const appState = useAppState();
  const { nav, asyncOps, settings, terminal } = appState;
  const sessionCtx = useSessionContext();
  const configCtx = useConfig();
  const { categorizedReviews } = sessionCtx;
  const {
    review,
    selectedReviewPr,
    reviewSessionName,
    clampedReviewIndex,
    reviewTotalItems,
  } = useReviewContext();

  // ── Review comments (file-watched) ─────────────────────────────
  const reviewComments = useReviewComments(selectedReviewPr?.id ?? null);

  // ── Diff data (scoped to reviews tab) ───────────────────────────
  const diffPrNumber = selectedReviewPr?.id ?? null;
  const diffData = useDiffData(
    review.reviewPane === 'diff' || review.reviewPane === 'diff-file'
      ? diffPrNumber
      : null,
    selectedReviewPr?.sourceBranch ?? '',
    selectedReviewPr?.targetBranch ?? ''
  );
  const { normal: diffNormalFiles, skipped: diffSkippedFiles } = useMemo(
    () => partitionFiles(diffData.files),
    [diffData.files]
  );
  const diffDisplayCount = review.showSkipped
    ? diffNormalFiles.length + diffSkippedFiles.length
    : diffNormalFiles.length;

  const diffTotalLines = useMemo(() => {
    if (!review.diffViewFile || !diffData.diffText) return 0;
    const allDiffs = parseUnifiedDiff(diffData.diffText);
    const fileDiffLines = allDiffs.get(review.diffViewFile);
    if (!fileDiffLines) return 0;
    const rendered = renderDiffLines(fileDiffLines, terminal.paneCols);
    const fileComments = reviewComments.filter(
      (c) => c.file === review.diffViewFile
    );
    if (fileComments.length === 0) return rendered.length;
    return interleaveComments(
      fileDiffLines,
      rendered,
      fileComments,
      terminal.paneCols,
      review.selectedCommentId
    ).length;
  }, [
    review.diffViewFile,
    diffData.diffText,
    terminal.paneCols,
    reviewComments,
    review.selectedCommentId,
  ]);

  // Reset review pane when selected PR changes
  const prevReviewPrId = useRef(selectedReviewPr?.id);
  useEffect(() => {
    if (selectedReviewPr?.id !== prevReviewPrId.current) {
      prevReviewPrId.current = selectedReviewPr?.id;
      if (
        selectedReviewPr &&
        review.reviewSessionStarted.has(selectedReviewPr.id)
      ) {
        review.setReviewPane('terminal');
      } else {
        review.setReviewPane('detail');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to PR id changes
  }, [selectedReviewPr?.id, review.reviewSessionStarted]);

  useInput(
    (input, key) => {
      if (terminalFocused) return;
      if (settings.settingsOpen)
        return handleSettingsInput(input, key, {
          settings,
          config: configCtx,
          sessions: sessionCtx,
        });
      if (review.reviewConfirm)
        return handleReviewConfirmInput(input, key, {
          review,
          nav,
          asyncOps,
          sessions: sessionCtx,
          terminal,
          config: configCtx,
          selectedReviewPr,
          reviewSessionName,
        });
      if (review.reviewPane === 'diff')
        return handleDiffFileListInput(input, key, {
          review,
          diffFiles: diffData.files,
          diffDisplayCount,
          loadDiffText: diffData.loadDiffText,
        });
      if (review.reviewPane === 'diff-file')
        return handleDiffViewerInput(input, key, {
          review,
          diffFiles: diffData.files,
          terminal,
          diffTotalLines,
          comments: reviewComments,
          prId: selectedReviewPr?.id,
        });
      handleReviewsSidebarInput(input, key, {
        nav,
        config: configCtx,
        sessions: sessionCtx,
        settings,
        review,
        asyncOps,
        terminal,
        reviewSelectedIndex: clampedReviewIndex,
        reviewTotalItems,
        reviewSessionName,
        selectedReviewPr,
        exit,
      });
    },
    { isActive: nav.activeTab === 'reviews' }
  );

  return (
    <>
      <ReviewsSidebar
        categorized={categorizedReviews}
        selectedPrId={selectedReviewPr?.id}
        sidebarWidth={appState.sidebarWidth}
        paneRows={terminal.paneRows}
        focused={nav.focus === 'sidebar' && !review.reviewConfirm}
      />
      {settings.settingsOpen && (
        <SettingsPanel
          fieldIndex={settings.settingsFieldIndex}
          editingField={settings.editingField}
          editBuffer={settings.editBuffer}
        />
      )}
      {!settings.settingsOpen && (
        <ReviewPane
          reviewConfirm={review.reviewConfirm}
          reviewPane={review.reviewPane}
          selectedReviewPr={selectedReviewPr}
          reviewSessionStarted={review.reviewSessionStarted}
          terminalContent={reviewsTerminalContent}
          reviewInstruction={review.reviewInstruction}
          focused={nav.focus === 'terminal'}
          diffFiles={diffData.files}
          diffFileIndex={review.diffFileIndex}
          diffViewFile={review.diffViewFile}
          diffText={diffData.diffText}
          diffScrollOffset={review.diffScrollOffset}
          diffLoading={diffData.loading}
          diffTextLoading={diffData.diffLoading}
          diffError={diffData.error}
          showSkipped={review.showSkipped}
          paneRows={terminal.paneRows}
          paneCols={terminal.paneCols}
          comments={reviewComments}
          selectedCommentId={review.selectedCommentId}
        />
      )}
    </>
  );
}
