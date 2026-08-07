import type {
  SessionBackend,
  SessionBackendFactory,
  SessionSpec,
} from '@kirby/terminal';
import { PtySession } from '@kirby/terminal-pty';
import { beamNewArgs } from './beam-args.js';
import { beamKillSession } from './beam-cli.js';

export interface BeamFactoryOptions {
  /** The beam binary. Defaults to 'beam' on PATH. */
  beamBin?: string;
  /** Optional. Prepended to the session part of the beam target (the
   *  part after the host's colon), the same namespacing the tmux
   *  backend applies — the lib treats it as opaque. */
  sessionPrefix?: string;
  /**
   * Per-session lookups the caller wires to its own bookkeeping — the
   * lib knows nothing about branches or repos. Returning undefined
   * omits the worktree flags, which is the reattach path: the session
   * already exists on the host, so beam ignores creation flags anyway.
   */
  repoFor?: (sessionName: string) => string | undefined;
  branchFor?: (sessionName: string) => string | undefined;
}

/** Build a SessionBackendFactory that opens sessions through beam. */
export function createBeamBackendFactory(
  opts?: BeamFactoryOptions
): SessionBackendFactory {
  const bin = opts?.beamBin ?? 'beam';
  const prefix = opts?.sessionPrefix ?? '';
  return (spec: SessionSpec): SessionBackend => {
    return new BeamBackend(
      spec,
      beamTarget(spec.name, prefix),
      bin,
      opts?.repoFor?.(spec.name),
      opts?.branchFor?.(spec.name)
    );
  };
}

/** `<host>:<name>` with the prefix spliced into the session part, so
 *  the session on the host carries the caller's namespace while the
 *  caller's own key stays short. A name with no colon gets the prefix
 *  whole — beam then treats it as a local session. */
export function beamTarget(name: string, prefix: string): string {
  const i = name.indexOf(':');
  if (i === -1) return prefix + name;
  return name.slice(0, i + 1) + prefix + name.slice(i + 1);
}

/**
 * Beam-backed session: lives in tmux on a remote machine, reached by
 * running the beam CLI inside a local PTY — the exact shape of the
 * tmux backend, one machine further away. `beam new` is
 * create-or-attach, so first launch and reattach-after-restart share
 * one code path.
 *
 * spec.cwd is a path on the host (beam's -c), never a local
 * directory. spec.env is NOT forwarded: the command runs on the host,
 * whose environment is its own — flows that pass data through the
 * environment stay local.
 *
 * Lifecycle:
 * - dispose() drops the local PTY (and with it the ssh connection);
 *   the session on the host keeps running.
 * - kill() runs `beam kill` so the session on the host dies too. The
 *   worktree stays — removing it is the workspace layer's decision.
 */
class BeamBackend implements SessionBackend {
  private readonly inner: PtySession;
  private killed = false;

  constructor(
    spec: SessionSpec,
    private readonly target: string,
    private readonly bin: string,
    repo: string | undefined,
    branch: string | undefined
  ) {
    const args = beamNewArgs({
      target,
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      ...(repo ? { repo } : {}),
      ...(branch ? { branch } : {}),
      command: [spec.cmd, ...spec.args],
    });
    // The local PTY runs the beam client from Kirby's own cwd with
    // Kirby's own environment (ssh config, agent, beam config).
    this.inner = new PtySession(bin, args, {
      cols: spec.cols,
      rows: spec.rows,
      cwd: process.cwd(),
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

  /** Soft cleanup — detach only. The session on the host keeps
   *  running; the next launch reattaches. */
  dispose(): void {
    this.inner.dispose();
  }

  /** Hard teardown — kill the session on its host, then drop the
   *  local PTY. The signal argument is ignored (beam kill takes
   *  none); like the tmux backend, it is always a full session kill. */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    beamKillSession(this.bin, this.target);
    this.inner.dispose();
  }
}
