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
  openStream(name: string, openPayload?: Uint8Array): Promise<BeamStream>;
  /** Register the handler for streams the peer opens. Shared with every
   * other connection built against the same registry, so a later phase can
   * register `exec` or `msg` once and have it apply everywhere. */
  onStream(name: string, handler: StreamOpenHandler): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface CreateConnectionOptions {
  peerId: string;
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
  });
  const closeHandlers: (() => void)[] = [];
  let closed = false;

  const finish = (reason: string): void => {
    if (closed) return;
    closed = true;
    muxer.dispose(reason);
    for (const cb of closeHandlers) cb();
  };

  socket.onData((data) => {
    if (!muxer.receive(data)) socket.close();
  });
  socket.onClose(() => finish('connection closed'));

  return {
    peerId: options.peerId,
    openStream: (name, openPayload) => muxer.openStream(name, openPayload),
    onStream: (name, handler) => registry.register(name, handler),
    onClose: (cb) => closeHandlers.push(cb),
    close: () => {
      finish('closed locally');
      socket.close();
    },
  };
}
