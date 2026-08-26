import type {
  SessionBackend,
  SessionBackendFactory,
  SessionSpec,
} from '@kirby/terminal';
import { PtySession } from '@kirby/terminal-pty';
import { isTmuxAvailable } from './is-tmux-available.js';
import { sanitizeTmuxSessionName } from './sanitize-tmux-session-name.js';
import { tmuxKillSession, tmuxVersion } from './tmux-cli.js';

// `new-session -e VAR=value` exists from tmux 3.2. Probed once.
let envFlagSupport: boolean | null = null;
function supportsSessionEnvFlag(): boolean {
  if (envFlagSupport == null) {
    try {
      const m = /(\d+)\.(\d+)/.exec(tmuxVersion());
      envFlagSupport = m
        ? Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 2)
        : false;
    } catch {
      envFlagSupport = false;
    }
  }
  return envFlagSupport;
}

/**
 * Environment to inject into the tmux *session* (not just the client).
 * A tmux server keeps the environment it was started with and uses it
 * for every command it spawns — so a stale server (started by an old
 * process, a test run, a different context) silently poisons new
 * sessions with its HOME/PATH, and the caller's seed additions never
 * reach the command at all. `-e` pins the essentials per session.
 */
function sessionEnvFlags(spec: SessionSpec): string[] {
  if (!supportsSessionEnvFlag()) return [];
  const vars = new Map<string, string>();
  for (const key of ['PATH', 'HOME']) {
    const value = spec.env?.[key] ?? process.env[key];
    if (value) vars.set(key, value);
  }
  for (const [key, value] of Object.entries(spec.envAdditions ?? {})) {
    if (value != null) vars.set(key, value);
  }
  return [...vars].flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

export interface TmuxFactoryOptions {
  /** Optional. Prepended to spec.name (with no separator) before tmux
   *  sanitization. Use this for any caller-side namespacing — the lib
   *  treats it as opaque. */
  sessionPrefix?: string;
}

/** Build a SessionBackendFactory configured with the caller's prefix.
 *  The lib never sees a branch, repo path, or product name — the
 *  caller is responsible for whatever uniqueness/namespacing it
 *  wants. The lib only enforces tmux's own validity rules on the
 *  assembled string. */
export function createTmuxBackendFactory(
  opts?: TmuxFactoryOptions
): SessionBackendFactory {
  const prefix = opts?.sessionPrefix ?? '';
  return (spec: SessionSpec): SessionBackend => {
    const tmuxName = sanitizeTmuxSessionName(prefix + spec.name);
    return new TmuxBackend(spec, tmuxName);
  };
}

/**
 * Tmux-backed session: persists across Kirby restarts. Implementation
 * spawns `tmux new-session -A` via a local PTY — `-A` makes the call
 * idempotent (attach if the session exists, create if it doesn't), so
 * resume-after-restart and first-launch share one code path.
 *
 * Lifecycle:
 * - dispose() detaches the local PTY but leaves the tmux session
 *   running so it can be reattached.
 * - kill() runs `tmux kill-session` first, then disposes the local
 *   PTY — the tmux session is gone for good.
 */
class TmuxBackend implements SessionBackend {
  private readonly inner: PtySession;
  private killed = false;

  constructor(spec: SessionSpec, private readonly tmuxName: string) {
    // tmux new-session -A: create-or-attach atomically. The local
    // PtySession runs the tmux client; tmux owns the actual shell.
    this.inner = new PtySession(
      'tmux',
      [
        'new-session',
        '-A',
        '-s',
        tmuxName,
        '-c',
        spec.cwd,
        '-x',
        String(spec.cols),
        '-y',
        String(spec.rows),
        ...sessionEnvFlags(spec),
        '--',
        spec.cmd,
        ...spec.args,
      ],
      { cols: spec.cols, rows: spec.rows, cwd: spec.cwd, env: spec.env }
    );
  }

  get pid(): number {
    return this.inner.pid;
  }
  get cols(): number {
    return this.inner.cols;
  }
  get rows(): number {
    return this.inner.rows;
  }
  write(data: string): void {
    this.inner.write(data);
  }
  resize(cols: number, rows: number): void {
    this.inner.resize(cols, rows);
  }
  onData(cb: (data: string) => void): void {
    this.inner.onData(cb);
  }
  offData(cb: (data: string) => void): void {
    this.inner.offData(cb);
  }
  onExit(cb: (code: number, signal?: number) => void): void {
    this.inner.onExit(cb);
  }
  offExit(cb: (code: number, signal?: number) => void): void {
    this.inner.offExit(cb);
  }

  /** Soft cleanup — detach only. Tmux session keeps running so the
   *  next Kirby launch can reattach. */
  dispose(): void {
    this.inner.dispose();
  }

  /** Hard teardown — kill the tmux session, then detach. The signal
   *  argument from the interface is ignored (tmux kill-session does
   *  not accept one); we always do a full session kill. */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    tmuxKillSession(this.tmuxName);
    this.inner.dispose();
  }
}

// Re-export availability probe so callers don't need a separate import.
export { isTmuxAvailable };
