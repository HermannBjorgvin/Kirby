import { useState, useMemo, useEffect, useCallback } from 'react';
import { render, Text, Box, useInput, useApp, useStdout } from 'ink';
import type { Key } from 'ink';
import { branchToSessionName } from '@kirby/tmux-manager';
import type {
  VcsProvider,
  PullRequestInfo,
  CategorizedReviews,
} from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import { TabBar } from './components/TabBar.js';
import { Sidebar } from './components/Sidebar.js';
import { TerminalView } from './components/TerminalView.js';
import { BranchPicker } from './components/BranchPicker.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ReviewsSidebar } from './components/ReviewsSidebar.js';
import { ReviewDetailPane } from './components/ReviewDetailPane.js';
import { ReviewConfirmPane } from './components/ReviewConfirmPane.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { usePrData } from './hooks/usePrData.js';
import { useRemoteSync } from './hooks/useRemoteSync.js';
import { useMergedBranches } from './hooks/useMergedBranches.js';
import { useAsyncOperation } from './hooks/useAsyncOperation.js';
import { usePtySession } from './hooks/usePtySession.js';
import { useConflictCounts } from './hooks/useConflictCounts.js';
import { useNavigation } from './hooks/useNavigation.js';
import { useBranchPicker } from './hooks/useBranchPicker.js';
import { useDeleteConfirmation } from './hooks/useDeleteConfirmation.js';
import { useSettings } from './hooks/useSettings.js';
import { useSessionManager } from './hooks/useSessionManager.js';
import { useReviewManager } from './hooks/useReviewManager.js';
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleSettingsInput,
  handleGlobalInput,
  handleReviewConfirmInput,
} from './input-handlers.js';
import type { AppContext, Focus } from './input-handlers.js';
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
  sessionCount,
  focus,
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
  sessionCount: number;
  focus: Focus;
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
      {sessionCount} sessions · focus: <Text color="cyan">{focus}</Text>
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

  const [paneContent, setPaneContent] = useState('(loading...)');
  const [reconnectKey, setReconnectKey] = useState(0);
  const { prMap, error: prError, refresh: refreshPr } = usePrData();

  // Async operation tracker
  const { run: runOp, isRunning, inFlight } = useAsyncOperation();

  // Event-driven sync chain
  const { lastSynced, triggerSync } = useRemoteSync();

  const { mergedBranches } = useMergedBranches(
    sessionMgr.worktreeBranches,
    lastSynced,
    (sessionName, branch) => {
      sessionMgr.performDelete(sessionName, branch);
      sessionMgr.flashStatus(`Auto-deleted merged branch: ${branch}`);
    }
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
    return Object.values(prMap)
      .filter(
        (pr): pr is PullRequestInfo =>
          pr != null &&
          provider.matchesUser(pr.createdByIdentifier, config) &&
          !sessionNames.has(branchToSessionName(pr.sourceBranch))
      )
      .sort((a, b) => b.id - a.id);
  }, [prMap, sessionMgr.sessions, config, provider]);

  // Categorize PRs where the user is a reviewer
  const categorizedReviews = useMemo((): CategorizedReviews => {
    if (!provider)
      return { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
    const needsReview: PullRequestInfo[] = [];
    const waitingForAuthor: PullRequestInfo[] = [];
    const approvedByYou: PullRequestInfo[] = [];

    for (const pr of Object.values(prMap)) {
      if (!pr || !pr.reviewers) continue;
      const reviewer = pr.reviewers.find((r) =>
        provider.matchesUser(r.identifier, config)
      );
      if (!reviewer) continue;
      if (reviewer.decision === 'declined') continue;
      if (reviewer.decision === 'approved') {
        approvedByYou.push(pr);
      } else if (reviewer.decision === 'changes-requested') {
        waitingForAuthor.push(pr);
      } else {
        needsReview.push(pr);
      }
    }
    return { needsReview, waitingForAuthor, approvedByYou };
  }, [prMap, config, provider]);

  const reviewTotalItems =
    categorizedReviews.needsReview.length +
    categorizedReviews.waitingForAuthor.length +
    categorizedReviews.approvedByYou.length;

  useEffect(() => {
    if (
      reviewTotalItems > 0 &&
      review.reviewSelectedIndex >= reviewTotalItems
    ) {
      review.setReviewSelectedIndex(reviewTotalItems - 1);
    }
  }, [reviewTotalItems, review.reviewSelectedIndex]);

  // Pre-compute session-name → branch and session-name → PR lookup maps
  const { sessionBranchMap, sessionPrMap } = useMemo(() => {
    const branchMap = new Map<string, string>();
    const prLookup = new Map<string, PullRequestInfo>();
    for (const [branch, pr] of Object.entries(prMap)) {
      const name = branchToSessionName(branch);
      branchMap.set(name, branch);
      if (pr) prLookup.set(name, pr);
    }
    return { sessionBranchMap: branchMap, sessionPrMap: prLookup };
  }, [prMap]);

  // Sort sessions by associated PR number (newest first)
  const sortedSessions = useMemo(() => {
    return [...sessionMgr.sessions].sort((a, b) => {
      const idA = sessionPrMap.get(a.name)?.id ?? -Infinity;
      const idB = sessionPrMap.get(b.name)?.id ?? -Infinity;
      return idB - idA;
    });
  }, [sessionMgr.sessions, sessionPrMap]);

  const totalItems = sortedSessions.length + orphanPrs.length;
  const selectedSession =
    sessionMgr.selectedIndex < sortedSessions.length
      ? sortedSessions[sessionMgr.selectedIndex]
      : undefined;
  const selectedName = selectedSession?.name ?? null;

  // Flatten categorized reviews and pick the selected one
  const allReviewPrs = useMemo(
    () => [
      ...categorizedReviews.needsReview,
      ...categorizedReviews.waitingForAuthor,
      ...categorizedReviews.approvedByYou,
    ],
    [categorizedReviews]
  );
  const selectedReviewPr = allReviewPrs[review.reviewSelectedIndex];
  const reviewSessionName = selectedReviewPr
    ? `review-pr-${selectedReviewPr.id}`
    : null;

  useEffect(() => {
    if (totalItems > 0 && sessionMgr.selectedIndex >= totalItems) {
      sessionMgr.setSelectedIndex(totalItems - 1);
    }
  }, [totalItems, sessionMgr.selectedIndex]);

  const { write: ptyWrite } = usePtySession(
    selectedName,
    paneCols,
    paneRows,
    setPaneContent,
    reconnectKey
  );

  const { write: ptyWriteReview } = usePtySession(
    nav.activeTab === 'reviews' ? reviewSessionName : null,
    paneCols,
    paneRows,
    review.setReviewPaneContent,
    review.reviewReconnectKey
  );

  const keyToAnsi = useCallback((input: string, key: Key): string | null => {
    if (key.return) return '\r';
    if (key.backspace || key.delete) return '\x7f';
    if (key.upArrow) return '\x1b[A';
    if (key.downArrow) return '\x1b[B';
    if (key.rightArrow) return '\x1b[C';
    if (key.leftArrow) return '\x1b[D';
    if (key.tab) return null; // reserved for focus switching
    if (key.escape) return '\x1b';
    if (key.ctrl && input === 'c') return '\x03';
    if (key.ctrl && input === 'd') return '\x04';
    if (key.ctrl && input === 'z') return '\x1a';
    if (key.ctrl && input === 'l') return '\x0c';
    if (input) return input;
    return null;
  }, []);

  const sendInput = useCallback(
    (input: string, key: Key) => {
      const data = keyToAnsi(input, key);
      if (data) ptyWrite(data);
    },
    [ptyWrite, keyToAnsi]
  );

  const sendReviewInput = useCallback(
    (input: string, key: Key) => {
      const data = keyToAnsi(input, key);
      if (data) ptyWriteReview(data);
    },
    [ptyWriteReview, keyToAnsi]
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
    selectedIndex: sessionMgr.selectedIndex,
    sessions: sortedSessions,
    orphanPrs,
    totalItems,
    reviewSelectedIndex: review.reviewSelectedIndex,
    reviewTotalItems,
    reviewSessionName,
    selectedReviewPr,
    sendReviewInput,
    setReviewReconnectKey: review.setReviewReconnectKey,
    reviewSessionStarted: review.reviewSessionStarted,
    setReviewSessionStarted: review.setReviewSessionStarted,
    reviewConfirm: review.reviewConfirm,
    setReviewConfirm: review.setReviewConfirm,
    reviewInstruction: review.reviewInstruction,
    setReviewInstruction: review.setReviewInstruction,
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
    sendInput,
    exit,
    updateField,
    runOp,
    isRunning,
  };

  useInput((input, key) => {
    if (showOnboarding) return;
    if (branchPicker.creating) return handleBranchPickerInput(input, key, ctx);
    if (deleteConfirm.confirmDelete)
      return handleConfirmDeleteInput(input, key, ctx);
    if (settings.settingsOpen) return handleSettingsInput(input, key, ctx);
    if (review.reviewConfirm) return handleReviewConfirmInput(input, key, ctx);
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
            sessionCount={sortedSessions.length}
            focus={nav.focus}
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
              selectedIndex={sessionMgr.selectedIndex}
              focused={
                nav.focus === 'sidebar' &&
                !branchPicker.creating &&
                !settings.settingsOpen
              }
              prMap={prMap}
              sessionBranchMap={sessionBranchMap}
              sessionPrMap={sessionPrMap}
              sidebarWidth={sidebarWidth}
              orphanPrs={orphanPrs}
              mergedBranches={mergedBranches}
              lastSynced={lastSynced}
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
                content={paneContent}
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
              focused={nav.focus === 'sidebar' && !review.reviewConfirm}
            />
            {(() => {
              if (review.reviewConfirm) {
                return (
                  <ReviewConfirmPane
                    pr={review.reviewConfirm.pr}
                    selectedOption={review.reviewConfirm.selectedOption}
                    instruction={review.reviewInstruction}
                  />
                );
              }
              if (
                selectedReviewPr &&
                review.reviewSessionStarted.has(selectedReviewPr.id)
              ) {
                return (
                  <TerminalView
                    content={review.reviewPaneContent}
                    focused={nav.focus === 'terminal'}
                  />
                );
              }
              return <ReviewDetailPane pr={selectedReviewPr} />;
            })()}
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

render(
  <ConfigProvider providers={providers}>
    <App forceSetup={forceSetup} />
  </ConfigProvider>
);
