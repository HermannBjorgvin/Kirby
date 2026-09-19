/**
 * beam `pty` / `pty:<program>` stream handler — a real terminal, backed by
 * node-pty. Open parameters (D1): `{ argv?, cwd?, env?, cols?, rows? }`. An
 * absent or empty `argv` means the login shell; `argv[0]` is executed
 * directly, no shell, no word splitting. `pty:<program>` stays valid as a
 * shorthand for `argv: ['<program>']`. See docs/beam.md.
 */

import { existsSync } from 'node:fs';
import * as pty from 'node-pty';
import { injectedEnv, type NodeEnvContext } from './injected-env.js';
import { isString, isStringRecord } from './open-params.js';
import { resolveCwd } from './resolve-cwd.js';
import type { StreamOpenHandler } from './stream-registry.js';
import type { BeamStream } from './stream.js';

/** Upper bound on live PTY sessions per peer (docs/beam.md's "per
 * connection"). One handler instance is shared by every connection on a
 * node (host.ts hands every connection the same StreamRegistry — A1), so
 * the cap is enforced per peerId within that shared session map, not
 * globally across the whole node: one peer opening 32 shells must not
 * shrink another peer's own budget (D5). */
export const MAX_PTY_SESSIONS = 32;
const MIN_COLS_ROWS = 2;
const MAX_COLS_ROWS = 500;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** Login shell preference: $SHELL, then bash, then sh — whatever exists. */
export function shellForEnv(): string {
  const candidates = [process.env['SHELL'], '/bin/bash', '/bin/sh'];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return 'sh';
}

function programFor(streamName: string): string {
  return streamName.startsWith('pty:')
    ? streamName.slice(4).trim() || shellForEnv()
    : shellForEnv();
}

function clampInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(MAX_COLS_ROWS, Math.max(MIN_COLS_ROWS, Math.trunc(value)));
}

function isResize(message: Record<string, unknown>): boolean {
  return message['kind'] === 'resize';
}

/**
 * Attach an `'error'` listener to a spawned pty.
 *
 * node-pty's `UnixTerminal` re-emits its socket's `'error'` on the terminal
 * itself, and an EventEmitter that emits `'error'` with nobody listening
 * throws synchronously — so a pty whose fd dies under it (EIO on a hung-up
 * master, a kernel refusing the read) takes the whole node down, from an
 * event whose timing the far side chooses. `IPty`'s typed surface exposes
 * only the `onData`/`onExit` disposables and no `on()`, so the listener has
 * to go on the EventEmitter the implementation actually is; the cast is the
 * narrowest shape that admits. Exported so the guard can be exercised
 * without having to break a real pty.
 */
export function guardPtyErrors(
  proc: pty.IPty,
  onError: (error: Error) => void
): void {
  const emitter = proc as unknown as {
    on?: (event: 'error', listener: (error: Error) => void) => void;
  };
  emitter.on?.('error', onError);
}

/** `argv[0]` runs directly — no shell, no word splitting — with the rest as
 * literal arguments. An absent or empty `argv` param falls back to the
 * stream-name form (`pty` -> login shell, `pty:<program>` -> that program). */
function resolveArgv(stream: BeamStream): string[] {
  const argv = stream.openParams?.['argv'];
  if (Array.isArray(argv) && argv.length > 0 && argv.every(isString)) {
    return argv as string[];
  }
  return [programFor(stream.name)];
}

/** Create a fresh handler: one instance owns the live sessions for one
 * *node* (not one connection — A1), because host.ts shares one
 * StreamRegistry across every connection. Sessions are keyed by `(peerId,
 * streamId)`, since stream ids are only unique within one connection and two
 * peers can each open stream id 1 at the same time; that same key lets
 * `MAX_PTY_SESSIONS` be enforced per peer rather than globally (D5), even
 * though every peer's sessions live in one shared map. `node` supplies the
 * facts every spawned process is told about itself (A4); it is optional so
 * unit tests can drive the handler without a real node directory. */
export function createPtyStreamHandler(
  node?: NodeEnvContext
): StreamOpenHandler {
  const sessions = new Map<string, pty.IPty>();
  const key = (stream: BeamStream): string =>
    `${stream.peer.peerId}:${stream.id}`;
  const sessionsForPeer = (peerId: string): number => {
    const prefix = `${peerId}:`;
    let count = 0;
    for (const sessionKey of sessions.keys()) {
      if (sessionKey.startsWith(prefix)) count += 1;
    }
    return count;
  };

  return (stream: BeamStream) => {
    if (sessionsForPeer(stream.peer.peerId) >= MAX_PTY_SESSIONS) {
      stream.close('too many live pty sessions');
      return;
    }
    const cwdResult = resolveCwd(stream.openParams?.['cwd']);
    if (!cwdResult.ok) {
      stream.close(cwdResult.reason);
      return;
    }
    const [file, ...args] = resolveArgv(stream);
    const overrides = stream.openParams?.['env'];
    const env = injectedEnv(
      node ?? { beamDir: '', inboxSocketPath: '', ownPeerId: '' },
      stream.peer,
      isStringRecord(overrides) ? overrides : {}
    );
    let proc: pty.IPty;
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: clampInt(stream.openParams?.['cols'], DEFAULT_COLS),
        rows: clampInt(stream.openParams?.['rows'], DEFAULT_ROWS),
        cwd: cwdResult.cwd,
        env,
      });
    } catch (error) {
      stream.close(
        `cannot spawn ${file}: ${(error as Error).message.split('\n')[0]}`
      );
      return;
    }
    sessions.set(key(stream), proc);
    wireSession(stream, proc, sessions, key(stream));
    stream.control({ kind: 'opened' });
  };
}

function wireSession(
  stream: BeamStream,
  proc: pty.IPty,
  sessions: Map<string, pty.IPty>,
  sessionKey: string
): void {
  guardPtyErrors(proc, (error) => {
    if (sessions.get(sessionKey) !== proc) return;
    sessions.delete(sessionKey);
    stream.close(`pty error: ${error.message.split('\n')[0]}`);
  });
  proc.onData((data) => {
    if (sessions.get(sessionKey) === proc)
      stream.write(Buffer.from(data, 'utf8'));
  });
  proc.onExit(({ exitCode, signal }) => {
    if (sessions.get(sessionKey) !== proc) return;
    sessions.delete(sessionKey);
    const signalPart = signal ? `, signal ${signal}` : '';
    stream.close(`process exited (code ${exitCode}${signalPart})`);
  });
  stream.onData((data) => {
    try {
      // Same hazard as the resize below: node-pty's write() goes at a
      // native fd that a racing process exit may already have closed, and
      // a remote peer's ordinary keystroke must never be able to throw an
      // uncaught exception out of a data-frame handler.
      proc.write(Buffer.from(data).toString('utf8'));
    } catch {
      // The pty has already exited; there is nothing left to write to.
    }
  });
  stream.onClose(() => {
    if (sessions.get(sessionKey) !== proc) return;
    sessions.delete(sessionKey);
    try {
      proc.kill();
    } catch {
      // Already gone.
    }
  });
  stream.onControl((message) => {
    if (!isResize(message)) return;
    const cols = clampInt(message['cols'], NaN);
    const rows = clampInt(message['rows'], NaN);
    if (Number.isNaN(cols) || Number.isNaN(rows)) return;
    try {
      // node-pty's resize() is a native ioctl call and throws if the pty's
      // fd is already gone — a resize can race the process exiting. Same
      // class of bug as D3's stdin write: a remote peer's ordinary, timing-
      // dependent message must never be able to throw an uncaught
      // exception out of a control-frame handler and crash the node.
      proc.resize(cols, rows);
    } catch {
      // The pty has already exited; nothing to resize.
    }
  });
}
