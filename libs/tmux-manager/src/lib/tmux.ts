/**
 * Tmux command wrappers.
 *
 * All operations are synchronous for simpler calling code.
 * Hot-path I/O (capturePane, sendKeys, sendLiteral) lives in
 * ControlConnection (tmux-control library) instead.
 */
import { execSync } from "node:child_process";

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
  const safeName = validateSessionName(name);
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
  rows?: number,
  command?: string,
  cwd?: string
): boolean {
  const safeName = validateSessionName(name);
  let cmd = `tmux new-session -d -s ${safeName}`;
  if (cols !== undefined) cmd += ` -x ${cols}`;
  if (rows !== undefined) cmd += ` -y ${rows}`;
  if (cwd !== undefined) cmd += ` -c "${cwd}"`;
  if (command !== undefined) cmd += ` ${command}`;
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session */
export function killSession(name: string): boolean {
  const safeName = validateSessionName(name);
  try {
    execSync(`tmux kill-session -t ${safeName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Convert a git branch name to a valid tmux session name (replace / with -) */
export function branchToSessionName(branch: string): string {
  return branch.replace(/\//g, "-");
}

/** Validate a tmux session name (alphanumeric, hyphens, underscores, dots) */
function validateSessionName(name: string): string {
  if (/^[a-zA-Z0-9._-]+$/.test(name)) {
    return name;
  }
  throw new Error(`Invalid tmux session name: ${name}`);
}
