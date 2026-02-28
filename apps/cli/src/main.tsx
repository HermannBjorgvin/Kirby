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
  isVcsConfigured,
  autoDetectProjectConfig,
} from '@kirby/vcs-core';
import type {
  AppConfig,
  VcsProvider,
  PullRequestInfo,
  CategorizedReviews,
} from '@kirby/vcs-core';
import { azureDevOpsProvider } from '@kirby/vcs-azure-devops';
import { githubProvider } from '@kirby/vcs-github';
import type { ActiveTab } from './types.js';
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
  hasTmux,
  vcsConfigured,
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
  hasTmux: boolean;
  vcsConfigured: boolean;
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
      {!vcsConfigured ? ' · (s to configure VCS)' : ''}
    </Text>
  );
}

// ── App ────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const [config, setConfig] = useState<AppConfig>(() => readConfig());

  // Resolve the active VCS provider from config
  const provider = useMemo<VcsProvider | null>(() => {
    if (!config.vendor) return null;
    return providers.find((p) => p.id === config.vendor) ?? null;
  }, [config.vendor]);

  const vcsConfigured = isVcsConfigured(config, provider);
  const sidebarWidth = vcsConfigured ? 48 : 24;
  const paneCols = Math.max(20, termCols - sidebarWidth - 2);
  const paneRows = Math.max(5, termRows - 3);
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
  const {
    prMap,
    error: prError,
    refresh: refreshPr,
  } = usePrData(config, provider);

  // Orphan PRs: user's PRs that don't have a matching worktree session
  const orphanPrs = useMemo(() => {
    if (!config.email || !provider) return [];
    const sessionNames = new Set(sessions.map((s) => s.name));
    return Object.values(prMap)
      .filter(
        (pr): pr is PullRequestInfo =>
          pr != null &&
          provider.matchesUser(pr.createdByIdentifier, config) &&
          !sessionNames.has(branchToSessionName(pr.sourceBranch))
      )
      .sort((a, b) => b.id - a.id);
  }, [prMap, sessions, config, provider]);

  // Categorize PRs where the user is a reviewer
  const categorizedReviews = useMemo((): CategorizedReviews => {
    if (!config.email || !provider)
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
    if (reviewTotalItems > 0 && reviewSelectedIndex >= reviewTotalItems) {
      setReviewSelectedIndex(reviewTotalItems - 1);
    }
  }, [reviewTotalItems, reviewSelectedIndex]);

  // Sort sessions by associated PR number (newest first)
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const prA = Object.values(prMap).find(
        (pr) => pr && branchToSessionName(pr.sourceBranch) === a.name
      );
      const prB = Object.values(prMap).find(
        (pr) => pr && branchToSessionName(pr.sourceBranch) === b.name
      );
      const idA = prA?.id ?? -Infinity;
      const idB = prB?.id ?? -Infinity;
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
    ? `review-pr-${selectedReviewPr.id}`
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
    const { updated } = autoDetectProjectConfig(process.cwd(), providers);
    if (updated) {
      setConfig(readConfig());
    }

    return () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const performDelete = (sessionName: string, branch: string) => {
    killSession(sessionName);
    removeWorktree(branch);
    try {
      execSync(`git branch -d "${branch}"`, { stdio: 'pipe' });
    } catch {
      // Branch delete may fail if not fully merged
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
    provider,
    providers,
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
            vcsConfigured={vcsConfigured}
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
              vcsConfigured={vcsConfigured}
              sidebarWidth={sidebarWidth}
              orphanPrs={orphanPrs}
            />
            {settingsOpen && (
              <SettingsPanel
                config={config}
                provider={provider}
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
              selectedPrId={selectedReviewPr?.id}
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
                reviewSessionStarted.has(selectedReviewPr.id)
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
