import type { SessionBackend, SessionSpec } from '@kirby/terminal';
import { PtySession } from '@kirby/terminal-pty';
import {
  tmuxAttachArgs,
  tmuxCapturePane,
  tmuxKillSession,
  tmuxPaneState,
} from './tmux-cli.js';
import { prepareTmuxSession, type TmuxLaunchPlan } from './tmux-launch.js';
export type { TmuxLaunchPlan } from './tmux-launch.js';

type ExitCallback = (code: number, signal?: number) => void;

export type TmuxSessionPreparer = (
  spec: SessionSpec,
  plan: TmuxLaunchPlan
) => string | Promise<string>;
let prepare: TmuxSessionPreparer = prepareTmuxSession;

/** Desktop supplies an isolated process for server creation; Node callers use native tmux. */
export function setTmuxSessionPreparer(
  preparer: TmuxSessionPreparer = prepareTmuxSession
): void {
  prepare = preparer;
}

/** Explicit create, attach or restart; no identity interpretation in the transport. */
export async function createTmuxBackend(
  spec: SessionSpec,
  plan: TmuxLaunchPlan
): Promise<SessionBackend> {
  const name = await prepare(spec, plan);
  return new TmuxBackend(spec, name, plan.mode === 'create');
}

class TmuxBackend implements SessionBackend {
  private inner: PtySession;
  private readonly data = new Set<(data: string) => void>();
  private finalFrame: string | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private connection: NonNullable<SessionBackend['connectionState']> =
    'connected';
  private readonly spec: SessionSpec;
  private width: number;
  private height: number;
  private readonly exits = new Set<ExitCallback>();
  private readonly disconnects = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private killed = false;
  private state = {
    running: true,
    exitCode: undefined as number | undefined,
    signal: undefined as number | undefined,
  };
  readonly name: string;

  constructor(spec: SessionSpec, name: string, created: boolean) {
    this.name = name;
    this.spec = spec;
    this.width = spec.cols;
    this.height = spec.rows;
    try {
      this.inner = this.attach();
    } catch (error) {
      if (created) tmuxKillSession(this.name);
      throw error;
    }
    // Retained panes do not terminate the client when their process exits.
    // Polling is local, bounded per command and stopped at dispose or exit.
    this.timer = setInterval(() => this.inspect(), 500);
    this.timer.unref();
    // Callers await creation before subscribing. Let those subscriptions bind
    // before inspecting an already-exited process and replaying its final frame.
    setTimeout(() => this.inspect(), 0).unref();
  }

  private attach(): PtySession {
    const env = { ...(this.spec.env ?? process.env) };
    delete env.TMUX;
    delete env.TMUX_PANE;
    const client = new PtySession('tmux', tmuxAttachArgs(this.name), {
      cols: this.width,
      rows: this.height,
      cwd: this.spec.cwd,
      env,
    });
    for (const cb of this.data) client.onData(cb);
    client.onExit(() => {
      if (this.disposed || this.inner !== client) return;
      clearTimeout(this.stableTimer);
      this.inspect();
      if (!this.state.running) return;
      this.connection = 'reconnecting';
      for (const cb of [...this.disconnects]) cb();
      this.reconnect();
    });
    return client;
  }

  private reconnect(): void {
    if (this.disposed || !this.state.running) return;
    if (this.reconnectAttempts >= 3) {
      this.connection = 'failed';
      return;
    }
    const delay = 500 * 2 ** this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (this.disposed || !this.state.running) return;
      this.inner.dispose();
      try {
        this.inner = this.attach();
        this.connection = 'connected';
        // A client that survives two seconds is a successful reconnection.
        this.stableTimer = setTimeout(() => {
          this.reconnectAttempts = 0;
        }, 2000);
        this.stableTimer.unref();
      } catch {
        this.reconnect();
      }
    }, delay);
    this.reconnectTimer.unref();
  }

  private inspect(): void {
    if (!this.state.running || this.disposed) return;
    const pane = tmuxPaneState(this.name);
    if (pane && !pane.paneDead) return;
    if (pane?.paneDead) this.replayFinalFrame();
    this.state = {
      running: false,
      exitCode: pane?.exitCode,
      signal: pane?.exitSignal,
    };
    clearInterval(this.timer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    for (const cb of [...this.exits])
      cb(this.state.exitCode ?? 0, this.state.signal);
  }

  private replayFinalFrame(): void {
    const frame = tmuxCapturePane(this.name);
    if (frame == null) return;
    // A process may exit before its client's first redraw. Replay the
    // retained frame, including history, before any listener handles exit.
    const output =
      '\x1b[?1049l\x1b[3J\x1b[2J\x1b[H' + frame.replace(/\r?\n/g, '\r\n');
    this.finalFrame = output;
    for (const cb of [...this.data]) cb(output);
  }

  get connectionState() {
    return this.connection;
  }
  get processState() {
    return this.state;
  }
  get pid(): number {
    return this.inner.pid;
  }
  get cols(): number {
    return this.width;
  }
  get rows(): number {
    return this.height;
  }
  write(data: string): void {
    this.inner.write(data);
  }
  resize(cols: number, rows: number): void {
    this.width = cols;
    this.height = rows;
    this.inner.resize(cols, rows);
  }
  onData(cb: (data: string) => void): void {
    this.data.add(cb);
    this.inner.onData(cb);
    if (this.finalFrame !== null && !this.disposed) cb(this.finalFrame);
  }
  offData(cb: (data: string) => void): void {
    this.data.delete(cb);
    this.inner.offData(cb);
  }
  onExit(cb: ExitCallback): void {
    this.exits.add(cb);
    if (!this.state.running)
      queueMicrotask(() => {
        if (!this.disposed && this.exits.has(cb))
          cb(this.state.exitCode ?? 0, this.state.signal);
      });
  }
  offExit(cb: ExitCallback): void {
    this.exits.delete(cb);
  }
  onDisconnect(cb: () => void): void {
    this.disconnects.add(cb);
  }
  offDisconnect(cb: () => void): void {
    this.disconnects.delete(cb);
  }

  /** Detach the local client without terminating the hosted process. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connection = 'failed';
    clearInterval(this.timer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    this.data.clear();
    this.exits.clear();
    this.disconnects.clear();
    this.inner.dispose();
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    tmuxKillSession(this.name);
    this.dispose();
  }
}

export { isTmuxAvailable } from './is-tmux-available.js';
