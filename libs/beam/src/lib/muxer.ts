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
import {
  BeamStreamImpl,
  type BeamStream,
  type StreamContext,
  type StreamSink,
} from './stream.js';
import type { StreamRegistry } from './stream-registry.js';

const encoder = new TextEncoder();

/** How long a locally-opened stream waits for the peer's ack before the
 * promise from `openStream` rejects. */
const OPEN_ACK_TIMEOUT_MS = 10_000;

/** Used when a caller (tests, mostly) builds a Muxer without a peer
 * context — production call sites (connection.ts) always supply one. */
const UNKNOWN_PEER: StreamContext = { peerId: 'unknown', label: 'unknown' };

export type MuxerRole = 'initiator' | 'acceptor';

export interface MuxerOptions {
  /** 'initiator' (the side that dialed) allocates odd stream ids, 'acceptor'
   * even ones, so the two directions can never collide when either side may
   * open a stream. */
  role: MuxerRole;
  sendBytes: (bytes: Uint8Array) => void;
  /** Who is on the other end of this connection; stamped onto every stream
   * this Muxer creates (D1/A1/A4). */
  peer?: StreamContext;
}

/** Decode an Open frame's payload per D1: a `{`-prefixed payload is a JSON
 * object whose `name` is the stream name and whose other fields are its open
 * parameters, in one frame; anything else (including malformed JSON, or JSON
 * without a string `name`) is the bare stream name, unparsed — the host-poc
 * form, which stays valid. */
function parseOpenPayload(text: string): {
  name: string;
  params?: Record<string, unknown>;
} {
  if (!text.startsWith('{')) return { name: text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { name: text };
  }
  if (typeof parsed !== 'object' || parsed === null) return { name: text };
  const { name, ...params } = parsed as Record<string, unknown>;
  if (typeof name !== 'string') return { name: text };
  return { name, params };
}

export class Muxer {
  private readonly decoder = new FrameDecoder();
  private readonly sender = new SeqSender();
  private readonly tracker = new SeqTracker();
  private readonly streams = new Map<number, BeamStreamImpl>();
  private readonly sink: StreamSink;
  private readonly registry: StreamRegistry;
  private readonly sendBytes: (bytes: Uint8Array) => void;
  private readonly peer: StreamContext;
  private nextStreamId: number;
  private disposed = false;

  constructor(registry: StreamRegistry, options: MuxerOptions) {
    this.registry = registry;
    this.sendBytes = options.sendBytes;
    this.peer = options.peer ?? UNKNOWN_PEER;
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
   *
   * `params`, if given, travels in the same frame as the name (D1): there is
   * no longer a follow-up Data frame, which is what used to let an open
   * payload be typed into whatever `stream.onData` was already wired to.
   */
  openStream(
    name: string,
    params?: Record<string, unknown>
  ): Promise<BeamStream> {
    if (this.disposed) return Promise.reject(new Error('connection is closed'));
    const id = this.nextStreamId;
    this.nextStreamId += 2;
    const stream = new BeamStreamImpl(this.sink, id, name, this.peer, params);
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
      stream.readyTimer = null;
      rejectReady(new Error(`stream '${name}' was never acknowledged`));
    }, OPEN_ACK_TIMEOUT_MS);
    timer.unref?.();
    stream.readyTimer = timer;

    const payload = params
      ? encoder.encode(JSON.stringify({ name, ...params }))
      : encoder.encode(name);
    this.sendFrame(FrameType.Open, id, payload);
    return ready;
  }

  /** Feed one inbound chunk of transport bytes. Malformed frames end the
   * connection's decode state but never throw into the caller, and neither
   * does a stream handler: a throw out of `handleFrame` fails only the
   * stream it belongs to. */
  receive(raw: Uint8Array): boolean {
    let frames: Frame[];
    try {
      frames = this.decoder.push(raw);
    } catch (error) {
      return !(error instanceof ProtocolError);
    }
    for (const frame of frames) {
      try {
        this.handleFrame(frame);
      } catch (error) {
        this.failStream(frame, error);
      }
    }
    return true;
  }

  /** Call when the transport itself has ended, before `dispose`: surfaces a
   * `truncated` ProtocolError if bytes were left mid-frame, so a connection
   * that died mid-frame is distinguishable from one that just went quiet. */
  finishTransport(): void {
    this.decoder.finish();
  }

  /** Transport ended (close, error, or abrupt disconnect): reap every
   * stream so nothing is left running unobserved. */
  dispose(reason = 'connection closed'): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, stream] of [...this.streams]) {
      this.streams.delete(id);
      this.clearReadyTimer(stream);
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

  /**
   * A handler that throws fails only its own stream; the connection and
   * every other stream on it survive. `handleOpen` calls a registered
   * handler synchronously and `handleData`/`handleControl` run user
   * callbacks synchronously, so any of them can throw back into `receive`,
   * and an uncaught throw there is a kill switch any paired peer controls
   * the timing of. The guard lives here rather than in each handler so it
   * covers stream types added later without anyone remembering to add it.
   */
  private failStream(frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const reason = `stream handler failed: ${message.split('\n')[0]}`;
    const streamId = this.streamIdFor(frame);
    const stream = this.streams.get(streamId);
    this.streams.delete(streamId);
    try {
      this.sendFrame(FrameType.Close, streamId, encoder.encode(reason));
    } catch {
      // The transport is already gone; the local teardown below still runs.
    }
    if (!stream) return;
    this.clearReadyTimer(stream);
    const reject = stream.readyReject;
    stream.readyResolve = null;
    stream.readyReject = null;
    try {
      if (reject) reject(new Error(reason));
      else stream.emitClose(reason);
    } catch {
      // A close handler that throws as well has nothing left to fail.
    }
  }

  /** Which stream a frame belongs to. A Control frame rides the
   * connection's own id 0 and names its stream inside the payload, so that
   * is where the id has to come from; the re-parse only ever happens on
   * this failure path. */
  private streamIdFor(frame: Frame): number {
    if (frame.type !== FrameType.Control) return frame.streamId;
    try {
      const parsed: unknown = JSON.parse(decodeText(frame));
      if (typeof parsed === 'object' && parsed !== null) {
        const id = (parsed as Record<string, unknown>)['streamId'];
        if (typeof id === 'number') return id;
      }
    } catch {
      // An unparseable control frame never reaches a handler in the first
      // place, so it cannot be the one that threw.
    }
    return frame.streamId;
  }

  private clearReadyTimer(stream: BeamStreamImpl): void {
    if (!stream.readyTimer) return;
    clearTimeout(stream.readyTimer);
    stream.readyTimer = null;
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
    // `seq` counts every frame on this stream, not just Data (SeqSender
    // claims it uniformly for Open/Data/Close) — the tracker must see the
    // Open frame's seq too, or it will expect the first Data frame to start
    // back at 0 and flag it as a gap.
    this.tracker.feed(frame.streamId, frame.seq);
    const { name, params } = parseOpenPayload(decodeText(frame));
    const handler = this.registry.resolve(name);
    if (!handler) {
      this.sendFrame(
        FrameType.Close,
        frame.streamId,
        encoder.encode(`unsupported stream: ${name}`)
      );
      return;
    }
    const stream = new BeamStreamImpl(
      this.sink,
      frame.streamId,
      name,
      this.peer,
      params
    );
    this.streams.set(frame.streamId, stream);
    handler(stream);
  }

  private handleData(frame: Frame): void {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    const verdict = this.tracker.feed(frame.streamId, frame.seq);
    if (verdict === 'duplicate') return; // Already delivered; drop silently.
    if (verdict === 'gap' || verdict === 'reorder') {
      // We cannot know what was lost or how to reassemble it; delivering
      // this frame as if it were the next one would corrupt whatever the
      // stream carries. Fail the stream rather than deliver bad data.
      this.streams.delete(frame.streamId);
      stream.emitClose(`frame sequence error: ${verdict}`);
      return;
    }
    stream.emitData(frame.payload);
  }

  private handleClose(frame: Frame): void {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    this.streams.delete(frame.streamId);
    this.clearReadyTimer(stream);
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
      this.clearReadyTimer(stream);
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
