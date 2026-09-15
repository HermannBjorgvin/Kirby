import type {
  SessionBackend,
  SessionBackendFactory,
  SessionSpec,
} from '@kirby/terminal';
import { PtySession } from '@kirby/terminal-pty';
import { isTmuxAvailable } from './is-tmux-available.js';
import { sanitizeTmuxSessionName } from './sanitize-tmux-session-name.js';
import {
  isDuplicateSession,
  sessionNameCandidates,
  tmuxAttachArgs,
  tmuxHasSession,
  tmuxKillSession,
  tmuxNewSessionDetached,
  tmuxSetOption,
  tmuxVersion,
} from './tmux-cli.js';

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

/** The command half of `new-session`'s argv. An empty `cmd` is the
 *  SessionSpec contract for "the backend's default shell": tmux does
 *  that by itself when no command follows the flags, so nothing is
 *  appended — a trailing `--` with an empty word would ask it to exec
 *  "" and fail instead. */
function sessionCommand(spec: SessionSpec): string[] {
  if (spec.cmd === '') return [];
  return ['--', spec.cmd, ...spec.args];
}

/** How many candidate names a create tries before giving up: bounds a
 *  server that answers "duplicate session" to everything. */
const MAX_CREATE_ATTEMPTS = 10_000;

/**
 * What the caller knows about a session's identity and how to name it.
 * The lib never sees a branch, repo path or product name: it asks
 * these three questions and does exactly what the answers say.
 */
export interface TmuxFactoryOptions {
  /** The tmux name of a session that already *is* this spec — however
   *  the caller decides that — or `null` when there is none. A name
   *  returned here is attached to as it stands; nothing is created and
   *  nothing about the session is rewritten. */
  resolve: (spec: SessionSpec) => string | null;
  /** The name the caller would like a new session for this spec to
   *  have. Sanitized to tmux's rules here, and suffixed `-2`, `-3`, …
   *  while the server already holds it. */
  label: (spec: SessionSpec) => string;
  /** The session user options to write on a session this factory
   *  creates, before any client attaches to it. Never written on a
   *  session `resolve` found. */
  tags: (spec: SessionSpec) => Record<string, string>;
  /** Optional. Names the caller holds itself and wants skipped when a
   *  label is probed for a free candidate — on top of what the server
   *  holds — so the caller's own choice of name and the one created
   *  here are decided against the same set. Asked per spec, because
   *  what the caller holds a name for may depend on the kind of
   *  session it is about to create. */
  isTaken?: (name: string, spec: SessionSpec) => boolean;
}

/** Build a SessionBackendFactory over the caller's identity rules.
 *  The lib only enforces tmux's own validity rules on the label. */
export function createTmuxBackendFactory(
  opts: TmuxFactoryOptions
): SessionBackendFactory {
  return (spec: SessionSpec): SessionBackend => new TmuxBackend(spec, opts);
}

/**
 * Tmux-backed session: persists across Kirby restarts.
 *
 * Resolve, else create: the caller's `resolve` names an existing
 * session to attach to; otherwise a session is created *detached*
 * under a free name, its tags are written, and only then does a client
 * attach. That order is the point — everything another program can
 * learn about the session is on it before the session can be observed
 * with a client on it, and a name that happens to be taken by a
 * session the caller does not recognise is left alone rather than
 * attached to. `new-session -A` could do neither: it attaches to
 * whatever holds the name and creates before anything can be written.
 *
 * Lifecycle:
 * - dispose() detaches the local PTY but leaves the tmux session
 *   running so it can be reattached.
 * - kill() runs `tmux kill-session` first, then disposes the local
 *   PTY — the tmux session is gone for good.
 */
class TmuxBackend implements SessionBackend {
  private readonly inner: PtySession;
  private readonly tmuxName: string;
  private killed = false;

  constructor(spec: SessionSpec, opts: TmuxFactoryOptions) {
    this.tmuxName = opts.resolve(spec) ?? createTagged(spec, opts);
    // The status bar goes off on every attach because the caller
    // embeds the session inside its own chrome: the bar wastes a row
    // and its default green background bleeds into renderers that
    // derive a container background from the bottom screen row.
    tmuxSetOption(this.tmuxName, 'status', 'off');
    // The client must not think it's nested: when Kirby itself runs
    // inside a tmux window, the inherited TMUX var makes the client
    // refuse with "sessions should be nested with care".
    const clientEnv: Record<string, string | undefined> = {
      ...(spec.env ?? process.env),
    };
    delete clientEnv.TMUX;
    delete clientEnv.TMUX_PANE;
    // The local PtySession runs the tmux client; tmux owns the shell.
    this.inner = new PtySession('tmux', tmuxAttachArgs(this.tmuxName), {
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: clientEnv,
    });
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

/** Create the session for a spec under a free name and tag it. The
 *  name is decided here and never again: the tags, not the name, are
 *  what a later lookup goes by. */
function createTagged(spec: SessionSpec, opts: TmuxFactoryOptions): string {
  const name = createDetached(
    sanitizeTmuxSessionName(opts.label(spec)),
    spec,
    opts.isTaken
  );
  for (const [key, value] of Object.entries(opts.tags(spec))) {
    tmuxSetOption(name, key, value);
  }
  return name;
}

/** `new-session -d` under the first free candidate of `label`. A
 *  candidate the caller or the server holds is skipped without asking
 *  tmux to create it; one that turns out taken between the probe and
 *  the create — another creator racing this one — is skipped the same
 *  way. Any other failure is the caller's problem, thrown with tmux's
 *  own words. */
function createDetached(
  label: string,
  spec: SessionSpec,
  isTaken: (name: string, spec: SessionSpec) => boolean = () => false
): string {
  const request = {
    cwd: spec.cwd,
    cols: spec.cols,
    rows: spec.rows,
    flags: sessionEnvFlags(spec),
    command: sessionCommand(spec),
  };
  let attempts = 0;
  for (const candidate of sessionNameCandidates(label)) {
    if ((attempts += 1) > MAX_CREATE_ATTEMPTS) break;
    if (isTaken(candidate, spec) || tmuxHasSession(candidate)) continue;
    const result = tmuxNewSessionDetached(candidate, request);
    if (result.exitCode === 0) return candidate;
    if (!isDuplicateSession(result)) {
      throw new Error(
        `tmux new-session -s ${candidate} failed: ${result.stderr.trim()}`
      );
    }
  }
  throw new Error(`no free tmux session name for ${label}`);
}

// Re-export availability probe so callers don't need a separate import.
export { isTmuxAvailable };
