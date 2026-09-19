import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionRegistry } from '../connection-registry.js';
import { createConnection, type PeerConnection } from '../connection.js';
import { loadOrCreateIdentity, type Identity } from '../identity.js';
import { PeerTable } from '../peer-table.js';
import { StreamRegistry } from '../stream-registry.js';
import type { TransportSocket } from '../transport.js';
import { InboundStore } from './inbound-store.js';
import { OutboundQueue, type QuarantinedFile } from './outbound-queue.js';
import { Mailbox, type SendOutcome } from './mailbox.js';
import type { Envelope } from './envelope.js';

interface TestNode {
  dir: string;
  identity: Identity;
  peers: PeerTable;
  registry: StreamRegistry;
  connections: ConnectionRegistry;
  mailbox: Mailbox;
  received: Envelope[];
}

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Everything a node needs *except* an inbound subscriber — split out so a
 * test that wants to control subscription itself (D15's durability tests,
 * which need to observe what happens *before* anything acks) is not forced
 * to also carry `makeNode`'s own auto-acking `onMessage` handler, which
 * would otherwise race it for every inbound envelope. */
function makeRawNode(
  hostname: string,
  overrides: Partial<{
    ackTimeoutMs: number;
    retryIntervalMs: number;
    sendAwaitMs: number;
    onQuarantine: (info: QuarantinedFile) => void;
  }> = {}
): Omit<TestNode, 'received'> {
  const dir = tmp(`beam-mbx-${hostname}-`);
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
    ackTimeoutMs: overrides.ackTimeoutMs ?? 200,
    retryIntervalMs: overrides.retryIntervalMs ?? 30,
    sendAwaitMs: overrides.sendAwaitMs ?? 400,
    onQuarantine: overrides.onQuarantine,
  });
  return { dir, identity, peers, registry, connections, mailbox };
}

function makeNode(
  hostname: string,
  overrides: Partial<{
    ackTimeoutMs: number;
    retryIntervalMs: number;
    sendAwaitMs: number;
    onQuarantine: (info: QuarantinedFile) => void;
  }> = {}
): TestNode {
  const raw = makeRawNode(hostname, overrides);
  const received: Envelope[] = [];
  raw.mailbox.onMessage((envelope) => received.push(envelope));
  return { ...raw, received };
}

/** Re-open a node against the same on-disk beamDir with fresh in-memory
 * state (registry, connections) — this is a real "restart", not a mock: the
 * new Mailbox reads whatever the old one left on disk. */
function reopenNode(
  node: TestNode,
  overrides: Partial<{
    ackTimeoutMs: number;
    retryIntervalMs: number;
    sendAwaitMs: number;
  }> = {}
): TestNode {
  const identity = loadOrCreateIdentity(node.dir, { hostname: () => 'unused' });
  const peers = new PeerTable(node.dir);
  const registry = new StreamRegistry();
  const connections = new ConnectionRegistry();
  const received: Envelope[] = [];
  const mailbox = new Mailbox({
    identity,
    peers,
    connections,
    registry,
    beamDir: node.dir,
    ackTimeoutMs: overrides.ackTimeoutMs ?? 200,
    retryIntervalMs: overrides.retryIntervalMs ?? 30,
    sendAwaitMs: overrides.sendAwaitMs ?? 400,
  });
  mailbox.onMessage((envelope) => received.push(envelope));
  return {
    dir: node.dir,
    identity,
    peers,
    registry,
    connections,
    mailbox,
    received,
  };
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

/** An in-memory TransportSocket pair, connected directly — no real network,
 * so tests control exactly when a connection exists. */
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

/** Connect two nodes with `dialer` playing the initiator role — proving
 * direction-independence means running the same scenario with the roles
 * swapped and seeing the same outcome. */
function connectNodes(
  dialer: TestNode,
  acceptor: TestNode
): { dialerConn: PeerConnection; acceptorConn: PeerConnection } {
  const [a, b] = wireSockets();
  const dialerConn = createConnection({
    peerId: acceptor.identity.peerId,
    label: 'acceptor',
    role: 'initiator',
    socket: a,
    registry: dialer.registry,
  });
  const acceptorConn = createConnection({
    peerId: dialer.identity.peerId,
    label: 'dialer',
    role: 'acceptor',
    socket: b,
    registry: acceptor.registry,
  });
  dialer.connections.add(dialerConn);
  acceptor.connections.add(acceptorConn);
  return { dialerConn, acceptorConn };
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 3000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Mailbox: connected delivery', () => {
  it('a message to a connected peer is delivered and acknowledged, queue empty after', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);

    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'hi',
    });
    expect(outcome.outcome).toBe('delivered');
    expect(a.mailbox.queue(b.identity.peerId)).toHaveLength(0);
    expect(b.received.map((e) => e.payload)).toEqual(['hi']);
  });

  it('delivery is direction-independent: works whether the sender or the recipient dialed', async () => {
    for (const dialerIsSender of [true, false]) {
      const a = makeNode('sender');
      const b = makeNode('recipient');
      pairNodes(a, b);
      if (dialerIsSender) connectNodes(a, b);
      else connectNodes(b, a);

      const outcome = await a.mailbox.send({
        to: b.identity.peerId,
        topic: 't',
        payload: 'x',
      });
      expect(outcome.outcome).toBe('delivered');
      expect(b.received.map((e) => e.payload)).toEqual(['x']);
    }
  });
});

describe('Mailbox: offline queueing and drain', () => {
  it('a message to a peer with no connection returns queued, and the file is on disk', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);

    const outcome: SendOutcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'later',
    });
    expect(outcome).toMatchObject({ outcome: 'queued', to: b.identity.peerId });
    expect(a.mailbox.queue(b.identity.peerId)).toHaveLength(1);

    const onDisk = new OutboundQueue(a.dir).list(b.identity.peerId);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]?.envelope.payload).toBe('later');
  });

  it('when the peer connects, the queue drains in order and empties', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);

    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: '1' });
    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: '2' });
    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: '3' });
    expect(a.mailbox.queue(b.identity.peerId)).toHaveLength(3);

    connectNodes(a, b);
    await waitFor(
      () => a.mailbox.queue(b.identity.peerId).length,
      (n) => n === 0
    );
    expect(b.received.map((e) => e.payload)).toEqual(['1', '2', '3']);
  });
});

describe('Mailbox: rejection', () => {
  it('an unknown peer is rejected and stores nothing, echoing the requested name in `to`', async () => {
    const a = makeNode('a');
    const outcome = await a.mailbox.send({
      to: 'not-a-real-peer',
      topic: 't',
      payload: 'x',
    });
    expect(outcome).toEqual({
      outcome: 'rejected',
      reason: 'unknown-peer',
      to: 'not-a-real-peer',
    });
  });

  it('a revoked peer is rejected and stores nothing, with `to`/`label` resolved', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    a.peers.revoke(b.identity.peerId);
    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'x',
    });
    expect(outcome).toEqual({
      outcome: 'rejected',
      reason: 'revoked-peer',
      to: b.identity.peerId,
      label: 'b',
    });
    expect(a.mailbox.queue(b.identity.peerId)).toHaveLength(0);
  });

  it('an oversized payload is rejected and stores nothing, with `to`/`label` resolved', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const huge = 'x'.repeat(257 * 1024);
    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: huge,
    });
    expect(outcome).toEqual({
      outcome: 'rejected',
      reason: 'oversized-payload',
      to: b.identity.peerId,
      label: 'b',
    });
    expect(a.mailbox.queue(b.identity.peerId)).toHaveLength(0);
  });

  it('a queue write that fails is a rejected outcome, and burns no seq', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    // A read-only queue directory stands in for the disk-full / permission
    // class of failure: `enqueue` throws, and that throw must become an
    // outcome rather than a rejected promise nobody is listening for.
    const queueDir = join(a.dir, 'mailbox', 'out', b.identity.peerId);
    mkdirSync(queueDir, { recursive: true, mode: 0o700 });
    chmodSync(queueDir, 0o500);
    try {
      const outcome = await a.mailbox.send({
        to: b.identity.peerId,
        topic: 't',
        payload: 'nowhere to put this',
      });
      expect(outcome).toEqual({
        outcome: 'rejected',
        reason: 'storage-failure',
        to: b.identity.peerId,
        label: 'b',
      });
    } finally {
      chmodSync(queueDir, 0o700);
    }
    // The seq was never claimed: the next message that does store gets 1,
    // rather than leaving a hole the receiver would have to step over.
    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: 'ok' });
    expect(
      a.mailbox.queue(b.identity.peerId).map((q) => q.envelope.seq)
    ).toEqual([1]);
  });
});

describe('Mailbox: crash windows', () => {
  it('ordering holds across a restart: queue three, restart, connect, receiver sees 1, 2, 3', async () => {
    let a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);

    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: '1' });
    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: '2' });
    await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload: '3' });

    a.mailbox.dispose();
    a = reopenNode(a); // Simulated restart: same beamDir, fresh in-memory state.

    connectNodes(a, b);
    await waitFor(
      () => b.received.length,
      (n) => n === 3
    );
    expect(b.received.map((e) => e.payload)).toEqual(['1', '2', '3']);
  });

  it('a duplicate caused by a crash between delivery and ack is dropped by the receiver, delivered exactly once', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);

    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'once',
    });
    expect(outcome.outcome).toBe('delivered');
    expect(b.received.map((e) => e.payload)).toEqual(['once']);

    // Simulate the sender crashing after seeing the ack but before it
    // unlinked the file (or, equivalently, after writing but before the
    // ack — either way the file survives and gets resent): put the exact
    // same envelope back into A's queue directly, then restart A so its
    // fresh Mailbox picks it up and resends it on reconnect.
    const outbound = new OutboundQueue(a.dir);
    expect(outbound.list(b.identity.peerId)).toHaveLength(0); // clean delivery unlinked it
    const resent: Envelope = {
      id: 'resend-of-already-delivered',
      from: a.identity.peerId,
      to: b.identity.peerId,
      seq: 1, // The same seq B already accepted.
      topic: 't',
      payload: 'once',
      encoding: 'utf8',
      createdAt: Date.now(),
    };
    outbound.enqueue(b.identity.peerId, resent);

    const restarted = reopenNode(a);
    connectNodes(restarted, b);
    await waitFor(
      () => restarted.mailbox.queue(b.identity.peerId).length,
      (n) => n === 0
    );

    // B's application-visible message count must not grow: the resend was
    // acked (so the sender could clean up) but not delivered again.
    expect(b.received.map((e) => e.payload)).toEqual(['once']);
  });

  it('a malformed queue file is quarantined, the loss is surfaced, and messages after it still flow (D1)', async () => {
    const quarantined: QuarantinedFile[] = [];
    const a = makeNode('a', { onQuarantine: (info) => quarantined.push(info) });
    const b = makeNode('b');
    pairNodes(a, b);

    // Queue a real message first so it gets a real seq, then corrupt a
    // *later* seq's file directly on disk — simulating a torn write that
    // atomic rename is supposed to prevent, but which a filesystem bug or a
    // bit flip could still produce.
    await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'good-1',
    });
    const dir = join(a.dir, 'mailbox', 'out', b.identity.peerId);
    writeFileSync(join(dir, '0000000002.json'), '{not valid json');
    const outbound = new OutboundQueue(a.dir);
    outbound.enqueue(b.identity.peerId, {
      id: 'good-3',
      from: a.identity.peerId,
      to: b.identity.peerId,
      seq: 3,
      topic: 't',
      payload: 'good-3',
      encoding: 'utf8',
      createdAt: Date.now(),
    });

    connectNodes(a, b);
    await waitFor(
      () => b.received.length,
      (n) => n >= 2,
      3000
    );
    // Without a contiguity requirement (D1), the receiver accepts seq 3
    // right after seq 1 — there is no hole for anything to wedge behind.
    expect(b.received.map((e) => e.payload)).toEqual(['good-1', 'good-3']);

    // The loss must be surfaced, never silent: discoverable through the
    // queue API by peer and by the exact seq it can never deliver again,
    // and handed to whoever asked to be told.
    const listed = a.mailbox.quarantined(b.identity.peerId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fileName).toBe('0000000002.json');
    expect(listed[0]?.reason.length).toBeGreaterThan(0);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.fileName).toBe('0000000002.json');
  });

  it('quarantine is durable and discoverable across a restart, even with no live onQuarantine listener', async () => {
    let a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const dir = join(a.dir, 'mailbox', 'out', b.identity.peerId);
    const outbound = new OutboundQueue(a.dir);
    outbound.enqueue(b.identity.peerId, {
      id: 'lost',
      from: a.identity.peerId,
      to: b.identity.peerId,
      seq: 1,
      topic: 't',
      payload: 'lost',
      encoding: 'utf8',
      createdAt: Date.now(),
    });
    writeFileSync(join(dir, '0000000001.json'), 'not json at all {{{');

    a.mailbox.dispose();
    a = reopenNode(a); // A fresh process, with nobody watching onQuarantine.
    // Reading the queue at all is what discovers and quarantines the file —
    // status()/queue() both do this, so a mere restart-and-inspect finds it.
    a.mailbox.queue(b.identity.peerId);

    const listed = a.mailbox.quarantined();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.peerId).toBe(b.identity.peerId);
    expect(listed[0]?.fileName).toBe('0000000001.json');
  });

  it('a lost seq.json reconciles against the still-queued backlog, so a real message is never silently swallowed and falsely reported delivered (D2)', async () => {
    let a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const { dialerConn } = connectNodes(a, b);

    const first = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'one',
    });
    expect(first.outcome).toBe('delivered'); // b's SeenTracker lastSeq is now 1.

    // Disconnect before sending 'two', so it stays queued on disk as seq 2
    // — the realistic shape of the bug: seq.json is lost while real backlog
    // still exists, not while the queue happens to be empty.
    dialerConn.close();
    const second = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'two',
    });
    expect(second.outcome).toBe('queued');
    expect(
      new OutboundQueue(a.dir)
        .list(b.identity.peerId)
        .map((q) => q.envelope.seq)
    ).toEqual([2]);

    a.mailbox.dispose();
    rmSync(join(a.dir, 'mailbox', 'seq.json'), { force: true }); // Lost outright.
    a = reopenNode(a);

    const third = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'three',
    });
    expect(third.outcome).toBe('queued'); // Still no connection.
    // Reconciliation against the on-disk backlog (seq 2 still queued) must
    // assign 'three' seq 3, never a reset seq 1 that would collide with
    // what b already acked for 'one'.
    expect(
      new OutboundQueue(a.dir)
        .list(b.identity.peerId)
        .map((q) => q.envelope.seq)
    ).toEqual([2, 3]);

    connectNodes(a, b);
    await waitFor(
      () => b.received.length,
      (n) => n === 3
    );
    expect(b.received.map((e) => e.payload)).toEqual(['one', 'two', 'three']);
  });
});

describe('Mailbox: inbound durability (D15)', () => {
  it('persists an accepted envelope to disk before any subscriber acknowledges it', async () => {
    const a = makeNode('a');
    // A raw node for b: no auto-acking `onMessage` handler racing the
    // never-acking subscriber this test installs below.
    const b = makeRawNode('b');
    pairNodes(a, { ...b, received: [] });
    connectNodes(a, { ...b, received: [] });

    // A low-level subscriber that never acknowledges — proving persistence
    // does not depend on a subscriber taking the message at all, let alone
    // finishing first.
    let sawOnDisk: string[] | undefined;
    b.mailbox.subscribeInbound(() => {
      sawOnDisk = new InboundStore(b.dir)
        .list(a.identity.peerId)
        .map((e) => e.payload);
    });

    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'durable',
    });
    // The *wire* ack already happened — a's send() sees `delivered` — even
    // though nothing has taken the message on b's side yet.
    expect(outcome.outcome).toBe('delivered');
    expect(sawOnDisk).toEqual(['durable']);
  });

  it('killed before any subscriber acks, restarted, a fresh subscriber sees the envelope exactly once', async () => {
    const a = makeNode('a');
    const b = makeRawNode('b');
    pairNodes(a, { ...b, received: [] });
    connectNodes(a, { ...b, received: [] });

    // b's only subscriber never acknowledges — simulating the receiving
    // node being killed before an application (e.g. `msg listen`) ever
    // attached to take the message.
    b.mailbox.subscribeInbound(() => undefined);

    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'kill-before-ack',
    });
    expect(outcome.outcome).toBe('delivered');

    // "Kill" b: dispose without ever acking, then reopen against the same
    // beamDir — a real restart, not a mock. `reopenNode` wires its own
    // auto-acking `onMessage` handler (like a real `msg listen` would),
    // which is what this test observes — the redelivery this whole
    // property is about.
    b.mailbox.dispose();
    const reopened = reopenNode({ ...b, received: [] });

    expect(reopened.received.map((e) => e.payload)).toEqual([
      'kill-before-ack',
    ]);
    expect(reopened.received).toHaveLength(1); // exactly once, not lost, not duplicated
  });
});

describe('Mailbox: revocation stops queued mail (D5)', () => {
  it('a peer revoked after a message is already queued never receives it, even once a connection exists', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);

    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'should-not-arrive',
    });
    expect(outcome.outcome).toBe('queued');

    // Revoked through the peer table directly — not through a path that
    // also happens to close connections — so this exercises the flusher's
    // own check, not just "there is no connection to revoke".
    a.peers.revoke(b.identity.peerId);
    connectNodes(a, b);

    // Give the flusher every chance it would need to (wrongly) drain.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(b.received).toHaveLength(0);
    expect(a.mailbox.queue(b.identity.peerId)).toHaveLength(1);
  });
});

describe('Mailbox: concurrency and reporting', () => {
  it('queue depth reported by send() matches what is on disk', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const outcome = await a.mailbox.send({
      to: b.identity.peerId,
      topic: 't',
      payload: 'x',
    });
    expect(outcome.outcome).toBe('queued'); // not connected, so a stable depth to compare
    expect((outcome as { queueDepth: number }).queueDepth).toBe(
      new OutboundQueue(a.dir).depth(b.identity.peerId)
    );
  });

  it('two concurrent senders to the same peer produce distinct, gapless sequence numbers and lose nothing', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        a.mailbox.send({
          to: b.identity.peerId,
          topic: 't',
          payload: `msg-${i}`,
        })
      )
    );
    for (const r of results) expect(r.outcome).not.toBe('rejected');

    const seqs = new OutboundQueue(a.dir)
      .list(b.identity.peerId)
      .map((q) => q.envelope.seq)
      .sort((x, y) => x - y);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    connectNodes(a, b);
    await waitFor(
      () => b.received.length,
      (n) => n === 10
    );
    expect(b.received.map((e) => e.payload).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `msg-${i}`).sort()
    );
  });
});

describe('Mailbox: node-start flush trigger', () => {
  it('constructing a Mailbox drains an already-queued message when a connection already exists', async () => {
    // Build everything *except* a's Mailbox first, so the queued file and
    // the live connection both predate the Mailbox that must notice them —
    // proving node start (the constructor) is itself a flush trigger, not
    // just onConnect.
    const dir = tmp('beam-mbx-node-start-');
    const identity = loadOrCreateIdentity(dir, { hostname: () => 'a-start' });
    const peers = new PeerTable(dir);
    const registry = new StreamRegistry();
    const connections = new ConnectionRegistry();
    const b = makeNode('b');
    peers.upsert({
      peerId: b.identity.peerId,
      label: 'b',
      publicKeyPem: b.identity.publicKeyPem,
      endpoints: [],
    });
    b.peers.upsert({
      peerId: identity.peerId,
      label: 'a',
      publicKeyPem: identity.publicKeyPem,
      endpoints: [],
    });

    new OutboundQueue(dir).enqueue(b.identity.peerId, {
      id: 'pre-existing',
      from: identity.peerId,
      to: b.identity.peerId,
      seq: 1,
      topic: 't',
      payload: 'pre-existing',
      encoding: 'utf8',
      createdAt: Date.now(),
    });

    const [aSocket, bSocket] = wireSockets();
    const aConn = createConnection({
      peerId: b.identity.peerId,
      label: 'b',
      role: 'initiator',
      socket: aSocket,
      registry,
    });
    const bConn = createConnection({
      peerId: identity.peerId,
      label: 'a',
      role: 'acceptor',
      socket: bSocket,
      registry: b.registry,
    });
    connections.add(aConn);
    b.connections.add(bConn);

    // The connection and the on-disk file both predate this call.
    new Mailbox({
      identity,
      peers,
      connections,
      registry,
      beamDir: dir,
      retryIntervalMs: 30,
    });

    await waitFor(
      () => b.received.length,
      (n) => n === 1
    );
    expect(b.received[0]?.payload).toBe('pre-existing');
  });
});
