/**
 * beam `exec` stream handler — the `ssh host cmd` contract: run an argv,
 * pipe stdin, get stdout, stderr and an exit code. `argv[0]` runs directly,
 * no shell, no word splitting. See docs/beam.md.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { injectedEnv, type NodeEnvContext } from './injected-env.js';
import { isStringArray, isStringRecord } from './open-params.js';
import { resolveCwd } from './resolve-cwd.js';
import type { StreamOpenHandler } from './stream-registry.js';
import type { BeamStream } from './stream.js';

/** The one-byte channel prefix every Data frame on an `exec` stream carries. */
export const EXEC_CHANNEL_STDIN = 0;
export const EXEC_CHANNEL_STDOUT = 1;
export const EXEC_CHANNEL_STDERR = 2;

export interface ExecExit {
  exitCode: number | null;
  signal: string | null;
}

/** The host encodes its Close reason as this JSON, so a caller can recover
 * the exit code and signal without a side channel. */
export function encodeExecExit(exit: ExecExit): string {
  return JSON.stringify(exit);
}

/** Parse a Close reason produced by `encodeExecExit`; null if it isn't one
 * (e.g. the stream closed for some other reason, such as a spawn failure). */
export function decodeExecExit(reason: string | undefined): ExecExit | null {
  if (!reason) return null;
  try {
    const parsed: unknown = JSON.parse(reason);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'exitCode' in parsed &&
      'signal' in parsed
    ) {
      return parsed as ExecExit;
    }
  } catch {
    // Not our encoding — a spawn failure or another close reason.
  }
  return null;
}

/** Prefix a channel byte onto a payload for the wire. */
export function prefixChannel(channel: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.byteLength + 1);
  out[0] = channel;
  out.set(data, 1);
  return out;
}

/** Split a channel-prefixed Data frame payload back apart. */
export function demuxExecData(data: Uint8Array): {
  channel: number;
  payload: Uint8Array;
} {
  return { channel: data[0] ?? -1, payload: data.subarray(1) };
}

const EMPTY_NODE: NodeEnvContext = {
  beamDir: '',
  inboxSocketPath: '',
  ownPeerId: '',
};

/** Create a fresh handler; `node` supplies the injected-environment facts
 * (A4). Optional so unit tests can drive the handler without a real node
 * directory. */
export function createExecStreamHandler(
  node?: NodeEnvContext
): StreamOpenHandler {
  return (stream: BeamStream) => {
    const argv = stream.openParams?.['argv'];
    if (!isStringArray(argv) || argv.length === 0) {
      stream.close('exec requires a non-empty argv');
      return;
    }
    const cwdResult = resolveCwd(stream.openParams?.['cwd']);
    if (!cwdResult.ok) {
      stream.close(cwdResult.reason);
      return;
    }
    const overrides = stream.openParams?.['env'];
    const env = injectedEnv(
      node ?? EMPTY_NODE,
      stream.peer,
      isStringRecord(overrides) ? overrides : {}
    );
    const [file, ...args] = argv;
    let proc: ChildProcess;
    try {
      // `detached: true` puts the child in its own process group (its pid
      // becomes the pgid), so a close from the caller can kill the whole
      // tree — a `tmux` or `git` child must not survive its stream.
      proc = spawn(file, args, {
        cwd: cwdResult.cwd,
        env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      stream.close(
        `cannot spawn ${file}: ${(error as Error).message.split('\n')[0]}`
      );
      return;
    }
    wireExec(stream, proc);
  };
}

/** Forward one child output stream to the BeamStream, one chunk at a time:
 * pause the source immediately after each chunk and resume on the next
 * tick. This bounds how far the child can run ahead of a transport that has
 * fallen behind to roughly one chunk (Node's own pipe highWaterMark) rather
 * than buffering an unbounded amount of output in this process — the
 * concern a large `tmux capture-pane` raises. */
function pumpChannel(
  source: NodeJS.ReadableStream,
  channel: number,
  stream: BeamStream
): void {
  source.on('data', (chunk: Buffer) => {
    source.pause();
    stream.write(prefixChannel(channel, chunk));
    setImmediate(() => source.resume());
  });
}

function killProcessGroup(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function wireExec(stream: BeamStream, proc: ChildProcess): void {
  let settled = false;
  pumpChannel(proc.stdout ?? neverReadable(), EXEC_CHANNEL_STDOUT, stream);
  pumpChannel(proc.stderr ?? neverReadable(), EXEC_CHANNEL_STDERR, stream);

  stream.onData((data) => {
    const { channel, payload } = demuxExecData(data);
    if (channel !== EXEC_CHANNEL_STDIN) return;
    // An empty stdin chunk signals EOF (there is no separate Control
    // message for it in docs/beam.md): a command that reads to EOF before
    // producing output — `tmux load-buffer -`, `sort` — can never finish
    // without a way to end stdin short of closing the whole stream.
    if (payload.byteLength === 0) proc.stdin?.end();
    else proc.stdin?.write(Buffer.from(payload));
  });

  proc.on('exit', (exitCode, signal) => {
    if (settled) return;
    settled = true;
    stream.close(encodeExecExit({ exitCode, signal }));
  });
  proc.on('error', (error) => {
    if (settled) return;
    settled = true;
    stream.close(`exec failed: ${error.message.split('\n')[0]}`);
  });

  stream.onClose(() => killProcessGroup(proc));
  stream.control({ kind: 'opened' });
}

/** A readable that never emits, for the (practically unreachable) case a
 * piped child has no stdout/stderr stream. */
function neverReadable(): NodeJS.ReadableStream {
  return new Readable({ read: () => undefined });
}
