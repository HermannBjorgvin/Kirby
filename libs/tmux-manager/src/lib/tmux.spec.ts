import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSessions,
  isAvailable,
  hasSession,
  killSession,
  createSession,
  listSessions,
  branchToSessionName,
} from "./tmux.js";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseSessions", () => {
  it("should parse a single session line", () => {
    const output = "my-session|3|1708900000|1\n";
    const result = parseSessions(output);
    expect(result).toEqual([
      { name: "my-session", windows: 3, created: 1708900000, attached: true },
    ]);
  });

  it("should parse multiple sessions", () => {
    const output =
      "session-a|1|1708900000|0\nsession-b|2|1708900100|1\n";
    const result = parseSessions(output);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("session-a");
    expect(result[0]!.attached).toBe(false);
    expect(result[1]!.name).toBe("session-b");
    expect(result[1]!.attached).toBe(true);
  });

  it("should return empty array for empty output", () => {
    expect(parseSessions("")).toEqual([]);
    expect(parseSessions("\n")).toEqual([]);
  });
});

describe("isAvailable", () => {
  it("should return true when tmux is installed", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("tmux 3.4"));
    expect(isAvailable()).toBe(true);
  });

  it("should return false when tmux is not installed", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    expect(isAvailable()).toBe(false);
  });
});

describe("listSessions", () => {
  it("should parse tmux output into sessions", () => {
    mockExecSync.mockReturnValueOnce(
      "work|2|1708900000|1\ntest|1|1708900100|0\n"
    );
    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.name).toBe("work");
    expect(sessions[1]!.name).toBe("test");
  });

  it("should return empty array when tmux fails", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("no server running");
    });
    expect(listSessions()).toEqual([]);
  });
});

describe("hasSession", () => {
  it("should return true when session exists", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(hasSession("my-session")).toBe(true);
  });

  it("should return false when session doesn't exist", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("session not found");
    });
    expect(hasSession("nonexistent")).toBe(false);
  });

  it("should reject invalid session names", () => {
    expect(() => hasSession("foo; rm -rf /")).toThrow(
      "Invalid tmux session name"
    );
  });
});

describe("createSession", () => {
  it("should create a detached session", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux new-session -d -s my-session",
      { stdio: "ignore" }
    );
  });

  it("should pass dimensions when provided", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session", 120, 40)).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux new-session -d -s my-session -x 120 -y 40",
      { stdio: "ignore" }
    );
  });

  it("should return false on failure", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("duplicate session");
    });
    expect(createSession("existing")).toBe(false);
  });

  it("should reject invalid session names", () => {
    expect(() => createSession("foo; rm -rf /")).toThrow(
      "Invalid tmux session name"
    );
  });
});

describe("killSession", () => {
  it("should return true on success", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(killSession("my-session")).toBe(true);
  });

  it("should return false on failure", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("session not found");
    });
    expect(killSession("nonexistent")).toBe(false);
  });
});

describe("createSession with command", () => {
  it("should append command to tmux new-session", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session", 120, 40, "claude --worktree main")).toBe(
      true
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux new-session -d -s my-session -x 120 -y 40 claude --worktree main",
      { stdio: "ignore" }
    );
  });

  it("should work with command but no dimensions", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session", undefined, undefined, "bash")).toBe(
      true
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux new-session -d -s my-session bash",
      { stdio: "ignore" }
    );
  });
});

describe("branchToSessionName", () => {
  it("should replace slashes with hyphens", () => {
    expect(branchToSessionName("feature/auth")).toBe("feature-auth");
  });

  it("should handle multiple slashes", () => {
    expect(branchToSessionName("feat/ui/sidebar")).toBe("feat-ui-sidebar");
  });

  it("should return names without slashes unchanged", () => {
    expect(branchToSessionName("main")).toBe("main");
  });

  it("should handle empty string", () => {
    expect(branchToSessionName("")).toBe("");
  });
});

describe("createSession with cwd", () => {
  it("should include -c flag when cwd is provided", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session", 120, 40, "claude", "/home/user/worktree")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'tmux new-session -d -s my-session -x 120 -y 40 -c "/home/user/worktree" claude',
      { stdio: "ignore" }
    );
  });

  it("should work with cwd but no command", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session", 120, 40, undefined, "/home/user/worktree")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'tmux new-session -d -s my-session -x 120 -y 40 -c "/home/user/worktree"',
      { stdio: "ignore" }
    );
  });

  it("should handle paths with spaces in cwd", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(createSession("my-session", 120, 40, "claude", "/home/user/JBT Marel/worktree")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'tmux new-session -d -s my-session -x 120 -y 40 -c "/home/user/JBT Marel/worktree" claude',
      { stdio: "ignore" }
    );
  });
});

describe("validateSessionName (via hasSession)", () => {
  it("should allow valid session names", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(() => hasSession("my-session")).not.toThrow();
    expect(() => hasSession("feat_auth")).not.toThrow();
    expect(() => hasSession("session.1")).not.toThrow();
  });

  it("should reject names with shell metacharacters", () => {
    expect(() => hasSession("foo; rm -rf /")).toThrow();
    expect(() => hasSession("foo$(whoami)")).toThrow();
    expect(() => hasSession("foo`id`")).toThrow();
    expect(() => hasSession("foo|bar")).toThrow();
    expect(() => hasSession("foo & bar")).toThrow();
  });
});
