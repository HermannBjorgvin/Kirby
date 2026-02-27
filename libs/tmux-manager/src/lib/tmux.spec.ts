import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSessions,
  isAvailable,
  hasSession,
  killSession,
  createSession,
  listSessions,
  branchToSessionName,
  listBranches,
  createWorktree,
  removeWorktree,
  canRemoveBranch,
  parseWorktrees,
  listWorktrees,
} from "./tmux.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);

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

describe("listBranches", () => {
  it("should parse git branch output into array", () => {
    mockExecSync.mockReturnValueOnce("main\nfeature/auth\nfix/bug-123\n");
    const branches = listBranches();
    expect(branches).toEqual(["main", "feature/auth", "fix/bug-123"]);
  });

  it("should return empty array when git fails", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });
    expect(listBranches()).toEqual([]);
  });

  it("should filter out empty lines", () => {
    mockExecSync.mockReturnValueOnce("main\n\ndev\n");
    expect(listBranches()).toEqual(["main", "dev"]);
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

describe("createWorktree", () => {
  it("should return absolute path for existing branch", () => {
    mockExecSync.mockReturnValueOnce("");
    const result = createWorktree("feature/auth");
    expect(result).toContain(".tui/worktrees/feature-auth");
    expect(result).toMatch(/^\//); // absolute path
    expect(mockExecSync).toHaveBeenCalledWith(
      'git worktree add ".tui/worktrees/feature-auth" "feature/auth"',
      { encoding: "utf8", stdio: "pipe" }
    );
  });

  it("should fall back to -b for new branch", () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error("branch not found"); })
      .mockReturnValueOnce("");
    const result = createWorktree("new-branch");
    expect(result).toContain(".tui/worktrees/new-branch");
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenLastCalledWith(
      'git worktree add -b "new-branch" ".tui/worktrees/new-branch"',
      { encoding: "utf8", stdio: "pipe" }
    );
  });

  it("should return null when both attempts fail", () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error("fail"); })
      .mockImplementationOnce(() => { throw new Error("fail"); });
    expect(createWorktree("bad-branch")).toBeNull();
  });

  it("should return existing path without calling git when worktree already exists", () => {
    mockExistsSync.mockReturnValueOnce(true);
    const result = createWorktree("feature/auth");
    expect(result).toContain(".tui/worktrees/feature-auth");
    expect(result).toMatch(/^\//);
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

describe("removeWorktree", () => {
  it("should return true on success", () => {
    mockExecSync.mockReturnValueOnce("");
    expect(removeWorktree("feature/auth")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'git worktree remove ".tui/worktrees/feature-auth"',
      { encoding: "utf8", stdio: "pipe" }
    );
  });

  it("should return false on failure", () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error("not found"); });
    expect(removeWorktree("nonexistent")).toBe(false);
  });
});

describe("canRemoveBranch", () => {
  it("should reject main as protected", () => {
    expect(canRemoveBranch("main")).toEqual({ safe: false, reason: "protected branch" });
  });

  it("should reject master as protected", () => {
    expect(canRemoveBranch("master")).toEqual({ safe: false, reason: "protected branch" });
  });

  it("should reject gitbutler branches as protected", () => {
    expect(canRemoveBranch("gitbutler/integration")).toEqual({ safe: false, reason: "protected branch" });
  });

  it("should reject branches with uncommitted changes", () => {
    // git -C status --porcelain returns dirty files
    mockExecSync.mockReturnValueOnce(" M src/file.ts\n");
    expect(canRemoveBranch("feature/dirty")).toEqual({ safe: false, reason: "uncommitted changes" });
  });

  it("should reject branches not pushed to upstream", () => {
    // git -C status --porcelain returns clean
    mockExecSync.mockReturnValueOnce("");
    // git log --not --remotes returns unpushed commit
    mockExecSync.mockReturnValueOnce("abc1234 some commit\n");
    expect(canRemoveBranch("feature/unpushed")).toEqual({ safe: false, reason: "not pushed to upstream" });
  });

  it("should return safe for clean, pushed branches", () => {
    // git -C status --porcelain returns clean
    mockExecSync.mockReturnValueOnce("");
    // git log --not --remotes returns empty
    mockExecSync.mockReturnValueOnce("");
    expect(canRemoveBranch("feature/done")).toEqual({ safe: true });
  });

  it("should skip checks gracefully when worktree does not exist", () => {
    // git -C status fails (no worktree)
    mockExecSync.mockImplementationOnce(() => { throw new Error("not a directory"); });
    // git log --not --remotes returns empty
    mockExecSync.mockReturnValueOnce("");
    expect(canRemoveBranch("feature/no-worktree")).toEqual({ safe: true });
  });
});

describe("parseWorktrees", () => {
  it("should parse multiple worktrees from porcelain output", () => {
    const output = [
      "worktree /home/user/repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/repo/.tui/worktrees/feature-auth",
      "HEAD def456",
      "branch refs/heads/feature/auth",
      "",
      "worktree /home/user/repo/.tui/worktrees/fix-bug",
      "HEAD 789abc",
      "branch refs/heads/fix/bug",
      "",
    ].join("\n");

    const result = parseWorktrees(output);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      path: "/home/user/repo",
      branch: "main",
      bare: false,
    });
    expect(result[1]).toEqual({
      path: "/home/user/repo/.tui/worktrees/feature-auth",
      branch: "feature/auth",
      bare: false,
    });
    expect(result[2]).toEqual({
      path: "/home/user/repo/.tui/worktrees/fix-bug",
      branch: "fix/bug",
      bare: false,
    });
  });

  it("should handle bare worktrees", () => {
    const output = [
      "worktree /home/user/repo",
      "HEAD abc123",
      "bare",
      "",
    ].join("\n");

    const result = parseWorktrees(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.bare).toBe(true);
    expect(result[0]!.branch).toBe("");
  });

  it("should return empty array for empty output", () => {
    expect(parseWorktrees("")).toEqual([]);
    expect(parseWorktrees("\n")).toEqual([]);
  });
});

describe("listWorktrees", () => {
  it("should return only .tui/worktrees/ entries, excluding main worktree", () => {
    mockExecSync.mockReturnValueOnce(
      [
        "worktree /home/user/repo",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /home/user/repo/.tui/worktrees/feature-auth",
        "HEAD def456",
        "branch refs/heads/feature/auth",
        "",
      ].join("\n")
    );

    const result = listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe("feature/auth");
  });

  it("should filter out bare worktrees", () => {
    mockExecSync.mockReturnValueOnce(
      [
        "worktree /home/user/repo",
        "HEAD abc123",
        "bare",
        "",
        "worktree /home/user/repo/.tui/worktrees/feature-auth",
        "HEAD def456",
        "branch refs/heads/feature/auth",
        "",
      ].join("\n")
    );

    const result = listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe("feature/auth");
  });

  it("should return empty array when git fails", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });
    expect(listWorktrees()).toEqual([]);
  });

  it("should return empty array when no worktrees exist", () => {
    mockExecSync.mockReturnValueOnce(
      [
        "worktree /home/user/repo",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
      ].join("\n")
    );

    expect(listWorktrees()).toEqual([]);
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
