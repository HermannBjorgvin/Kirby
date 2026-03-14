import { useMemo, useRef, useEffect, useCallback } from 'react';
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
import {
  interleaveComments,
  getCommentPositions,
} from '../../utils/comment-renderer.js';
import { useScrollWheel } from '../../hooks/useScrollWheel.js';
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

  // Compute parsed diff data for current file (reused for totalLines + positions)
  const fileDiffData = useMemo(() => {
    if (!review.diffViewFile || !diffData.diffText) return null;
    const allDiffs = parseUnifiedDiff(diffData.diffText);
    const fileDiffLines = allDiffs.get(review.diffViewFile);
    if (!fileDiffLines) return null;
    const rendered = renderDiffLines(fileDiffLines, terminal.paneCols);
    return { fileDiffLines, rendered };
  }, [review.diffViewFile, diffData.diffText, terminal.paneCols]);

  const fileComments = useMemo(
    () => reviewComments.filter((c) => c.file === review.diffViewFile),
    [reviewComments, review.diffViewFile]
  );

  const interleaveResult = useMemo(() => {
    if (!fileDiffData || fileComments.length === 0) return null;
    return interleaveComments(
      fileDiffData.fileDiffLines,
      fileDiffData.rendered,
      fileComments,
      terminal.paneCols,
      review.selectedCommentId,
      review.pendingDeleteCommentId,
      review.editingCommentId,
      review.editBuffer
    );
  }, [
    fileDiffData,
    fileComments,
    terminal.paneCols,
    review.selectedCommentId,
    review.pendingDeleteCommentId,
    review.editingCommentId,
    review.editBuffer,
  ]);

  const annotatedLines = useMemo(() => {
    if (interleaveResult) return interleaveResult.lines;
    if (!fileDiffData) return [];
    return fileDiffData.rendered.map((line) => ({
      type: 'diff' as const,
      rendered: line,
    }));
  }, [interleaveResult, fileDiffData]);

  const diffTotalLines = annotatedLines.length;

  const commentPositions = useMemo(() => {
    if (!interleaveResult || fileComments.length === 0) return new Map();
    return getCommentPositions(
      interleaveResult.lines,
      interleaveResult.insertionMap,
      fileComments
    );
  }, [interleaveResult, fileComments]);

  // ── Scroll wheel (experimental) ──────────────────────────────────
  const scrollWheelActive =
    nav.activeTab === 'reviews' &&
    review.reviewPane === 'diff-file' &&
    !terminalFocused;

  const { setDiffScrollOffset } = review;
  const handleScrollWheel = useCallback(
    (delta: number) => {
      const viewportHeight = Math.max(1, terminal.paneRows - 3);
      const maxScroll = Math.max(0, diffTotalLines - viewportHeight);
      setDiffScrollOffset((o) => Math.max(0, Math.min(o + delta, maxScroll)));
    },
    [terminal.paneRows, diffTotalLines, setDiffScrollOffset]
  );

  useScrollWheel(scrollWheelActive, handleScrollWheel);

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
          commentCtx: selectedReviewPr
            ? {
                comments: reviewComments,
                prId: selectedReviewPr.id,
                positions: commentPositions,
                selectedReviewPr,
              }
            : undefined,
          config: configCtx,
          sessions: sessionCtx,
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
          diffScrollOffset={review.diffScrollOffset}
          diffLoading={diffData.loading}
          diffTextLoading={diffData.diffLoading}
          diffError={diffData.error}
          showSkipped={review.showSkipped}
          paneRows={terminal.paneRows}
          paneCols={terminal.paneCols}
          comments={reviewComments}
          annotatedLines={annotatedLines}
        />
      )}
    </>
  );
}
