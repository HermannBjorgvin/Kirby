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
  /** Command to run. The empty string means the backend's own default
   *  interactive shell: tmux runs its `default-shell`, the direct PTY
   *  backend runs `$SHELL` (falling back to `/bin/sh`). Callers wanting
   *  "a terminal" rather than "this program" pass that. */
  cmd: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  /** The caller's own additions over the inherited environment (e.g.
   *  seed variables), separate from the merged `env` below. Backends
   *  whose session host has its *own* environment (tmux: the server
   *  keeps the env it was started with) must deliver these into the
   *  session explicitly — the merged `env` only reaches the client
   *  process. */
  envAdditions?: Record<string, string | undefined>;
  /** Complete environment for the spawned process. `undefined` means
   *  "inherit the parent environment" — backends must not treat it as
   *  "empty environment", or the child loses PATH/HOME. Callers that
   *  need additions merge them over `process.env` themselves rather
   *  than passing a partial bag. */
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
