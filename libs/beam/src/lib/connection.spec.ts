import { describe, expect, it } from 'vitest';
import { createConnection } from './connection.js';
import { StreamRegistry } from './stream-registry.js';
import type { TransportSocket } from './transport.js';

/** In-memory TransportSocket pair, connected directly. */
function wireSockets(): [TransportSocket, TransportSocket] {
  const aHandlers: ((data: Uint8Array) => void)[] = [];
  const bHandlers: ((data: Uint8Array) => void)[] = [];
  const aCloseHandlers: (() => void)[] = [];
  const bCloseHandlers: (() => void)[] = [];
  const a: TransportSocket = {
    send: (data) => bHandlers.forEach((h) => h(data)),
    close: () => aCloseHandlers.forEach((h) => h()),
    onData: (h) => aHandlers.push(h),
    onClose: (h) => aCloseHandlers.push(h),
  };
  const b: TransportSocket = {
    send: (data) => aHandlers.forEach((h) => h(data)),
    close: () => bCloseHandlers.forEach((h) => h()),
    onData: (h) => bHandlers.push(h),
    onClose: (h) => bCloseHandlers.push(h),
  };
  return [a, b];
}

describe('createConnection', () => {
  it('carries the given peerId', () => {
    const [socket] = wireSockets();
    const conn = createConnection({
      peerId: 'peer-x',
      role: 'initiator',
      socket,
      registry: new StreamRegistry(),
    });
    expect(conn.peerId).toBe('peer-x');
  });

  it('onStream registers into the shared registry so the peer can open that stream', async () => {
    const [a, b] = wireSockets();
    const registryA = new StreamRegistry();
    const registryB = new StreamRegistry();
    const connA = createConnection({
      peerId: 'b',
      role: 'initiator',
      socket: a,
      registry: registryA,
    });
    createConnection({
      peerId: 'a',
      role: 'acceptor',
      socket: b,
      registry: registryB,
    });

    let received: Uint8Array | undefined;
    registryB.register('greet', (stream) => {
      stream.control({ kind: 'opened' });
      stream.onData((data) => {
        received = data;
      });
    });

    const stream = await connA.openStream('greet');
    stream.write(new TextEncoder().encode('hi'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received && new TextDecoder().decode(received)).toBe('hi');
  });

  it('close() notifies onClose exactly once', () => {
    const [a] = wireSockets();
    const conn = createConnection({
      peerId: 'p',
      role: 'initiator',
      socket: a,
      registry: new StreamRegistry(),
    });
    let calls = 0;
    conn.onClose(() => {
      calls += 1;
    });
    conn.close();
    conn.close();
    expect(calls).toBe(1);
  });

  it('a transport-level close notifies onClose without an explicit close() call', () => {
    const [a] = wireSockets();
    const conn = createConnection({
      peerId: 'p',
      role: 'initiator',
      socket: a,
      registry: new StreamRegistry(),
    });
    let closed = false;
    conn.onClose(() => {
      closed = true;
    });
    a.close();
    expect(closed).toBe(true);
  });
});
