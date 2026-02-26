import { useState, useEffect, useRef, useCallback } from "react";
import { render, Text, Box, useInput, useApp, useStdout, type Key } from "ink";
import {
  isAvailable,
  listSessions,
  killSession,
  createSession,
} from "@workflow-manager/tmux-manager";
import type { TmuxSession } from "@workflow-manager/tmux-manager";
import { ControlConnection } from "@workflow-manager/tmux-control";

// --- Components ---

type Focus = "sidebar" | "terminal";

function Sidebar({
  sessions,
  selectedIndex,
  focused,
}: {
  sessions: TmuxSession[];
  selectedIndex: number;
  focused: boolean;
}) {
  return (
    <Box
      flexDirection="column"
      width={24}
      borderStyle="round"
      borderColor={focused ? "blue" : "gray"}
      paddingX={1}
    >
      <Text bold color={focused ? "blue" : "gray"}>
        Sessions
      </Text>
      <Text dimColor>{"─".repeat(20)}</Text>
      {sessions.length === 0 ? (
        <Text dimColor>(no sessions)</Text>
      ) : (
        sessions.map((s, i) => {
          const selected = i === selectedIndex;
          const icon = s.attached ? "●" : "○";
          const color = s.attached ? "green" : "gray";
          return (
            <Text key={s.name}>
              <Text color={selected ? "cyan" : undefined}>
                {selected ? "› " : "  "}
              </Text>
              <Text color={color}>{icon} </Text>
              <Text bold={selected}>{s.name}</Text>
            </Text>
          );
        })
      )}
      <Box marginTop={1}>
        <Text dimColor>n new · d kill · j/k nav · Tab focus · q quit</Text>
      </Box>
    </Box>
  );
}

function TerminalView({
  content,
  focused,
}: {
  content: string;
  focused: boolean;
}) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={focused ? "green" : "gray"}
      paddingX={1}
      overflow="hidden"
    >
      <Text bold color={focused ? "green" : "gray"}>
        Terminal {focused ? "(typing)" : "(view only)"}
      </Text>
      <Text dimColor>{"─".repeat(40)}</Text>
      <Text wrap="truncate">{content}</Text>
    </Box>
  );
}

// --- Control Mode Hook ---

function useControlMode(
  sessionName: string | null,
  paneCols: number,
  paneRows: number,
  setPaneContent: (content: string) => void
) {
  const connRef = useRef<ControlConnection | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clamp capture-pane output to paneRows lines to prevent overflow
  const clampContent = useCallback(
    (raw: string) => {
      const lines = raw.split("\n");
      return lines.length > paneRows
        ? lines.slice(0, paneRows).join("\n")
        : raw;
    },
    [paneRows]
  );

  // Schedule a debounced capture-pane render
  const scheduleRender = useCallback(() => {
    if (renderTimer.current) return; // already scheduled
    renderTimer.current = setTimeout(() => {
      renderTimer.current = null;
      const conn = connRef.current;
      if (conn && conn.state === "ready") {
        conn.capturePane().then(
          (content) => {
            // Only update if this connection is still the active one
            if (connRef.current === conn) {
              setPaneContent(clampContent(content));
            }
          },
          () => {
            // Connection died between check and capture — ignore
          }
        );
      }
    }, 16); // ~60fps
  }, [setPaneContent, clampContent]);

  // Connect/disconnect only when session changes
  useEffect(() => {
    if (!sessionName) return;

    const conn = new ControlConnection(sessionName);
    connRef.current = conn;

    conn.on("output", () => {
      scheduleRender();
    });

    conn.on("exit", () => {
      setPaneContent("(session disconnected)");
    });

    conn.on("error", () => {
      setPaneContent("(connection error)");
    });

    conn
      .connect(paneCols, paneRows)
      .then(async () => {
        const content = await conn.capturePane();
        if (connRef.current === conn) {
          setPaneContent(clampContent(content));
        }
      })
      .catch(() => {
        setPaneContent("(failed to connect)");
      });

    return () => {
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
      conn.disconnect();
      connRef.current = null;
    };
    // Only reconnect when the session changes — resize is handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName]);

  // Resize the pane without reconnecting
  useEffect(() => {
    const conn = connRef.current;
    if (conn && conn.state === "ready") {
      conn.resize(paneCols, paneRows);
      scheduleRender();
    }
  }, [paneCols, paneRows, scheduleRender]);

  // Send input through the control connection
  const sendInput = useCallback(
    (input: string, key: Key) => {
      const conn = connRef.current;
      if (!conn || conn.state !== "ready") return;

      if (key.return) {
        conn.sendKeys("Enter");
      } else if (key.backspace || key.delete) {
        conn.sendKeys("BSpace");
      } else if (key.upArrow) {
        conn.sendKeys("Up");
      } else if (key.downArrow) {
        conn.sendKeys("Down");
      } else if (key.leftArrow) {
        conn.sendKeys("Left");
      } else if (key.rightArrow) {
        conn.sendKeys("Right");
      } else if (key.tab) {
        // Tab is reserved for focus switching, don't forward
      } else if (key.ctrl && input === "c") {
        conn.sendKeys("C-c");
      } else if (input) {
        conn.sendLiteral(input);
      }
    },
    []
  );

  return { sendInput };
}

// --- App ---

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const sidebarWidth = 24; // Ink width includes border
  const paneCols = Math.max(20, termCols - sidebarWidth - 4);
  const paneRows = Math.max(5, termRows - 5); // 2 border + 1 heading + 1 separator + 1 status bar
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [paneContent, setPaneContent] = useState("(loading...)");
  const [hasTmux, setHasTmux] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const selectedSession = sessions[selectedIndex];
  const selectedName = selectedSession?.name ?? null;

  // Check tmux availability and load sessions on mount
  useEffect(() => {
    const ok = isAvailable();
    setHasTmux(ok);
    if (ok) {
      setSessions(listSessions());
    }
  }, []);

  // Refresh function used after create/kill
  const refreshSessions = () => {
    const updated = listSessions();
    setSessions(updated);
    return updated;
  };

  // Control mode connection for selected session
  const { sendInput } = useControlMode(
    hasTmux ? selectedName : null,
    paneCols,
    paneRows,
    setPaneContent
  );

  useInput((input, key) => {
    // Creating mode — capture name input
    if (creating) {
      if (key.escape) {
        setCreating(false);
        setNewName("");
        return;
      }
      if (key.return) {
        const name = newName.trim();
        if (name) {
          createSession(name, paneCols, paneRows);
          const updated = refreshSessions();
          // Select the newly created session
          const idx = updated.findIndex((s) => s.name === name);
          if (idx >= 0) setSelectedIndex(idx);
        }
        setCreating(false);
        setNewName("");
        return;
      }
      if (key.backspace || key.delete) {
        setNewName((n) => n.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setNewName((n) => n + input);
      }
      return;
    }

    // Tab switches focus
    if (key.tab) {
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
        setCreating(true);
        setNewName("");
        return;
      }
      if (input === "d" && selectedSession) {
        killSession(selectedSession.name);
        const updated = refreshSessions();
        if (selectedIndex >= updated.length) {
          setSelectedIndex(Math.max(0, updated.length - 1));
        }
        return;
      }
      if (input === "j" || key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, sessions.length - 1));
      }
      if (input === "k" || key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
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
          focused={focus === "sidebar"}
        />
        <TerminalView
          content={hasTmux ? paneContent : "(tmux not available)"}
          focused={focus === "terminal"}
        />
      </Box>
      <Box paddingX={1}>
        {creating ? (
          <Text>
            New session name: <Text color="cyan">{newName}</Text>
            <Text dimColor>_</Text>
          </Text>
        ) : (
          <Text dimColor>
            workflow-manager · {sessions.length} sessions ·{" "}
            focus: <Text color="cyan">{focus}</Text> · tmux:{" "}
            {hasTmux ? "✓" : "✕"}
          </Text>
        )}
      </Box>
    </Box>
  );
}

render(<App />);
