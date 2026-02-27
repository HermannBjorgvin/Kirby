import { useState, useEffect, useRef, useMemo } from "react";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { render, Text, Box, useInput, useApp, useStdout, type Key } from "ink";
import {
  isAvailable,
  listSessions,
  hasSession,
  killSession,
  createSession,
  createWorktree,
  removeWorktree,
  canRemoveBranch,
  listBranches,
  listWorktrees,
  branchToSessionName,
} from "@workflow-manager/tmux-manager";
import type { TmuxSession } from "@workflow-manager/tmux-manager";
import {
  readConfig,
  readGlobalConfig,
  writeGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  isAdoConfigured,
  autoDetectProjectConfig,
} from "@workflow-manager/azure-devops";
import type { BranchPrMap, PullRequestInfo, Config } from "@workflow-manager/shared-types";
import { Sidebar } from "./components/Sidebar.js";
import { TerminalView } from "./components/TerminalView.js";
import { BranchPicker } from "./components/BranchPicker.js";
import { SettingsPanel, SETTINGS_FIELDS } from "./components/SettingsPanel.js";
import { usePrData } from "./hooks/usePrData.js";
import { useControlMode } from "./hooks/useControlMode.js";

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
        // Exclude PRs whose branch already appears in the sessions list (derived from worktrees)
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
        // Worktree exists but no tmux session — show as stopped
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

  useInput((input, key) => {
    // Branch picker mode
    if (creating) {
      if (key.escape) {
        setCreating(false);
        setBranchFilter("");
        setBranchIndex(0);
        return;
      }

      const filtered = branches.filter((b) =>
        b.toLowerCase().includes(branchFilter.toLowerCase())
      );

      if (key.upArrow) {
        setBranchIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.downArrow) {
        setBranchIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }

      if (key.return) {
        // Pick the selected branch, or use typed text as new branch name
        const branch =
          filtered.length > 0 ? filtered[branchIndex]! : branchFilter.trim();
        if (branch) {
          const worktreePath = createWorktree(branch);
          if (worktreePath) {
            const sessionName = branchToSessionName(branch);
            createSession(sessionName, paneCols, paneRows, "claude", worktreePath);
            const updated = refreshSessions();
            const idx = updated.findIndex((s) => s.name === sessionName);
            if (idx >= 0) setSelectedIndex(idx);
          }
        }
        setCreating(false);
        setBranchFilter("");
        setBranchIndex(0);
        return;
      }

      if (key.backspace || key.delete) {
        setBranchFilter((f) => f.slice(0, -1));
        setBranchIndex(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setBranchFilter((f) => f + input);
        setBranchIndex(0);
      }
      return;
    }

    // Confirm delete mode — user must type branch name to proceed
    if (confirmDelete) {
      if (key.escape) {
        setConfirmDelete(null);
        setConfirmInput("");
        return;
      }
      if (key.return) {
        if (confirmInput === confirmDelete.branch) {
          performDelete(confirmDelete.sessionName, confirmDelete.branch);
        } else {
          flashStatus("Branch name did not match — delete cancelled");
        }
        setConfirmDelete(null);
        setConfirmInput("");
        return;
      }
      if (key.backspace || key.delete) {
        setConfirmInput((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setConfirmInput((v) => v + input);
      }
      return;
    }

    // Settings mode
    if (settingsOpen) {
      if (editingField) {
        if (key.escape) {
          setEditingField(null);
          setEditBuffer("");
          return;
        }
        if (key.return) {
          const field = SETTINGS_FIELDS[settingsFieldIndex]!;
          const value = editBuffer || undefined;
          const newConfig = { ...config, [field.key]: value };
          setConfig(newConfig);

          // Route save to the correct config tier
          const globalKeys = new Set(["pat", "prPollInterval"]);
          if (globalKeys.has(field.key)) {
            const g = readGlobalConfig();
            writeGlobalConfig({ ...g, [field.key]: value });
          } else {
            const p = readProjectConfig();
            writeProjectConfig({ ...p, [field.key]: value });
          }

          setEditingField(null);
          setEditBuffer("");
          return;
        }
        if (key.backspace || key.delete) {
          setEditBuffer((v) => v.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setEditBuffer((v) => v + input);
        }
        return;
      }

      if (key.escape) {
        setSettingsOpen(false);
        return;
      }
      if (input === "j" || key.downArrow) {
        setSettingsFieldIndex((i) =>
          Math.min(i + 1, SETTINGS_FIELDS.length - 1)
        );
        return;
      }
      if (input === "k" || key.upArrow) {
        setSettingsFieldIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return) {
        const field = SETTINGS_FIELDS[settingsFieldIndex]!;
        setEditingField(field.key);
        setEditBuffer(String(config[field.key] ?? ""));
        return;
      }
      if (input === "a") {
        const { updated, detected } = autoDetectProjectConfig();
        if (updated) {
          setConfig(readConfig());
          const fields = Object.keys(detected).join(", ");
          flashStatus(`Auto-detected: ${fields}`);
        } else {
          flashStatus("Nothing new to detect (all fields already set)");
        }
        return;
      }
      return;
    }

    // Tab switches focus — auto-create tmux session if needed
    if (key.tab) {
      if (focus === "sidebar" && selectedName && !hasSession(selectedName)) {
        const worktreePath = resolve(process.cwd(), ".tui/worktrees/" + selectedName);
        createSession(selectedName, paneCols, paneRows, "claude", worktreePath);
        setReconnectKey((k) => k + 1);
      }
      setFocus((f) => (f === "sidebar" ? "terminal" : "sidebar"));
      return;
    }

    // Escape returns to sidebar
    if (key.escape) {
      if (focus === "terminal") {
        setFocus("sidebar");
        return;
      }
    }

    if (focus === "sidebar") {
      if (input === "q") {
        exit();
        return;
      }
      if (input === "n") {
        setBranches(listBranches());
        setCreating(true);
        setBranchFilter("");
        setBranchIndex(0);
        return;
      }
      if (input === "d" && selectedSession) {
        const sessionName = selectedSession.name;
        const currentBranches = listBranches();
        const branch = currentBranches.find(
          (b) => branchToSessionName(b) === sessionName
        );
        if (branch) {
          const check = canRemoveBranch(branch);
          if (!check.safe) {
            if (check.reason === "not pushed to upstream" || check.reason === "uncommitted changes") {
              // Ask user to type branch name to confirm
              setConfirmDelete({ branch, sessionName, reason: check.reason });
              setConfirmInput("");
            } else {
              flashStatus(`Cannot delete: ${check.reason}`);
            }
            return;
          }
          performDelete(sessionName, branch);
        } else {
          // No matching branch found — just kill the session
          killSession(sessionName);
          const updated = refreshSessions();
          if (selectedIndex >= updated.length) {
            setSelectedIndex(Math.max(0, updated.length - 1));
          }
        }
        return;
      }
      if (input === "K" && selectedSession) {
        killSession(selectedSession.name);
        refreshSessions();
        return;
      }
      if (input === "s") {
        setSettingsOpen(true);
        setSettingsFieldIndex(0);
        return;
      }
      if (input === "r") {
        refreshPr();
        flashStatus("Refreshing PR data...");
        return;
      }
      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
      }
      if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (key.return && selectedIndex >= sessions.length && orphanPrs.length > 0) {
        const prIndex = selectedIndex - sessions.length;
        const pr = orphanPrs[prIndex];
        if (pr) {
          const worktreePath = createWorktree(pr.sourceBranch);
          if (worktreePath) {
            const sessionName = branchToSessionName(pr.sourceBranch);
            createSession(sessionName, paneCols, paneRows, "claude", worktreePath);
            const updated = refreshSessions();
            const idx = updated.findIndex((s) => s.name === sessionName);
            if (idx >= 0) setSelectedIndex(idx);
          }
        }
      }
    } else {
      // Terminal focused — forward input via control mode
      sendInput(input, key);
    }
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
