import { execFile, execSync } from "node:child_process";

export interface TmuxSession {
  name: string;
  windows: number;
  created: number;
  attached: boolean;
}

/** Check if tmux is installed and available */
export function isAvailable(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Check if we're running inside a tmux session */
export function isInsideTmux(): boolean {
  return process.env["TMUX"] !== undefined;
}

/** Get the current tmux session name (if inside tmux) */
export function getCurrentSession(): string | null {
  if (!isInsideTmux()) return null;
  try {
    return execSync("tmux display-message -p '#S'", {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/** List all tmux sessions */
export function listSessions(): TmuxSession[] {
  try {
    const output = execSync(
      "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}'",
      { encoding: "utf8" }
    );
    return parseSessions(output);
  } catch {
    return [];
  }
}

/** Parse tmux list-sessions output */
export function parseSessions(output: string): TmuxSession[] {
  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, windows, created, attached] = line.split("|");
      return {
        name: name!,
        windows: parseInt(windows!, 10),
        created: parseInt(created!, 10),
        attached: attached === "1",
      };
    });
}

/** Check if a session with the given name exists */
export function hasSession(name: string): boolean {
  const safeName = escapeArg(name);
  try {
    execSync(`tmux has-session -t ${safeName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Create a new detached tmux session */
export function createSession(
  name: string,
  cols?: number,
  rows?: number
): boolean {
  const safeName = escapeArg(name);
  let cmd = `tmux new-session -d -s ${safeName}`;
  if (cols !== undefined) cmd += ` -x ${cols}`;
  if (rows !== undefined) cmd += ` -y ${rows}`;
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session */
export function killSession(name: string): boolean {
  const safeName = escapeArg(name);
  try {
    execSync(`tmux kill-session -t ${safeName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Switch the current tmux client to a different session */
export function switchClient(name: string): boolean {
  const safeName = escapeArg(name);
  try {
    execSync(`tmux switch-client -t ${safeName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Capture the content of a tmux pane */
export function capturePane(
  name: string,
  options: { ansi?: boolean } = {}
): Promise<string> {
  const safeName = escapeArg(name);
  const flags = options.ansi ? ["-p", "-e"] : ["-p"];
  return new Promise((resolve) => {
    execFile("tmux", ["capture-pane", "-t", safeName, ...flags], (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

/** Send keys to a tmux session (fire-and-forget, non-blocking) */
export function sendKeys(name: string, keys: string): void {
  const safeName = escapeArg(name);
  execFile("tmux", ["send-keys", "-t", safeName, keys], () => {});
}

/** Send literal text to a tmux session (fire-and-forget, non-blocking) */
export function sendLiteral(name: string, text: string): void {
  const safeName = escapeArg(name);
  execFile("tmux", ["send-keys", "-t", safeName, "-l", "--", text], () => {});
}

/** Escape a tmux argument to prevent injection */
function escapeArg(arg: string): string {
  // Only allow alphanumeric, hyphens, underscores, dots
  if (/^[a-zA-Z0-9._-]+$/.test(arg)) {
    return arg;
  }
  throw new Error(`Invalid tmux session name: ${arg}`);
}
