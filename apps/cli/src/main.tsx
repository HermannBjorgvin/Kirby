import { useState, useEffect, useRef, useMemo } from 'react';
import { execSync } from 'node:child_process';
import { render, Text, Box, useInput, useApp, useStdout } from 'ink';
import {
  isAvailable,
  listSessions,
  killSession,
  removeWorktree,
  listAllBranches,
  listWorktrees,
  branchToSessionName,
} from '@kirby/tmux-manager';
import type { TmuxSession } from '@kirby/tmux-manager';
import {
  readConfig,
  isAdoConfigured,
  autoDetectProjectConfig,
} from '@kirby/azure-devops';
import type {
  PullRequestInfo,
  Config,
  ActiveTab,
  CategorizedReviews,
} from '@kirby/shared-types';
import { TabBar } from './components/TabBar.js';
import { Sidebar } from './components/Sidebar.js';
import { TerminalView } from './components/TerminalView.js';
import { BranchPicker } from './components/BranchPicker.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ReviewsSidebar } from './components/ReviewsSidebar.js';
import { ReviewDetailPane } from './components/ReviewDetailPane.js';
import { ReviewConfirmPane } from './components/ReviewConfirmPane.js';
import { usePrData } from './hooks/usePrData.js';
import { useControlMode } from './hooks/useControlMode.js';
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleSettingsInput,
  handleGlobalInput,
  handleReviewConfirmInput,
} from './input-handlers.js';
import type { AppContext, Focus } from './input-handlers.js';

function StatusBar({
  confirmDelete,
  confirmInput,
  creating,
  branchFilter,
  statusMessage,
  prError,
  sessionCount,
  focus,
  hasTmux,
  adoConfigured,
}: {
  confirmDelete: { branch: string; sessionName: string; reason: string } | null;
  confirmInput: string;
  creating: boolean;
  branchFilter: string;
  statusMessage: string | null;
  prError: string | null;
  sessionCount: number;
  focus: Focus;
  hasTmux: boolean;
  adoConfigured: boolean;
}) {
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
  return (
    <Text dimColor>
      {sessionCount} sessions · focus: <Text color="cyan">{focus}</Text> · tmux:{' '}
      {hasTmux ? '✓' : '✕'}
      {!adoConfigured ? ' · (s to configure ADO)' : ''}
    </Text>
  );
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const [config, setConfig] = useState<Config>(() => readConfig());
  const adoConfigured = isAdoConfigured(config);
  const sidebarWidth = adoConfigured ? 48 : 24;
  const paneCols = Math.max(20, termCols - sidebarWidth - 2);
  const paneRows = Math.max(5, termRows - 3); // 1 tab bar (includes status) + 1 heading + 1 separator
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions');
  const [focus, setFocus] = useState<Focus>('sidebar');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [paneContent, setPaneContent] = useState('(loading...)');
  const [hasTmux, setHasTmux] = useState(false);
  const [creating, setCreating] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const [branchIndex, setBranchIndex] = useState(0);
  const [branches, setBranches] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    branch: string;
    sessionName: string;
    reason: string;
  } | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFieldIndex, setSettingsFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [reconnectKey, setReconnectKey] = useState(0);
  const [reviewSelectedIndex, setReviewSelectedIndex] = useState(0);
  const [reviewPaneContent, setReviewPaneContent] = useState('');
  const [reviewReconnectKey, setReviewReconnectKey] = useState(0);
  const [reviewSessionStarted, setReviewSessionStarted] = useState<Set<number>>(
    new Set()
  );
  const [reviewConfirm, setReviewConfirm] = useState<{
    pr: PullRequestInfo;
    selectedOption: number;
  } | null>(null);
  const [reviewInstruction, setReviewInstruction] = useState('');
  const { prMap, error: prError, refresh: refreshPr } = usePrData(config);

  // Orphan PRs: user's PRs that don't have a matching worktree session
  const orphanPrs = useMemo(() => {
    if (!config.email) return [];
    const email = config.email.toLowerCase();
    const sessionNames = new Set(sessions.map((s) => s.name));
    return Object.values(prMap)
      .filter(
        (pr): pr is PullRequestInfo =>
          pr != null &&
          pr.createdByUniqueName?.toLowerCase() === email &&
          !sessionNames.has(branchToSessionName(pr.sourceBranch))
      )
      .sort((a, b) => b.pullRequestId - a.pullRequestId);
  }, [prMap, sessions, config.email]);

  // Categorize PRs where the user is a reviewer
  const categorizedReviews = useMemo((): CategorizedReviews => {
    if (!config.email)
      return { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
    const email = config.email.toLowerCase();
    const needsReview: PullRequestInfo[] = [];
    const waitingForAuthor: PullRequestInfo[] = [];
    const approvedByYou: PullRequestInfo[] = [];

    for (const pr of Object.values(prMap)) {
      if (!pr) continue;
      const reviewer = pr.reviewers.find(
        (r) => r.uniqueName.toLowerCase() === email
      );
      if (!reviewer) continue;
      if (reviewer.hasDeclined) continue;
      if (reviewer.vote === 5 || reviewer.vote === 10) {
        approvedByYou.push(pr);
      } else if (reviewer.vote === -5 || reviewer.vote === -10) {
        waitingForAuthor.push(pr);
      } else {
        needsReview.push(pr);
      }
    }
    return { needsReview, waitingForAuthor, approvedByYou };
  }, [prMap, config.email]);

  const reviewTotalItems =
    categorizedReviews.needsReview.length +
    categorizedReviews.waitingForAuthor.length +
    categorizedReviews.approvedByYou.length;

  useEffect(() => {
    if (reviewTotalItems > 0 && reviewSelectedIndex >= reviewTotalItems) {
      setReviewSelectedIndex(reviewTotalItems - 1);
    }
  }, [reviewTotalItems, reviewSelectedIndex]);

  // Sort sessions by associated PR number (newest first), sessions without a PR go last
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const prA = Object.values(prMap).find(
        (pr) => pr && branchToSessionName(pr.sourceBranch) === a.name
      );
      const prB = Object.values(prMap).find(
        (pr) => pr && branchToSessionName(pr.sourceBranch) === b.name
      );
      const idA = prA?.pullRequestId ?? -Infinity;
      const idB = prB?.pullRequestId ?? -Infinity;
      return idB - idA;
    });
  }, [sessions, prMap]);

  const totalItems = sortedSessions.length + orphanPrs.length;
  const selectedSession =
    selectedIndex < sortedSessions.length
      ? sortedSessions[selectedIndex]
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
  const selectedReviewPr = allReviewPrs[reviewSelectedIndex];
  const reviewSessionName = selectedReviewPr
    ? `review-pr-${selectedReviewPr.pullRequestId}`
    : null;

  useEffect(() => {
    if (totalItems > 0 && selectedIndex >= totalItems) {
      setSelectedIndex(totalItems - 1);
    }
  }, [totalItems, selectedIndex]);

  // Check tmux availability, load sessions and branches on mount
  useEffect(() => {
    const ok = isAvailable();
    setHasTmux(ok);
    if (ok) {
      refreshSessions();
    }
    setBranches(listAllBranches());

    // Auto-detect per-project fields on first launch
    const { updated } = autoDetectProjectConfig();
    if (updated) {
      setConfig(readConfig());
    }

    return () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh sessions by cross-referencing worktrees with live tmux sessions
  const refreshSessions = () => {
    const worktrees = listWorktrees();
    const allTmux = listSessions();
    const filtered: TmuxSession[] = [];
    for (const wt of worktrees) {
      const name = branchToSessionName(wt.branch);
      const live = allTmux.find((s) => s.name === name);
      if (live) {
        filtered.push(live);
      } else {
        filtered.push({ name, windows: 0, created: 0, attached: false });
      }
    }
    const nonReview = filtered.filter((s) => !s.name.startsWith('review-pr-'));
    setSessions(nonReview);
    return nonReview;
  };

  const flashStatus = (msg: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatusMessage(msg);
    statusTimer.current = setTimeout(() => setStatusMessage(null), 3000);
  };

  // Perform the actual session + worktree + branch deletion
  const performDelete = (sessionName: string, branch: string) => {
    killSession(sessionName);
    removeWorktree(branch);
    try {
      execSync(`git branch -d "${branch}"`, { stdio: 'pipe' });
    } catch {
      // Branch delete may fail if not fully merged — that's ok, worktree is gone
    }
    const updated = refreshSessions();
    setSelectedIndex((prev) =>
      prev >= updated.length ? Math.max(0, updated.length - 1) : prev
    );
  };

  const { sendInput } = useControlMode(
    hasTmux ? selectedName : null,
    paneCols,
    paneRows,
    setPaneContent,
    reconnectKey
  );

  const { sendInput: sendReviewInput } = useControlMode(
    hasTmux && activeTab === 'reviews' ? reviewSessionName : null,
    paneCols,
    paneRows,
    setReviewPaneContent,
    reviewReconnectKey
  );

  const ctx: AppContext = {
    config,
    branches,
    branchFilter,
    branchIndex,
    paneCols,
    paneRows,
    confirmDelete,
    confirmInput,
    editingField,
    settingsFieldIndex,
    editBuffer,
    activeTab,
    focus,
    selectedName,
    selectedSession,
    selectedIndex,
    sessions: sortedSessions,
    orphanPrs,
    totalItems,
    reviewSelectedIndex,
    reviewTotalItems,
    reviewSessionName,
    selectedReviewPr,
    sendReviewInput,
    setReviewReconnectKey,
    reviewSessionStarted,
    setReviewSessionStarted,
    reviewConfirm,
    setReviewConfirm,
    reviewInstruction,
    setReviewInstruction,
    setCreating,
    setBranchFilter,
    setBranchIndex,
    setSelectedIndex,
    setConfirmDelete,
    setConfirmInput,
    setSettingsOpen,
    setSettingsFieldIndex,
    setEditingField,
    setEditBuffer,
    setActiveTab,
    setReviewSelectedIndex,
    setConfig,
    setFocus,
    setReconnectKey,
    setBranches,
    flashStatus,
    refreshSessions,
    refreshPr,
    performDelete,
    sendInput,
    exit,
  };

  useInput((input, key) => {
    if (creating) return handleBranchPickerInput(input, key, ctx);
    if (confirmDelete) return handleConfirmDeleteInput(input, key, ctx);
    if (settingsOpen) return handleSettingsInput(input, key, ctx);
    if (reviewConfirm) return handleReviewConfirmInput(input, key, ctx);
    handleGlobalInput(input, key, ctx);
  });

  return (
    <Box flexDirection="column" height={termRows}>
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={2}>
          <Text bold>😸 Kirby</Text>
          <TabBar
            activeTab={activeTab}
            reviewCount={categorizedReviews.needsReview.length}
          />
          <StatusBar
            confirmDelete={confirmDelete}
            confirmInput={confirmInput}
            creating={creating}
            branchFilter={branchFilter}
            statusMessage={statusMessage}
            prError={prError}
            sessionCount={sortedSessions.length}
            focus={focus}
            hasTmux={hasTmux}
            adoConfigured={adoConfigured}
          />
        </Box>
        <Text dimColor>{process.cwd()}</Text>
      </Box>
      <Box flexGrow={1}>
        {activeTab === 'sessions' && (
          <>
            <Sidebar
              sessions={sortedSessions}
              selectedIndex={selectedIndex}
              focused={focus === 'sidebar' && !creating && !settingsOpen}
              prMap={prMap}
              adoConfigured={adoConfigured}
              sidebarWidth={sidebarWidth}
              orphanPrs={orphanPrs}
              prBaseUrl={
                config.org && config.project && config.repo
                  ? `https://dev.azure.com/${config.org}/${config.project}/_git/${config.repo}`
                  : undefined
              }
            />
            {settingsOpen && (
              <SettingsPanel
                config={config}
                fieldIndex={settingsFieldIndex}
                editingField={editingField}
                editBuffer={editBuffer}
              />
            )}
            {!settingsOpen && creating && (
              <BranchPicker
                filter={branchFilter}
                branches={branches}
                selectedIndex={branchIndex}
                paneRows={paneRows}
              />
            )}
            {!settingsOpen && !creating && (
              <TerminalView
                content={hasTmux ? paneContent : '(tmux not available)'}
                focused={focus === 'terminal'}
              />
            )}
          </>
        )}
        {activeTab === 'reviews' && (
          <>
            <ReviewsSidebar
              categorized={categorizedReviews}
              selectedPrId={selectedReviewPr?.pullRequestId}
              sidebarWidth={sidebarWidth}
              focused={focus === 'sidebar' && !reviewConfirm}
            />
            {(() => {
              if (reviewConfirm) {
                return (
                  <ReviewConfirmPane
                    pr={reviewConfirm.pr}
                    selectedOption={reviewConfirm.selectedOption}
                    instruction={reviewInstruction}
                  />
                );
              }
              if (
                selectedReviewPr &&
                reviewSessionStarted.has(selectedReviewPr.pullRequestId)
              ) {
                return (
                  <TerminalView
                    content={reviewPaneContent}
                    focused={focus === 'terminal'}
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

// Optional: pass a path argument to run in a different directory
const targetDir = process.argv[2];
if (targetDir) {
  process.chdir(targetDir);
}

render(<App />);
