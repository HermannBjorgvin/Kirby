/**
 * beam transport — the pluggable byte pipe a Muxer rides on. WebSocket ships
 * in Phase 1; a WebRTC data channel or a relay can implement the same three
 * methods later without touching anything above this layer.
 */

import WebSocket from 'ws';

export interface TransportSocket {
  send(data: Uint8Array): void;
  close(code?: number): void;
  onData(handler: (data: Uint8Array) => void): void;
  onClose(handler: () => void): void;
}

export interface Transport {
  /** Open a socket to `url`; resolves when the connection is live. */
  connect(url: string): Promise<TransportSocket>;
}

/** WebSocket transport over ws(s):// endpoints. */
export class WebSocketTransport implements Transport {
  connect(url: string): Promise<TransportSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'nodebuffer';

      const onOpen = () => {
        socket.off('error', onEarlyError);
        resolve(wrapWebSocket(socket));
      };
      const onEarlyError = (error: Error) => {
        socket.off('open', onOpen);
        reject(new Error(`socket to ${url} failed: ${error.message}`));
      };
      socket.once('open', onOpen);
      socket.once('error', onEarlyError);
    });
  }
}

/** Wrap an already-open `ws` socket (client or server side — the `ws`
 * package uses the same class for both) as a TransportSocket. Shared with
 * the host's WebSocket upgrade handler so both sides of a connection build
 * their Muxer the same way.
 *
 * The underlying `message` listener is attached immediately, before any
 * consumer calls `onData` — not lazily inside it. On the dialing side,
 * `dial()` does `await transport.connect(url)` before wiring a Muxer to the
 * result, which leaves a real gap between the WebSocket's `open` event and
 * `onData` actually being called; a peer that sends the instant a
 * connection completes (exactly what the mailbox flusher does when mail is
 * already queued) would otherwise have that first frame silently dropped,
 * since `EventEmitter` never queues an event for a listener that is not
 * yet attached. Frames that arrive before any `onData` handler is
 * registered are buffered and flushed to it in order once one is. */
export function wrapWebSocket(socket: WebSocket): TransportSocket {
  const dataHandlers: ((data: Uint8Array) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  const buffered: Uint8Array[] = [];

  socket.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const bytes = new Uint8Array(data as Buffer);
    if (dataHandlers.length === 0) {
      buffered.push(bytes);
      return;
    }
    for (const handler of dataHandlers) handler(bytes);
  });
  const notifyClose = (): void => {
    for (const handler of closeHandlers) handler();
  };
  socket.on('close', notifyClose);
  // A late error after `open` should still end the connection rather than
  // leaving callers waiting on data that will never arrive.
  socket.on('error', notifyClose);

  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code ?? 1000),
    onData: (handler) => {
      dataHandlers.push(handler);
      if (buffered.length === 0) return;
      for (const bytes of buffered.splice(0, buffered.length)) handler(bytes);
    },
    onClose: (handler) => closeHandlers.push(handler),
  };
}
