/**
 * beam `pty` / `pty:<program>` stream handler — a real terminal, backed by
 * node-pty. `pty` runs the login shell; `pty:<program>` runs that program
 * directly with no shell word-splitting. See docs/beam.md.
 */

import { existsSync } from 'node:fs';
import * as pty from 'node-pty';
import type { StreamOpenHandler } from './stream-registry.js';
import type { BeamStream } from './stream.js';

/** Upper bound on live PTY sessions per handler instance (per connection). */
export const MAX_PTY_SESSIONS = 32;
const MIN_COLS_ROWS = 2;
const MAX_COLS_ROWS = 500;

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

function clampInt(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(MAX_COLS_ROWS, Math.max(MIN_COLS_ROWS, Math.trunc(value)));
}

function isResize(message: Record<string, unknown>): boolean {
  return message['kind'] === 'resize';
}

/** Create a fresh handler: one instance owns the live sessions for one
 * connection, so the 32-PTY cap applies per connection, not globally. */
export function createPtyStreamHandler(): StreamOpenHandler {
  const sessions = new Map<number, pty.IPty>();

  return (stream: BeamStream) => {
    if (sessions.size >= MAX_PTY_SESSIONS) {
      stream.close('too many live pty sessions');
      return;
    }
    const file = programFor(stream.name);
    let proc: pty.IPty;
    try {
      proc = pty.spawn(file, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch (error) {
      stream.close(
        `cannot spawn ${file}: ${(error as Error).message.split('\n')[0]}`
      );
      return;
    }
    sessions.set(stream.id, proc);
    wireSession(stream, proc, sessions);
    stream.control({ kind: 'opened' });
  };
}

function wireSession(
  stream: BeamStream,
  proc: pty.IPty,
  sessions: Map<number, pty.IPty>
): void {
  proc.onData((data) => {
    if (sessions.get(stream.id) === proc)
      stream.write(Buffer.from(data, 'utf8'));
  });
  proc.onExit(({ exitCode, signal }) => {
    if (sessions.get(stream.id) !== proc) return;
    sessions.delete(stream.id);
    const signalPart = signal ? `, signal ${signal}` : '';
    stream.close(`process exited (code ${exitCode}${signalPart})`);
  });
  stream.onData((data) => proc.write(Buffer.from(data).toString('utf8')));
  stream.onClose(() => {
    if (sessions.get(stream.id) !== proc) return;
    sessions.delete(stream.id);
    try {
      proc.kill();
    } catch {
      // Already gone.
    }
  });
  stream.onControl((message) => {
    if (!isResize(message)) return;
    const cols = clampInt(message['cols']);
    const rows = clampInt(message['rows']);
    if (cols === null || rows === null) return;
    proc.resize(cols, rows);
  });
}
