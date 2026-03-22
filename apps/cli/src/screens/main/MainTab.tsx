import { useMemo, useCallback } from 'react';
import { useInput } from 'ink';
import { Sidebar } from '../../components/Sidebar.js';
import { TerminalView } from '../../components/TerminalView.js';
import { BranchPicker } from '../sessions/BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { ReviewConfirmPane } from '../reviews/ReviewConfirmPane.js';
import { ReviewDetailPane } from '../reviews/ReviewDetailPane.js';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { DiffViewer } from '../reviews/DiffViewer.js';
import { useAppState } from '../../context/AppStateContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useSidebar } from '../../context/SidebarContext.js';
import { usePaneMode } from '../../hooks/usePaneMode.js';
import type { PaneModeValue } from '../../hooks/usePaneMode.js';
import { useDiffState } from '../../hooks/useDiffState.js';
import { useCommentState } from '../../hooks/useCommentState.js';
import { useReviewConfirmState } from '../../hooks/useReviewConfirmState.js';
import { useDiffData } from '../../hooks/useDiffData.js';
import { useReviewComments } from '../../hooks/useReviewComments.js';
import { useScrollWheel } from '../../hooks/useScrollWheel.js';
import { useTerminal } from '../../hooks/useTerminal.js';
import { partitionFiles } from '../../utils/file-classifier.js';
import { parseUnifiedDiff } from '../../utils/diff-parser.js';
import { renderDiffLines } from '../../utils/diff-renderer.js';
import {
  interleaveComments,
  getCommentPositions,
} from '../../utils/comment-renderer.js';
import { handleSettingsInput } from '../../input-handlers.js';
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleDiffFileListInput,
  handleDiffViewerInput,
  handleConfirmInput,
  handleSidebarInput,
} from './main-input.js';

interface MainTabProps {
  terminalFocused: boolean;
  showOnboarding: boolean;
  exit: () => void;
}

export function MainTab({
  terminalFocused,
  showOnboarding,
  exit,
}: MainTabProps) {
  const appState = useAppState();
  const { nav, asyncOps, branchPicker, deleteConfirm, settings, terminal } =
    appState;
  const sessionCtx = useSessionActions();
  const configCtx = useConfig();
  const sidebar = useSidebar();

  const paneModeHook = usePaneMode(
    sidebar.selectedItem,
    sidebar.sessionNameForTerminal
  );
  const diffState = useDiffState();
  const commentState = useCommentState();
  const reviewConfirmState = useReviewConfirmState();

  // Compose into the single pane object that input handlers expect
  const pane: PaneModeValue = useMemo(
    () => ({
      ...paneModeHook,
      ...diffState,
      ...commentState,
      ...reviewConfirmState,
    }),
    [paneModeHook, diffState, commentState, reviewConfirmState]
  );

  const terminalHook = useTerminal(
    sidebar.sessionNameForTerminal,
    terminal.paneCols,
    terminal.paneRows,
    pane.reconnectKey,
    terminalFocused,
    () => nav.setFocus('sidebar')
  );

  // ── Review comments (file-watched) ────────────────────────────
  const reviewComments = useReviewComments(sidebar.selectedPr?.id ?? null);

  // ── Diff data ─────────────────────────────────────────────────
  const diffPrNumber = sidebar.selectedPr?.id ?? null;
  const diffData = useDiffData(
    pane.paneMode === 'diff' || pane.paneMode === 'diff-file'
      ? diffPrNumber
      : null,
    sidebar.selectedPr?.sourceBranch ?? '',
    sidebar.selectedPr?.targetBranch ?? ''
  );

  const { normal: diffNormalFiles, skipped: diffSkippedFiles } = useMemo(
    () => partitionFiles(diffData.files),
    [diffData.files]
  );
  const diffDisplayCount = pane.showSkipped
    ? diffNormalFiles.length + diffSkippedFiles.length
    : diffNormalFiles.length;

  // Parsed diff data for current file
  const fileDiffData = useMemo(() => {
    if (!pane.diffViewFile || !diffData.diffText) return null;
    const allDiffs = parseUnifiedDiff(diffData.diffText);
    const fileDiffLines = allDiffs.get(pane.diffViewFile);
    if (!fileDiffLines) return null;
    const rendered = renderDiffLines(fileDiffLines, terminal.paneCols);
    return { fileDiffLines, rendered };
  }, [pane.diffViewFile, diffData.diffText, terminal.paneCols]);

  const fileComments = useMemo(
    () => reviewComments.filter((c) => c.file === pane.diffViewFile),
    [reviewComments, pane.diffViewFile]
  );

  const interleaveResult = useMemo(() => {
    if (!fileDiffData || fileComments.length === 0) return null;
    return interleaveComments(
      fileDiffData.fileDiffLines,
      fileDiffData.rendered,
      fileComments,
      terminal.paneCols,
      pane.selectedCommentId,
      pane.pendingDeleteCommentId,
      pane.editingCommentId,
      pane.editBuffer
    );
  }, [
    fileDiffData,
    fileComments,
    terminal.paneCols,
    pane.selectedCommentId,
    pane.pendingDeleteCommentId,
    pane.editingCommentId,
    pane.editBuffer,
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

  // ── Scroll wheel ──────────────────────────────────────────────
  const scrollWheelActive = pane.paneMode === 'diff-file' && !terminalFocused;

  const { setDiffScrollOffset } = pane;
  const handleScrollWheel = useCallback(
    (delta: number) => {
      const viewportHeight = Math.max(1, terminal.paneRows - 3);
      const maxScroll = Math.max(0, diffTotalLines - viewportHeight);
      setDiffScrollOffset((o) => Math.max(0, Math.min(o + delta, maxScroll)));
    },
    [terminal.paneRows, diffTotalLines, setDiffScrollOffset]
  );

  useScrollWheel(scrollWheelActive, handleScrollWheel);

  // ── Input handler ─────────────────────────────────────────────
  useInput((input, key) => {
    if (terminalFocused) return;
    if (showOnboarding) return;

    // 1. Branch picker
    if (branchPicker.creating) {
      return handleBranchPickerInput(input, key, {
        branchPicker,
        sessions: sessionCtx,
        asyncOps,
        terminal,
        config: configCtx,
      });
    }

    // 2. Delete confirm
    if (deleteConfirm.confirmDelete) {
      return handleConfirmDeleteInput(input, key, {
        deleteConfirm,
        sessions: sessionCtx,
        asyncOps,
      });
    }

    // 3. Settings
    if (settings.settingsOpen) {
      return handleSettingsInput(input, key, {
        settings,
        config: configCtx,
        sessions: sessionCtx,
      });
    }

    // 4. Confirm dialog
    if (pane.reviewConfirm) {
      return handleConfirmInput(input, key, {
        pane,
        nav,
        asyncOps,
        sessions: sessionCtx,
        sidebar,
        terminal,
        config: configCtx,
        selectedItem: sidebar.selectedItem,
        sessionNameForTerminal: sidebar.sessionNameForTerminal,
      });
    }

    // 5. Diff file list
    if (pane.paneMode === 'diff') {
      return handleDiffFileListInput(input, key, {
        pane,
        diffFiles: diffData.files,
        diffDisplayCount,
        loadDiffText: diffData.loadDiffText,
      });
    }

    // 6. Diff viewer
    if (pane.paneMode === 'diff-file') {
      return handleDiffViewerInput(input, key, {
        pane,
        diffFiles: diffData.files,
        terminal,
        diffTotalLines,
        commentCtx: sidebar.selectedPr
          ? {
              comments: reviewComments,
              prId: sidebar.selectedPr.id,
              positions: commentPositions,
              selectedReviewPr: sidebar.selectedPr,
            }
          : undefined,
        config: configCtx,
        sessions: sessionCtx,
      });
    }

    // 7. Default: sidebar navigation
    handleSidebarInput(input, key, {
      nav,
      config: configCtx,
      sessions: sessionCtx,
      sidebar,
      branchPicker,
      deleteConfirm,
      settings,
      asyncOps,
      terminal,
      pane,
      exit,
    });
  });

  // ── Render ────────────────────────────────────────────────────
  const sidebarFocused =
    nav.focus === 'sidebar' &&
    !branchPicker.creating &&
    !settings.settingsOpen &&
    !pane.reviewConfirm;

  return (
    <>
      <Sidebar
        items={sidebar.items}
        selectedIndex={sidebar.clampedIndex}
        sidebarWidth={appState.sidebarWidth}
        termRows={appState.termRows}
        focused={sidebarFocused}
      />
      {settings.settingsOpen && (
        <SettingsPanel
          fieldIndex={settings.settingsFieldIndex}
          editingField={settings.editingField}
          editBuffer={settings.editBuffer}
        />
      )}
      {!settings.settingsOpen && branchPicker.creating && (
        <BranchPicker
          filter={branchPicker.branchFilter}
          branches={branchPicker.branches}
          selectedIndex={branchPicker.branchIndex}
          paneRows={terminal.paneRows}
        />
      )}
      {!settings.settingsOpen && !branchPicker.creating && (
        <>
          {pane.reviewConfirm && (
            <ReviewConfirmPane
              pr={pane.reviewConfirm.pr}
              selectedOption={pane.reviewConfirm.selectedOption}
              instruction={pane.reviewInstruction}
            />
          )}
          {!pane.reviewConfirm && pane.paneMode === 'terminal' && (
            <TerminalView
              content={terminalHook.content}
              focused={nav.focus === 'terminal'}
            />
          )}
          {!pane.reviewConfirm && pane.paneMode === 'pr-detail' && (
            <ReviewDetailPane pr={sidebar.selectedPr} />
          )}
          {!pane.reviewConfirm && pane.paneMode === 'diff' && (
            <DiffFileList
              files={diffData.files}
              selectedIndex={pane.diffFileIndex}
              paneRows={terminal.paneRows}
              paneCols={terminal.paneCols}
              loading={diffData.loading}
              error={diffData.error}
              showSkipped={pane.showSkipped}
              comments={reviewComments}
            />
          )}
          {!pane.reviewConfirm &&
            pane.paneMode === 'diff-file' &&
            pane.diffViewFile && (
              <DiffViewer
                filename={pane.diffViewFile}
                annotatedLines={annotatedLines}
                scrollOffset={pane.diffScrollOffset}
                paneRows={terminal.paneRows}
                paneCols={terminal.paneCols}
                loading={diffData.diffLoading}
              />
            )}
        </>
      )}
    </>
  );
}
