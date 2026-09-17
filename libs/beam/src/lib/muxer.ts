/**
 * beam muxer — turns raw transport bytes into stream events and back, for
 * one connection. Works identically whether this side dialed or accepted,
 * which is what lets Phase 2's mailbox drain over whichever connection
 * exists regardless of who opened it. See docs/beam.md.
 */

import {
  FrameDecoder,
  FrameType,
  ProtocolError,
  SeqSender,
  SeqTracker,
  decodeText,
  encodeFrame,
  type Frame,
} from './protocol.js';
import { BeamStreamImpl, type BeamStream, type StreamSink } from './stream.js';
import type { StreamRegistry } from './stream-registry.js';

const encoder = new TextEncoder();

/** How long a locally-opened stream waits for the peer's ack before the
 * promise from `openStream` rejects. */
const OPEN_ACK_TIMEOUT_MS = 10_000;

export type MuxerRole = 'initiator' | 'acceptor';

export interface MuxerOptions {
  /** 'initiator' (the side that dialed) allocates odd stream ids, 'acceptor'
   * even ones, so the two directions can never collide when either side may
   * open a stream. */
  role: MuxerRole;
  sendBytes: (bytes: Uint8Array) => void;
}

export class Muxer {
  private readonly decoder = new FrameDecoder();
  private readonly sender = new SeqSender();
  private readonly tracker = new SeqTracker();
  private readonly streams = new Map<number, BeamStreamImpl>();
  private readonly sink: StreamSink;
  private readonly registry: StreamRegistry;
  private readonly sendBytes: (bytes: Uint8Array) => void;
  private nextStreamId: number;
  private disposed = false;

  constructor(registry: StreamRegistry, options: MuxerOptions) {
    this.registry = registry;
    this.sendBytes = options.sendBytes;
    this.nextStreamId = options.role === 'initiator' ? 1 : 2;
    this.sink = {
      sendData: (streamId, data) =>
        this.sendFrame(FrameType.Data, streamId, data),
      sendClose: (streamId, reason) => {
        // A locally-initiated close must not linger in `streams`: the peer
        // will not send one back, and nothing else would ever remove it.
        this.streams.delete(streamId);
        this.sendFrame(
          FrameType.Close,
          streamId,
          reason === undefined ? new Uint8Array(0) : encoder.encode(reason)
        );
      },
      sendControl: (message) =>
        this.sendFrame(
          FrameType.Control,
          0,
          encoder.encode(JSON.stringify(message))
        ),
    };
  }

  /**
   * Open a named stream and wait for the peer to acknowledge it. The ack
   * callbacks must be wired up *before* the Open frame is sent: a transport
   * that delivers synchronously (as a same-process wired pair does in
   * tests) can round-trip the peer's response before a `new Promise`
   * executor would otherwise get a chance to run.
   */
  openStream(name: string, openPayload?: Uint8Array): Promise<BeamStream> {
    if (this.disposed) return Promise.reject(new Error('connection is closed'));
    const id = this.nextStreamId;
    this.nextStreamId += 2;
    const stream = new BeamStreamImpl(this.sink, id, name);
    this.streams.set(id, stream);

    let resolveReady!: (value: BeamStream) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<BeamStream>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    stream.readyResolve = resolveReady;
    stream.readyReject = rejectReady;

    const timer = setTimeout(() => {
      if (stream.readyReject !== rejectReady) return;
      this.streams.delete(id);
      stream.readyResolve = null;
      stream.readyReject = null;
      rejectReady(new Error(`stream '${name}' was never acknowledged`));
    }, OPEN_ACK_TIMEOUT_MS);
    timer.unref?.();

    this.sendFrame(FrameType.Open, id, encoder.encode(name));
    if (openPayload) this.sendFrame(FrameType.Data, id, openPayload);
    return ready;
  }

  /** Feed one inbound chunk of transport bytes. Malformed frames end the
   * connection's decode state but never throw into the caller. */
  receive(raw: Uint8Array): boolean {
    let frames: Frame[];
    try {
      frames = this.decoder.push(raw);
    } catch (error) {
      return !(error instanceof ProtocolError);
    }
    for (const frame of frames) this.handleFrame(frame);
    return true;
  }

  /** Transport ended (close, error, or abrupt disconnect): reap every
   * stream so nothing is left running unobserved. */
  dispose(reason = 'connection closed'): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, stream] of [...this.streams]) {
      this.streams.delete(id);
      if (stream.readyReject) {
        const reject = stream.readyReject;
        stream.readyResolve = null;
        stream.readyReject = null;
        reject(new Error(reason));
      } else {
        stream.emitClose(reason);
      }
    }
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Open:
        this.handleOpen(frame);
        return;
      case FrameType.Data:
        this.handleData(frame);
        return;
      case FrameType.Close:
        this.handleClose(frame);
        return;
      case FrameType.Control:
        this.handleControl(frame);
        return;
    }
  }

  private handleOpen(frame: Frame): void {
    if (this.streams.has(frame.streamId)) {
      this.sendFrame(
        FrameType.Close,
        frame.streamId,
        encoder.encode('stream id already open')
      );
      return;
    }
    const name = decodeText(frame);
    const handler = this.registry.resolve(name);
    if (!handler) {
      this.sendFrame(
        FrameType.Close,
        frame.streamId,
        encoder.encode(`unsupported stream: ${name}`)
      );
      return;
    }
    const stream = new BeamStreamImpl(this.sink, frame.streamId, name);
    this.streams.set(frame.streamId, stream);
    handler(stream);
  }

  private handleData(frame: Frame): void {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    this.tracker.feed(frame.streamId, frame.seq);
    stream.emitData(frame.payload);
  }

  private handleClose(frame: Frame): void {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    this.streams.delete(frame.streamId);
    const reason = frame.payload.byteLength > 0 ? decodeText(frame) : undefined;
    if (stream.readyReject) {
      const reject = stream.readyReject;
      stream.readyResolve = null;
      stream.readyReject = null;
      reject(new Error(reason ?? 'stream was closed before it opened'));
      return;
    }
    stream.emitClose(reason);
  }

  private handleControl(frame: Frame): void {
    if (frame.payload.byteLength === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(decodeText(frame));
    } catch {
      return; // Malformed control messages are ignored, never fatal.
    }
    if (typeof message !== 'object' || message === null) return;
    const record = message as Record<string, unknown>;
    const streamId = record['streamId'];
    if (typeof streamId !== 'number') return;
    const stream = this.streams.get(streamId);
    if (!stream) return;
    if (record['kind'] === 'opened' && stream.readyResolve) {
      const resolve = stream.readyResolve;
      stream.readyResolve = null;
      stream.readyReject = null;
      resolve(stream);
      return;
    }
    stream.emitControl(record);
  }

  private sendFrame(
    type: Frame['type'],
    streamId: number,
    payload: Uint8Array
  ): void {
    this.sendBytes(
      encodeFrame({ type, streamId, seq: this.sender.claim(streamId), payload })
    );
  }
}
