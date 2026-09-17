/**
 * beam peer connection — the symmetric handle either side of a live
 * connection gets, whether this machine dialed or accepted. See docs/beam.md
 * and libs/beam/src/lib/muxer.ts for the framing underneath it.
 */

import { Muxer, type MuxerRole } from './muxer.js';
import type { StreamOpenHandler, StreamRegistry } from './stream-registry.js';
import type { BeamStream } from './stream.js';
import type { TransportSocket } from './transport.js';

export interface PeerConnection {
  /** The machine at the other end. */
  readonly peerId: string;
  openStream(
    name: string,
    params?: Record<string, unknown>
  ): Promise<BeamStream>;
  /** Register the handler for streams the peer opens. Shared with every
   * other connection built against the same registry, so a later phase can
   * register `exec` or `msg` once and have it apply everywhere. */
  onStream(name: string, handler: StreamOpenHandler): void;
  /** `reason` distinguishes an ordinary close from a transport that ended
   * mid-frame ("truncated...", A7's FrameDecoder.finish() wiring). */
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

export interface CreateConnectionOptions {
  peerId: string;
  /** The peer's label, as this machine knows it right now. Defaults to
   * `peerId` for callers (mostly tests) that have no label handy. */
  label?: string;
  role: MuxerRole;
  socket: TransportSocket;
  registry: StreamRegistry;
}

/** Wire a transport socket to a Muxer and present the result as a
 * PeerConnection. Identical for a dialed connection and an accepted one —
 * that symmetry is what lets Phase 2 drain a mailbox over whichever
 * connection exists, regardless of which side opened it. */
export function createConnection(
  options: CreateConnectionOptions
): PeerConnection {
  const { socket, registry } = options;
  const muxer = new Muxer(registry, {
    role: options.role,
    sendBytes: (bytes) => socket.send(bytes),
    peer: { peerId: options.peerId, label: options.label ?? options.peerId },
  });
  const closeHandlers: ((reason: string) => void)[] = [];
  let closed = false;

  const finish = (reason: string): void => {
    if (closed) return;
    closed = true;
    muxer.dispose(reason);
    for (const cb of closeHandlers) cb(reason);
  };

  socket.onData((data) => {
    if (!muxer.receive(data)) socket.close();
  });
  socket.onClose(() => {
    // Wire FrameDecoder.finish() into the real transport-end path (A7): a
    // connection that died mid-frame is reported as truncated, not as a
    // quiet, ordinary close.
    let reason = 'connection closed';
    try {
      muxer.finishTransport();
    } catch (error) {
      reason = `connection closed: ${(error as Error).message}`;
    }
    finish(reason);
  });

  return {
    peerId: options.peerId,
    openStream: (name, params) => muxer.openStream(name, params),
    onStream: (name, handler) => registry.register(name, handler),
    onClose: (cb) => closeHandlers.push(cb),
    close: () => {
      finish('closed locally');
      socket.close();
    },
  };
}
