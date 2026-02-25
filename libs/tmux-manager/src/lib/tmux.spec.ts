import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSessions,
  isInsideTmux,
  isAvailable,
  hasSession,
  killSession,
  createSession,
  capturePane,
  sendKeys,
  sendLiteral,
  listSessions,
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

describe("isInsideTmux", () => {
  const originalEnv = process.env["TMUX"];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["TMUX"] = originalEnv;
    } else {
      delete process.env["TMUX"];
    }
  });

  it("should return true when TMUX env is set", () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0";
    expect(isInsideTmux()).toBe(true);
  });

  it("should return false when TMUX env is not set", () => {
    delete process.env["TMUX"];
    expect(isInsideTmux()).toBe(false);
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

describe("capturePane", () => {
  it("should capture without ANSI by default", () => {
    mockExecSync.mockReturnValueOnce("Hello World\n");
    const result = capturePane("my-session");
    expect(result).toBe("Hello World\n");
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux capture-pane -t my-session -p",
      { encoding: "utf8" }
    );
  });

  it("should capture with ANSI when requested", () => {
    mockExecSync.mockReturnValueOnce("\x1b[31mRED\x1b[0m\n");
    const result = capturePane("my-session", { ansi: true });
    expect(result).toContain("\x1b[31m");
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux capture-pane -t my-session -p -e",
      { encoding: "utf8" }
    );
  });

  it("should return empty string on failure", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("session not found");
    });
    expect(capturePane("nonexistent")).toBe("");
  });
});

describe("sendKeys", () => {
  it("should send keys to session", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(sendKeys("my-session", "Enter")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux send-keys -t my-session Enter"
    );
  });

  it("should return false on failure", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("session not found");
    });
    expect(sendKeys("nonexistent", "Enter")).toBe(false);
  });
});

describe("sendLiteral", () => {
  it("should send literal text with -l flag", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    expect(sendLiteral("my-session", "hello")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'tmux send-keys -t my-session -l -- "hello"'
    );
  });

  it("should escape special characters in text", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    sendLiteral("my-session", 'say "hi"');
    expect(mockExecSync).toHaveBeenCalledWith(
      'tmux send-keys -t my-session -l -- "say \\"hi\\""'
    );
  });
});

describe("escapeArg (via hasSession)", () => {
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
