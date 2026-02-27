import { useState, useEffect, useRef, useMemo } from "react";
import { execSync } from "node:child_process";
import { render, Text, Box, useInput, useApp, useStdout } from "ink";
import {
  isAvailable,
  listSessions,
  killSession,
  removeWorktree,
  listBranches,
  listWorktrees,
  branchToSessionName,
} from "@workflow-manager/tmux-manager";
import type { TmuxSession } from "@workflow-manager/tmux-manager";
import {
  readConfig,
  isAdoConfigured,
  autoDetectProjectConfig,
} from "@workflow-manager/azure-devops";
import type { BranchPrMap, PullRequestInfo, Config } from "@workflow-manager/shared-types";
import { Sidebar } from "./components/Sidebar.js";
import { TerminalView } from "./components/TerminalView.js";
import { BranchPicker } from "./components/BranchPicker.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { usePrData } from "./hooks/usePrData.js";
import { useControlMode } from "./hooks/useControlMode.js";
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleSettingsInput,
  handleGlobalInput,
} from "./input-handlers.js";
import type { AppContext } from "./input-handlers.js";

type Focus = "sidebar" | "terminal";

// --- App ---

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const [config, setConfig] = useState<Config>(() => readConfig());
  const adoConfigured = isAdoConfigured(config);
  const sidebarWidth = adoConfigured ? 48 : 24;
  const paneCols = Math.max(20, termCols - sidebarWidth - 2);
  const paneRows = Math.max(5, termRows - 3); // 1 heading + 1 separator + 1 status bar
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [paneContent, setPaneContent] = useState("(loading...)");
  const [hasTmux, setHasTmux] = useState(false);
  const [creating, setCreating] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [branchIndex, setBranchIndex] = useState(0);
  const [branches, setBranches] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ branch: string; sessionName: string; reason: string } | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFieldIndex, setSettingsFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");
  const [reconnectKey, setReconnectKey] = useState(0);
  const { prMap, error: prError, refresh: refreshPr } = usePrData(config);

  // Orphan PRs: user's PRs that don't have a matching session (worktree-backed or tmux)
  const orphanPrs = useMemo(() => {
    if (!config.email) return [];
    const sessionNames = new Set(sessions.map((s) => s.name));
    return Object.values(prMap)
      .filter((pr): pr is PullRequestInfo => {
        if (!pr) return false;
        if (!pr.createdByUniqueName) return false;
        if (pr.createdByUniqueName.toLowerCase() !== config.email!.toLowerCase()) return false;
        return !sessionNames.has(branchToSessionName(pr.sourceBranch));
      });
  }, [prMap, sessions, config.email]);

  const totalItems = sessions.length + orphanPrs.length;
  const selectedSession = selectedIndex < sessions.length ? sessions[selectedIndex] : undefined;
  const selectedName = selectedSession?.name ?? null;

  // Clamp selectedIndex when total items shrinks
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
    setBranches(listBranches());

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
    setSessions(filtered);
    return filtered;
  };

  // Show a temporary status message for 3 seconds
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
      execSync(`git branch -d "${branch}"`, { stdio: "pipe" });
    } catch {
      // Branch delete may fail if not fully merged — that's ok, worktree is gone
    }
    const updated = refreshSessions();
    setSelectedIndex((prev) =>
      prev >= updated.length ? Math.max(0, updated.length - 1) : prev
    );
  };

  // Control mode connection for selected session
  const { sendInput } = useControlMode(
    hasTmux ? selectedName : null,
    paneCols,
    paneRows,
    setPaneContent,
    reconnectKey
  );

  // Build context object for input handlers
  const ctx: AppContext = {
    config, branches, branchFilter, branchIndex, paneCols, paneRows,
    confirmDelete, confirmInput, editingField, settingsFieldIndex, editBuffer,
    focus, selectedName, selectedSession, selectedIndex, sessions, orphanPrs, totalItems,
    setCreating, setBranchFilter, setBranchIndex, setSelectedIndex,
    setConfirmDelete, setConfirmInput, setSettingsOpen, setSettingsFieldIndex,
    setEditingField, setEditBuffer, setConfig, setFocus, setReconnectKey, setBranches,
    flashStatus, refreshSessions, refreshPr, performDelete, sendInput, exit,
  };

  useInput((input, key) => {
    if (creating) return handleBranchPickerInput(input, key, ctx);
    if (confirmDelete) return handleConfirmDeleteInput(input, key, ctx);
    if (settingsOpen) return handleSettingsInput(input, key, ctx);
    handleGlobalInput(input, key, ctx);
  });

  return (
    <Box flexDirection="column" height={termRows}>
      <Box flexGrow={1}>
        <Sidebar
          sessions={sessions}
          selectedIndex={selectedIndex}
          focused={focus === "sidebar" && !creating && !settingsOpen}
          prMap={prMap}
          adoConfigured={adoConfigured}
          sidebarWidth={sidebarWidth}
          orphanPrs={orphanPrs}
        />
        {settingsOpen ? (
          <SettingsPanel
            config={config}
            fieldIndex={settingsFieldIndex}
            editingField={editingField}
            editBuffer={editBuffer}
          />
        ) : creating ? (
          <BranchPicker
            filter={branchFilter}
            branches={branches}
            selectedIndex={branchIndex}
          />
        ) : (
          <TerminalView
            content={hasTmux ? paneContent : "(tmux not available)"}
            focused={focus === "terminal"}
          />
        )}
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          {confirmDelete ? (
            <Text>
              <Text color="red">Warning: {confirmDelete.reason}. Type </Text>
              <Text bold color="yellow">{confirmDelete.branch}</Text>
              <Text color="red"> to confirm: </Text>
              <Text color="cyan">{confirmInput}</Text>
              <Text dimColor>_</Text>
              <Text dimColor> · Esc cancel</Text>
            </Text>
          ) : creating ? (
            <Text>
              Branch: <Text color="cyan">{branchFilter}</Text>
              <Text dimColor>_</Text>
              <Text dimColor> · Enter select · Esc cancel</Text>
            </Text>
          ) : statusMessage ? (
            <Text color="yellow">{statusMessage}</Text>
          ) : prError ? (
            <Text color="red">PR error: {prError}</Text>
          ) : (
            <Text dimColor>
              workflow-manager · {sessions.length} sessions ·{" "}
              focus: <Text color="cyan">{focus}</Text> · tmux:{" "}
              {hasTmux ? "✓" : "✕"}
              {!adoConfigured ? " · (s to configure ADO)" : ""}
            </Text>
          )}
        </Box>
        <Text dimColor>{process.cwd()}</Text>
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
