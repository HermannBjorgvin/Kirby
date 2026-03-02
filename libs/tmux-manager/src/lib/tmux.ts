/**
 * Tmux command wrappers.
 *
 * Hot-path I/O (capturePane, sendKeys, sendLiteral) lives in
 * ControlConnection (tmux-control library) instead.
 */
import { execFile } from './exec.js';

export interface TmuxSession {
  name: string;
  windows: number;
  created: number;
  attached: boolean;
}

/** Check if tmux is installed and available */
export async function isAvailable(): Promise<boolean> {
  try {
    await execFile('tmux', ['-V'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** List all tmux sessions */
export async function listSessions(): Promise<TmuxSession[]> {
  try {
    const { stdout } = await execFile(
      'tmux',
      [
        'list-sessions',
        '-F',
        '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}',
      ],
      { encoding: 'utf8' }
    );
    return parseSessions(stdout);
  } catch {
    return [];
  }
}

/** Parse tmux list-sessions output */
export function parseSessions(output: string): TmuxSession[] {
  return output
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, windows, created, attached] = line.split('|');
      return {
        name: name!,
        windows: parseInt(windows!, 10),
        created: parseInt(created!, 10),
        attached: attached === '1',
      };
    });
}

/** Check if a session with the given name exists */
export async function hasSession(name: string): Promise<boolean> {
  const safeName = validateSessionName(name);
  try {
    await execFile('tmux', ['has-session', '-t', safeName], {
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

/** Create a new detached tmux session */
export async function createSession(
  name: string,
  cols?: number,
  rows?: number,
  command?: string,
  cwd?: string
): Promise<boolean> {
  const safeName = validateSessionName(name);
  const args = ['new-session', '-d', '-s', safeName];
  if (cols !== undefined) args.push('-x', String(cols));
  if (rows !== undefined) args.push('-y', String(rows));
  if (cwd !== undefined) args.push('-c', cwd);
  // command is passed to sh -c because it may contain shell operators (||, &&).
  // Callers must sanitize any user-provided portions (e.g. via JSON.stringify).
  if (command !== undefined) args.push('sh', '-c', command);
  try {
    await execFile('tmux', args, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session */
export async function killSession(name: string): Promise<boolean> {
  const safeName = validateSessionName(name);
  try {
    await execFile('tmux', ['kill-session', '-t', safeName], {
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

/** Convert a git branch name to a valid tmux session name (replace / with -) */
export function branchToSessionName(branch: string): string {
  return branch.replace(/\//g, '-');
}

/** Validate a tmux session name (alphanumeric, hyphens, underscores, dots) */
function validateSessionName(name: string): string {
  if (/^[a-zA-Z0-9._-]+$/.test(name)) {
    return name;
  }
  throw new Error(`Invalid tmux session name: ${name}`);
}
