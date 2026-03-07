import { useMemo, useRef, useEffect } from 'react';
import { useInput } from 'ink';
import { ReviewsSidebar } from '../components/ReviewsSidebar.js';
import { ReviewPane } from '../components/ReviewPane.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { useAppState } from '../context/AppStateContext.js';
import { useSessionContext } from '../context/SessionContext.js';
import { useReviewContext } from '../context/ReviewContext.js';
import { useConfig } from '../context/ConfigContext.js';
import { useDiffData } from '../hooks/useDiffData.js';
import { partitionFiles } from '../utils/file-classifier.js';
import { parseUnifiedDiff } from '../utils/diff-parser.js';
import { renderDiffLines } from '../utils/diff-renderer.js';
import { handleSettingsInput } from '../input-handlers.js';
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
    return renderDiffLines(fileDiffLines, terminal.paneCols).length;
  }, [review.diffViewFile, diffData.diffText, terminal.paneCols]);

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
        refreshPr: sessionCtx.refreshPr,
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
        />
      )}
    </>
  );
}
