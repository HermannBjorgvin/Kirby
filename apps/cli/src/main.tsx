import { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp, useStdout } from "ink";
import {
  isAvailable,
  listSessions,
  capturePane,
  sendKeys,
  sendLiteral,
  killSession,
  createSession,
} from "@workflow-manager/tmux-manager";
import type { TmuxSession } from "@workflow-manager/tmux-manager";

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
    >
      <Text bold color={focused ? "green" : "gray"}>
        Terminal {focused ? "(typing)" : "(view only)"}
      </Text>
      <Text dimColor>{"─".repeat(40)}</Text>
      <Text>{content}</Text>
    </Box>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendToSession(sessionName: string, input: string, key: any): void {
  if (key.return) {
    sendKeys(sessionName, "Enter");
  } else if (key.backspace || key.delete) {
    sendKeys(sessionName, "BSpace");
  } else if (key.upArrow) {
    sendKeys(sessionName, "Up");
  } else if (key.downArrow) {
    sendKeys(sessionName, "Down");
  } else if (key.leftArrow) {
    sendKeys(sessionName, "Left");
  } else if (key.rightArrow) {
    sendKeys(sessionName, "Right");
  } else if (key.tab) {
    // Tab is reserved for focus switching, don't forward
  } else if (key.ctrl && input === "c") {
    sendKeys(sessionName, "C-c");
  } else if (input) {
    sendLiteral(sessionName, input);
  }
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const sidebarWidth = 26; // 24 content + 2 border
  const paneCols = Math.max(20, termCols - sidebarWidth - 4);
  const paneRows = Math.max(5, termRows - 4);
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

  // Poll pane content for selected session
  useEffect(() => {
    if (!hasTmux || !selectedName) {
      setPaneContent(
        sessions.length === 0 ? "(no sessions)" : "(no session selected)"
      );
      return;
    }
    let active = true;
    const poll = () => {
      capturePane(selectedName, { ansi: true }).then((content) => {
        if (active) {
          setPaneContent(content);
          setTimeout(poll, 500);
        }
      });
    };
    poll();
    return () => { active = false; };
  }, [hasTmux, selectedName]);

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
      // Terminal focused — forward input to selected session
      if (selectedSession) {
        sendToSession(selectedSession.name, input, key);
      }
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
