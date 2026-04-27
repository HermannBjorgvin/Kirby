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

/** Idempotent session create. With `-A` tmux attaches if the session
 *  already exists rather than erroring, so we don't need a separate
 *  has-session check. `-d` keeps the new session detached. */
export function tmuxNewSession(opts: {
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  cmd: string;
  args: string[];
}): TmuxRunResult {
  return runTmux([
    'new-session',
    '-A',
    '-d',
    '-s',
    opts.name,
    '-c',
    opts.cwd,
    '-x',
    String(opts.cols),
    '-y',
    String(opts.rows),
    opts.cmd,
    ...opts.args,
  ]);
}

/** Hard teardown — kills the named tmux session and all its panes. */
export function tmuxKillSession(name: string): TmuxRunResult {
  return runTmux(['kill-session', '-t', name]);
}

/** Returns true if a session with this name exists. */
export function tmuxHasSession(name: string): boolean {
  return runTmux(['has-session', '-t', name]).exitCode === 0;
}
