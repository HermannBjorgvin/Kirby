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

/** Upper bound on live PTY sessions per handler instance (per connection). */
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
 * *node* (not one connection — A1). Sessions are keyed by `(peerId,
 * streamId)`, since stream ids are only unique within one connection and two
 * peers can each open stream id 1 at the same time. `node` supplies the
 * facts every spawned process is told about itself (A4); it is optional so
 * unit tests can drive the handler without a real node directory. */
export function createPtyStreamHandler(
  node?: NodeEnvContext
): StreamOpenHandler {
  const sessions = new Map<string, pty.IPty>();
  const key = (stream: BeamStream): string =>
    `${stream.peer.peerId}:${stream.id}`;

  return (stream: BeamStream) => {
    if (sessions.size >= MAX_PTY_SESSIONS) {
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
  stream.onData((data) => proc.write(Buffer.from(data).toString('utf8')));
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
    proc.resize(cols, rows);
  });
}
