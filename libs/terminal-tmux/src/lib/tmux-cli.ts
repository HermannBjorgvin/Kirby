import { execFileSync } from 'node:child_process';

/** Result of running a tmux subcommand. */
interface TmuxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Synchronous run of a tmux subcommand. Tmux's control commands
 *  (new-session, kill-session, has-session, -V) all complete in
 *  milliseconds, so blocking is fine — and using execFileSync matches
 *  the pattern used elsewhere in the workspace
 *  (libs/vcs/core/src/lib/config-store.ts) which keeps mocking
 *  straightforward. */
function runTmux(args: string[]): TmuxRunResult {
  try {
    const stdout = execFileSync('tmux', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as Error & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string;
    };
    return {
      stdout:
        typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr:
        typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
      exitCode: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

/** `tmux -V` → "tmux 3.4". Throws if tmux is unavailable (ENOENT). */
export function tmuxVersion(): string {
  return execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim();
}

/** Hard teardown — kills the named tmux session and all its panes. */
export function tmuxKillSession(name: string): TmuxRunResult {
  return runTmux(['kill-session', '-t', name]);
}

/** Returns true if a session with this name exists. */
export function tmuxHasSession(name: string): boolean {
  return runTmux(['has-session', '-t', name]).exitCode === 0;
}

/** Set a session option (e.g. `status off`). */
export function tmuxSetOption(
  name: string,
  option: string,
  value: string
): TmuxRunResult {
  return runTmux(['set-option', '-t', name, option, value]);
}

/** Every session name the server currently holds, or `[]` when there
 *  is no server at all (`list-sessions` exits non-zero with "no server
 *  running").
 *
 *  One fork regardless of how many sessions exist, which is the whole
 *  reason it exists next to {@link tmuxHasSession}: a caller checking
 *  N candidates pays N forks through `has-session` and one through
 *  this. `#{session_name}` is the oldest of tmux's format variables,
 *  so this works back to the 2.0 floor the backend supports. */
export function tmuxListSessions(): string[] {
  const { stdout, exitCode } = runTmux([
    'list-sessions',
    '-F',
    '#{session_name}',
  ]);
  if (exitCode !== 0) return [];
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
