import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { render, Text, Box, useInput, useApp, useStdout } from 'ink';
import type { VcsProvider, CategorizedReviews } from '@kirby/vcs-core';
import {
  findOrphanPrs,
  categorizeReviews as categorizePrReviews,
  buildSessionLookups,
} from './utils/pr-utils.js';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { TabBar } from './components/TabBar.js';
import { Sidebar } from './components/Sidebar.js';
import { TerminalView } from './components/TerminalView.js';
import { BranchPicker } from './components/BranchPicker.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ReviewsSidebar } from './components/ReviewsSidebar.js';
import { ReviewPane } from './components/ReviewPane.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { usePrData } from './hooks/usePrData.js';
import { useRemoteSync } from './hooks/useRemoteSync.js';
import { useMergedBranches } from './hooks/useMergedBranches.js';
import { useAsyncOperation } from './hooks/useAsyncOperation.js';
import { useTerminal } from './hooks/useTerminal.js';
import { useConflictCounts } from './hooks/useConflictCounts.js';
import { useNavigation } from './hooks/useNavigation.js';
import { useBranchPicker } from './hooks/useBranchPicker.js';
import { useDeleteConfirmation } from './hooks/useDeleteConfirmation.js';
import { useSettings } from './hooks/useSettings.js';
import { useSessionManager } from './hooks/useSessionManager.js';
import { useReviewManager } from './hooks/useReviewManager.js';
import { useDiffData } from './hooks/useDiffData.js';
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleSettingsInput,
  handleGlobalInput,
  handleReviewConfirmInput,
  handleDiffFileListInput,
  handleDiffViewerInput,
} from './input-handlers.js';
import type { AppContext } from './input-handlers.js';
import { killAll } from './pty-registry.js';
import { partitionFiles } from './utils/file-classifier.js';
import { parseUnifiedDiff } from './utils/diff-parser.js';
import { renderDiffLines } from './utils/diff-renderer.js';
import { ConfigProvider, useConfig } from './context/ConfigContext.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// ── Status bar ─────────────────────────────────────────────────────

function StatusBar({
  confirmDelete,
  confirmInput,
  creating,
  branchFilter,
  statusMessage,
  prError,
  inFlight,
}: {
  confirmDelete: {
    branch: string;
    sessionName: string;
    reason: string;
  } | null;
  confirmInput: string;
  creating: boolean;
  branchFilter: string;
  statusMessage: string | null;
  prError: string | null;
  inFlight: Set<string>;
}) {
  const { vcsConfigured } = useConfig();
  if (confirmDelete) {
    return (
      <Text>
        <Text color="red">Warning: {confirmDelete.reason}. Type </Text>
        <Text bold color="yellow">
          {confirmDelete.branch}
        </Text>
        <Text color="red"> to confirm: </Text>
        <Text color="cyan">{confirmInput}</Text>
        <Text dimColor>_</Text>
        <Text dimColor> · Esc cancel</Text>
      </Text>
    );
  }
  if (creating) {
    return (
      <Text>
        Branch: <Text color="cyan">{branchFilter}</Text>
        <Text dimColor>_</Text>
        <Text dimColor> · Enter select · Esc cancel</Text>
      </Text>
    );
  }
  if (statusMessage) {
    return <Text color="yellow">{statusMessage}</Text>;
  }
  if (prError) {
    return <Text color="red">PR error: {prError}</Text>;
  }

  const ops = inFlight.size > 0 ? ` · ${[...inFlight].join(', ')}...` : '';

  return (
    <Text dimColor>
      {!vcsConfigured ? ' · (s to configure VCS)' : ''}
      {ops ? <Text color="yellow">{ops}</Text> : null}
    </Text>
  );
}

// ── App ────────────────────────────────────────────────────────────

function App({ forceSetup }: { forceSetup: boolean }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const { config, setConfig, provider, providers, vcsConfigured, updateField } =
    useConfig();
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  // Show onboarding when vendor was auto-detected but VCS isn't fully configured,
  // or when --setup flag is passed to force re-configuration
  const showOnboarding =
    !onboardingComplete &&
    !!config.vendor &&
    !!provider &&
    (!vcsConfigured || forceSetup);

  const sidebarWidth = 48;
  const paneCols = Math.max(20, termCols - sidebarWidth - 2);
  const paneRows = Math.max(5, termRows - 5); // top bar (3) + TerminalView header (2)

  // ── Domain hooks ──────────────────────────────────────────────────
  const nav = useNavigation();
  const branchPicker = useBranchPicker();
  const deleteConfirm = useDeleteConfirmation();
  const settings = useSettings();
  const review = useReviewManager();

  const sessionMgr = useSessionManager(
    providers,
    setConfig,
    branchPicker.setBranches
  );

  const [reconnectKey, setReconnectKey] = useState(0);
  const { prMap, error: prError, refresh: refreshPr } = usePrData();

  // Async operation tracker
  const { run: runOp, isRunning, inFlight } = useAsyncOperation();

  // Event-driven sync chain
  const { lastSynced, triggerSync } = useRemoteSync();

  const onMergedDelete = useCallback(
    (sessionName: string, branch: string) => {
      sessionMgr.performDelete(sessionName, branch);
      sessionMgr.flashStatus(`Auto-deleted merged branch: ${branch}`);
    },
    [sessionMgr]
  );

  const { mergedBranches } = useMergedBranches(
    sessionMgr.worktreeBranches,
    lastSynced,
    onMergedDelete
  );

  // Batch conflict checking — only check non-merged branches
  const conflictBranches = useMemo(
    () => sessionMgr.worktreeBranches.filter((b) => !mergedBranches.has(b)),
    [sessionMgr.worktreeBranches, mergedBranches]
  );
  const { counts: conflictCounts, loading: conflictsLoading } =
    useConflictCounts(conflictBranches, lastSynced);

  // Orphan PRs: user's PRs that don't have a matching worktree session
  const orphanPrs = useMemo(() => {
    if (!provider) return [];
    const sessionNames = new Set(sessionMgr.sessions.map((s) => s.name));
    return findOrphanPrs(prMap, sessionNames, config, provider);
  }, [prMap, sessionMgr.sessions, config, provider]);

  // Categorize PRs where the user is a reviewer
  const categorizedReviews = useMemo((): CategorizedReviews => {
    if (!provider)
      return { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
    return categorizePrReviews(prMap, config, provider);
  }, [prMap, config, provider]);

  const reviewTotalItems =
    categorizedReviews.needsReview.length +
    categorizedReviews.waitingForAuthor.length +
    categorizedReviews.approvedByYou.length;

  const clampedReviewIndex =
    reviewTotalItems > 0
      ? Math.min(review.reviewSelectedIndex, reviewTotalItems - 1)
      : 0;

  // Flatten categorized reviews and pick the selected one
  const allReviewPrs = useMemo(
    () => [
      ...categorizedReviews.needsReview,
      ...categorizedReviews.waitingForAuthor,
      ...categorizedReviews.approvedByYou,
    ],
    [categorizedReviews]
  );
  const selectedReviewPr = allReviewPrs[clampedReviewIndex];
  const reviewSessionName = selectedReviewPr
    ? `review-pr-${selectedReviewPr.id}`
    : null;

  // ── Diff data for review pane ───────────────────────────────────
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

  // Compute total rendered lines for the currently viewed file (for scroll bounds)
  const diffTotalLines = useMemo(() => {
    if (!review.diffViewFile || !diffData.diffText) return 0;
    const allDiffs = parseUnifiedDiff(diffData.diffText);
    const fileDiffLines = allDiffs.get(review.diffViewFile);
    if (!fileDiffLines) return 0;
    return renderDiffLines(fileDiffLines, paneCols).length;
  }, [review.diffViewFile, diffData.diffText, paneCols]);

  // Pre-compute session-name → branch and session-name → PR lookup maps
  const { sessionBranchMap, sessionPrMap } = useMemo(
    () => buildSessionLookups(prMap),
    [prMap]
  );

  // Sort sessions by associated PR number (newest first)
  const sortedSessions = useMemo(() => {
    return [...sessionMgr.sessions].sort((a, b) => {
      const idA = sessionPrMap.get(a.name)?.id ?? -Infinity;
      const idB = sessionPrMap.get(b.name)?.id ?? -Infinity;
      return idB - idA;
    });
  }, [sessionMgr.sessions, sessionPrMap]);

  const totalItems = sortedSessions.length + orphanPrs.length;
  const clampedSelectedIndex =
    totalItems > 0 ? Math.min(sessionMgr.selectedIndex, totalItems - 1) : 0;
  const selectedSession =
    clampedSelectedIndex < sortedSessions.length
      ? sortedSessions[clampedSelectedIndex]
      : undefined;
  const selectedName = selectedSession?.name ?? null;

  // Reset review pane when selected PR changes (unless session is active)
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
  }, [selectedReviewPr?.id, review.reviewSessionStarted]);

  // ── Terminal hooks (PTY session + raw stdin forwarding) ─────────
  const terminalFocused = nav.focus === 'terminal';
  const escapeTerminal = () => nav.setFocus('sidebar');

  const sessionsTerminal = useTerminal(
    selectedName,
    paneCols,
    paneRows,
    reconnectKey,
    terminalFocused && nav.activeTab === 'sessions',
    escapeTerminal
  );
  const reviewsTerminal = useTerminal(
    nav.activeTab === 'reviews' ? reviewSessionName : null,
    paneCols,
    paneRows,
    review.reviewReconnectKey,
    terminalFocused && nav.activeTab === 'reviews',
    escapeTerminal
  );

  // ── Assemble AppContext for input handlers ────────────────────────
  const ctx: AppContext = {
    config,
    provider,
    providers,
    vcsConfigured,
    branches: branchPicker.branches,
    branchFilter: branchPicker.branchFilter,
    branchIndex: branchPicker.branchIndex,
    paneCols,
    paneRows,
    confirmDelete: deleteConfirm.confirmDelete,
    confirmInput: deleteConfirm.confirmInput,
    editingField: settings.editingField,
    settingsFieldIndex: settings.settingsFieldIndex,
    editBuffer: settings.editBuffer,
    activeTab: nav.activeTab,
    focus: nav.focus,
    selectedName,
    selectedSession,
    selectedIndex: clampedSelectedIndex,
    sessions: sortedSessions,
    orphanPrs,
    totalItems,
    reviewSelectedIndex: clampedReviewIndex,
    reviewTotalItems,
    reviewSessionName,
    selectedReviewPr,
    setReviewReconnectKey: review.setReviewReconnectKey,
    reviewSessionStarted: review.reviewSessionStarted,
    setReviewSessionStarted: review.setReviewSessionStarted,
    reviewConfirm: review.reviewConfirm,
    setReviewConfirm: review.setReviewConfirm,
    reviewInstruction: review.reviewInstruction,
    setReviewInstruction: review.setReviewInstruction,
    reviewPane: review.reviewPane,
    setReviewPane: review.setReviewPane,
    diffFileIndex: review.diffFileIndex,
    setDiffFileIndex: review.setDiffFileIndex,
    diffFiles: diffData.files,
    diffDisplayCount,
    showSkipped: review.showSkipped,
    setShowSkipped: review.setShowSkipped,
    diffViewFile: review.diffViewFile,
    setDiffViewFile: review.setDiffViewFile,
    diffScrollOffset: review.diffScrollOffset,
    setDiffScrollOffset: review.setDiffScrollOffset,
    diffTotalLines,
    loadDiffText: diffData.loadDiffText,
    setCreating: branchPicker.setCreating,
    setBranchFilter: branchPicker.setBranchFilter,
    setBranchIndex: branchPicker.setBranchIndex,
    setSelectedIndex: sessionMgr.setSelectedIndex,
    setConfirmDelete: deleteConfirm.setConfirmDelete,
    setConfirmInput: deleteConfirm.setConfirmInput,
    setSettingsOpen: settings.setSettingsOpen,
    setSettingsFieldIndex: settings.setSettingsFieldIndex,
    setEditingField: settings.setEditingField,
    setEditBuffer: settings.setEditBuffer,
    setActiveTab: nav.setActiveTab,
    setReviewSelectedIndex: review.setReviewSelectedIndex,
    setConfig,
    setFocus: nav.setFocus,
    setReconnectKey,
    setBranches: branchPicker.setBranches,
    flashStatus: sessionMgr.flashStatus,
    triggerSync,
    refreshSessions: sessionMgr.refreshSessions,
    refreshPr,
    performDelete: sessionMgr.performDelete,
    exit,
    updateField,
    runOp,
    isRunning,
  };

  useInput((input, key) => {
    if (terminalFocused) return; // raw stdin handler forwards to PTY
    if (showOnboarding) return;
    if (branchPicker.creating) return handleBranchPickerInput(input, key, ctx);
    if (deleteConfirm.confirmDelete)
      return handleConfirmDeleteInput(input, key, ctx);
    if (settings.settingsOpen) return handleSettingsInput(input, key, ctx);
    if (review.reviewConfirm) return handleReviewConfirmInput(input, key, ctx);
    if (nav.activeTab === 'reviews' && review.reviewPane === 'diff')
      return handleDiffFileListInput(input, key, ctx);
    if (nav.activeTab === 'reviews' && review.reviewPane === 'diff-file')
      return handleDiffViewerInput(input, key, ctx);
    handleGlobalInput(input, key, ctx);
  });

  if (showOnboarding) {
    return (
      <Box flexDirection="column" height={termRows}>
        <OnboardingWizard onComplete={() => setOnboardingComplete(true)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termRows}>
      <Box paddingX={1} justifyContent="space-between" marginBottom={1}>
        <Box gap={2}>
          <Text bold>😸 Kirby</Text>
          <TabBar
            activeTab={nav.activeTab}
            reviewCount={categorizedReviews.needsReview.length}
          />
          <StatusBar
            confirmDelete={deleteConfirm.confirmDelete}
            confirmInput={deleteConfirm.confirmInput}
            creating={branchPicker.creating}
            branchFilter={branchPicker.branchFilter}
            statusMessage={sessionMgr.statusMessage}
            prError={prError}
            inFlight={inFlight}
          />
        </Box>
        <Text dimColor>{process.cwd()}</Text>
      </Box>
      <Box flexGrow={1}>
        {nav.activeTab === 'sessions' && (
          <>
            <Sidebar
              sessions={sortedSessions}
              selectedIndex={clampedSelectedIndex}
              focused={
                nav.focus === 'sidebar' &&
                !branchPicker.creating &&
                !settings.settingsOpen
              }
              sessionBranchMap={sessionBranchMap}
              sessionPrMap={sessionPrMap}
              sidebarWidth={sidebarWidth}
              orphanPrs={orphanPrs}
              mergedBranches={mergedBranches}
              conflictCounts={conflictCounts}
              conflictsLoading={conflictsLoading}
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
                paneRows={paneRows}
              />
            )}
            {!settings.settingsOpen && !branchPicker.creating && (
              <TerminalView
                content={sessionsTerminal.content}
                focused={nav.focus === 'terminal'}
              />
            )}
          </>
        )}
        {nav.activeTab === 'reviews' && vcsConfigured && (
          <>
            <ReviewsSidebar
              categorized={categorizedReviews}
              selectedPrId={selectedReviewPr?.id}
              sidebarWidth={sidebarWidth}
              paneRows={paneRows}
              focused={nav.focus === 'sidebar' && !review.reviewConfirm}
            />
            <ReviewPane
              reviewConfirm={review.reviewConfirm}
              reviewPane={review.reviewPane}
              selectedReviewPr={selectedReviewPr}
              reviewSessionStarted={review.reviewSessionStarted}
              terminalContent={reviewsTerminal.content}
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
              paneRows={paneRows}
              paneCols={paneCols}
            />
          </>
        )}
      </Box>
    </Box>
  );
}

const args = process.argv.slice(2);
const forceSetup = args.includes('--setup');
const targetDir = args.find((a) => !a.startsWith('--'));
if (targetDir) {
  process.chdir(targetDir);
}

// Kill all PTY child processes on exit to prevent orphans
process.on('exit', killAll);
process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

render(
  <ConfigProvider providers={providers}>
    <App forceSetup={forceSetup} />
  </ConfigProvider>
);
