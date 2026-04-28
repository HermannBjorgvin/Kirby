/**
 * Universal contract between Kirby's session registry and any backend
 * (direct PTY, tmux, future SSH/Docker). No backend-specific fields,
 * no Kirby-specific fields — backend libs configure themselves through
 * their own factory options at composition time.
 */

export interface SessionSpec {
  /** Caller-supplied identifier. Backends use it as a stable session id
   *  (registry key for the direct-PTY backend; tmux session name for
   *  the tmux backend, after the lib's own sanitization). The caller is
   *  responsible for whatever uniqueness/namespacing it needs. */
  name: string;
  cmd: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string | undefined>;
}

export interface SessionBackend {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  offData(cb: (data: string) => void): void;
  onExit(cb: (code: number, signal?: number) => void): void;
  offExit(cb: (code: number, signal?: number) => void): void;
  /** Soft cleanup: release local resources. For the tmux backend this
   *  detaches the local PTY and leaves the tmux session running so it
   *  can be reattached on the next Kirby start. */
  dispose(): void;
  /** Hard teardown: terminate the underlying session. For the tmux
   *  backend this runs `tmux kill-session` first, then disposes the
   *  local PTY. */
  kill(signal?: string): void;
}

export type SessionBackendFactory = (spec: SessionSpec) => SessionBackend;
