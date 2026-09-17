import { createConnection, createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionRegistry } from './connection-registry.js';
import { createConnection as createBeamConnection } from './connection.js';
import { loadOrCreateIdentity, type Identity } from './identity.js';
import { IpcSocket } from './ipc-socket.js';
import { Mailbox } from './mailbox/mailbox.js';
import { PeerTable } from './peer-table.js';
import { StreamRegistry } from './stream-registry.js';
import type { TransportSocket } from './transport.js';

let dirs: string[] = [];
let sockets: IpcSocket[] = [];

beforeEach(() => {
  dirs = [];
  sockets = [];
});

afterEach(async () => {
  for (const s of sockets) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface TestNode {
  dir: string;
  identity: Identity;
  peers: PeerTable;
  registry: StreamRegistry;
  connections: ConnectionRegistry;
  mailbox: Mailbox;
}

function makeNode(hostname: string): TestNode {
  const dir = tmp(`beam-ipc-${hostname}-`);
  const identity = loadOrCreateIdentity(dir, { hostname: () => hostname });
  const peers = new PeerTable(dir);
  const registry = new StreamRegistry();
  const connections = new ConnectionRegistry();
  const mailbox = new Mailbox({
    identity,
    peers,
    connections,
    registry,
    beamDir: dir,
    ackTimeoutMs: 200,
    retryIntervalMs: 30,
    sendAwaitMs: 300,
  });
  return { dir, identity, peers, registry, connections, mailbox };
}

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

function connectNodes(dialer: TestNode, acceptor: TestNode): void {
  const [a, b] = wireSockets();
  dialer.connections.add(
    createBeamConnection({
      peerId: acceptor.identity.peerId,
      label: 'acceptor',
      role: 'initiator',
      socket: a,
      registry: dialer.registry,
    })
  );
  acceptor.connections.add(
    createBeamConnection({
      peerId: dialer.identity.peerId,
      label: 'dialer',
      role: 'acceptor',
      socket: b,
      registry: acceptor.registry,
    })
  );
}

function pairNodes(a: TestNode, b: TestNode): void {
  a.peers.upsert({
    peerId: b.identity.peerId,
    label: 'b',
    publicKeyPem: b.identity.publicKeyPem,
    endpoints: [],
  });
  b.peers.upsert({
    peerId: a.identity.peerId,
    label: 'a',
    publicKeyPem: a.identity.publicKeyPem,
    endpoints: [],
  });
}

async function startIpc(
  node: TestNode
): Promise<{ socket: IpcSocket; path: string }> {
  const path = join(node.dir, 'run', 'inbox.sock');
  const socket = new IpcSocket({ path, mailbox: node.mailbox });
  await socket.listen();
  sockets.push(socket);
  return { socket, path };
}

/** A raw client for the line-delimited JSON protocol. */
function connectClient(path: string): {
  conn: Socket;
  send: (message: Record<string, unknown>) => void;
  nextLine: () => Promise<Record<string, unknown>>;
} {
  const conn = createConnection(path);
  const lines: Record<string, unknown>[] = [];
  const waiters: ((line: Record<string, unknown>) => void)[] = [];
  let buffer = '';
  conn.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else lines.push(parsed);
    }
  });
  return {
    conn,
    send: (message) => conn.write(`${JSON.stringify(message)}\n`),
    nextLine: () =>
      new Promise((resolve) => {
        const already = lines.shift();
        if (already) {
          resolve(already);
          return;
        }
        waiters.push(resolve);
      }),
  };
}

async function waitForOpen(conn: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    conn.once('connect', resolve);
    conn.once('error', reject);
  });
}

describe('IpcSocket', () => {
  it('send over the socket produces the same outcome shape as the library call', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const { path } = await startIpc(a);

    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({
      op: 'send',
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'hi',
    });
    const response = await client.nextLine();

    expect(response['status']).toBe('queued'); // no connection to b
    expect(response['to']).toBe(b.identity.peerId);
    expect(response['label']).toBe('b');
    expect(typeof response['queueDepth']).toBe('number');
    client.conn.destroy();
  });

  it('subscribe receives an envelope and acknowledges it', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({ op: 'subscribe', topic: 'orchestra' });

    await a.mailbox.send({
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'over-ipc',
    });
    const envelope = await client.nextLine();
    expect(envelope['payload']).toBe('over-ipc');
    client.send({ op: 'ack', id: envelope['id'] });
    client.conn.destroy();
  });

  it('a consumer that drops mid-message leaves the envelope unacknowledged, redelivered to the next consumer', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const first = connectClient(path);
    await waitForOpen(first.conn);
    first.send({ op: 'subscribe', topic: 'orchestra' });

    const second = connectClient(path);
    await waitForOpen(second.conn);
    second.send({ op: 'subscribe', topic: 'orchestra' });

    await a.mailbox.send({
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'redeliver-me',
    });
    const seenByFirst = await first.nextLine();
    expect(seenByFirst['payload']).toBe('redeliver-me');

    // The first consumer vanishes without acking.
    first.conn.destroy();

    const seenBySecond = await second.nextLine();
    expect(seenBySecond['payload']).toBe('redeliver-me');
    expect(seenBySecond['id']).toBe(seenByFirst['id']);
    second.send({ op: 'ack', id: seenBySecond['id'] });
    second.conn.destroy();
  });

  it('status over the socket reports peers', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const { path } = await startIpc(a);
    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({ op: 'status' });
    const response = await client.nextLine();
    const peers = response['peers'] as { peerId: string }[];
    expect(peers.some((p) => p.peerId === b.identity.peerId)).toBe(true);
    client.conn.destroy();
  });

  it('a stale socket file (nothing listening) is replaced', async () => {
    const dir = tmp('beam-ipc-stale-');
    const path = join(dir, 'run');
    const sockPath = join(path, 'inbox.sock');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path, { recursive: true });

    // Leave a socket file behind with nothing listening on it.
    const leaked = createServer();
    await new Promise<void>((resolve) => leaked.listen(sockPath, resolve));
    await new Promise<void>((resolve) => leaked.close(() => resolve()));

    const identity = loadOrCreateIdentity(dir, { hostname: () => 'stale' });
    const mailbox = new Mailbox({
      identity,
      peers: new PeerTable(dir),
      connections: new ConnectionRegistry(),
      registry: new StreamRegistry(),
      beamDir: dir,
    });
    const socket = new IpcSocket({ path: sockPath, mailbox });
    await expect(socket.listen()).resolves.toBeUndefined();
    sockets.push(socket);
  });

  it('a live socket is not replaced — a second listen on the same path fails', async () => {
    const a = makeNode('a');
    const { path } = await startIpc(a);
    const second = new IpcSocket({ path, mailbox: a.mailbox });
    await expect(second.listen()).rejects.toThrow(/already listening/);
  });
});
