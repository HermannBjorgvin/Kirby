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
 * their Muxer the same way. */
export function wrapWebSocket(socket: WebSocket): TransportSocket {
  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code ?? 1000),
    onData: (handler) => {
      socket.on('message', (data, isBinary) => {
        if (!isBinary) return;
        handler(new Uint8Array(data as Buffer));
      });
    },
    onClose: (handler) => {
      socket.on('close', () => handler());
      // A late error after `open` should still end the connection rather
      // than leaving callers waiting on data that will never arrive.
      socket.on('error', () => handler());
    },
  };
}
