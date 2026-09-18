/**
 * The durable mailbox: one queue per peer, drained over whichever
 * connection to that peer is live, with strictly sequential delivery and
 * receiver-side dedup. See docs/beam.md's "Durable mailbox" section, which
 * this implements, and decisions.md D7/D9.
 */

import { randomUUID } from 'node:crypto';
import type { ConnectionRegistry } from '../connection-registry.js';
import type { Identity } from '../identity.js';
import type { PeerTable } from '../peer-table.js';
import type { StreamRegistry } from '../stream-registry.js';
import type { BeamStream } from '../stream.js';
import {
  isEnvelope,
  MAX_PAYLOAD_BYTES,
  payloadByteLength,
  type Envelope,
} from './envelope.js';
import { Flusher } from './flusher.js';
import { OutboundQueue, type QuarantinedFile } from './outbound-queue.js';
import { derivePeerState, type PeerState } from './peer-state.js';
import { MailboxCorruptionError, SeenTracker } from './seen-tracker.js';
import { SeqCounter } from './seq-counter.js';

export type RejectReason =
  | 'unknown-peer'
  | 'revoked-peer'
  | 'oversized-payload';

export type SendOutcome =
  | { outcome: 'delivered'; to: string; label: string; queueDepth: number }
  | {
      outcome: 'queued';
      to: string;
      label: string;
      queueDepth: number;
      reason: string;
    }
  | { outcome: 'rejected'; reason: RejectReason };

export interface SendInput {
  /** A peerId or label — the same lookup dial()/PeerTable.resolve use. */
  to: string;
  topic: string;
  payload: string;
  encoding?: 'utf8' | 'base64';
}

export interface PeerStatus {
  peerId: string;
  label: string;
  revoked: boolean;
  state: PeerState;
  queueDepth: number;
}

export interface QueuedForPeer {
  peerId: string;
  envelope: Envelope;
}

export interface MailboxOptions {
  identity: Identity;
  peers: PeerTable;
  connections: ConnectionRegistry;
  registry: StreamRegistry;
  beamDir: string;
  now?: () => number;
  /** How long `send()` waits for delivery before reporting `queued`
   * instead — the underlying flusher keeps retrying regardless. */
  sendAwaitMs?: number;
  ackTimeoutMs?: number;
  retryIntervalMs?: number;
  log?: (message: string) => void;
  onQuarantine?: (info: QuarantinedFile) => void;
  onCorruption?: (error: MailboxCorruptionError) => void;
}

const DEFAULT_SEND_AWAIT_MS = 5_000;

export class Mailbox {
  private readonly identity: Identity;
  private readonly peers: PeerTable;
  private readonly connections: ConnectionRegistry;
  private readonly queueStore: OutboundQueue;
  private readonly seqCounter: SeqCounter;
  private readonly seenTracker: SeenTracker;
  private readonly flusher: Flusher;
  private readonly now: () => number;
  private readonly sendAwaitMs: number;
  private readonly log: (message: string) => void;
  private readonly onCorruption?: (error: MailboxCorruptionError) => void;
  private readonly deliveryWaiters = new Map<
    string,
    (delivered: boolean) => void
  >();
  private readonly messageHandlers: ((envelope: Envelope) => void)[] = [];

  constructor(options: MailboxOptions) {
    this.identity = options.identity;
    this.peers = options.peers;
    this.connections = options.connections;
    this.now = options.now ?? Date.now;
    this.sendAwaitMs = options.sendAwaitMs ?? DEFAULT_SEND_AWAIT_MS;
    this.log = options.log ?? (() => undefined);
    this.onCorruption = options.onCorruption;

    this.queueStore = new OutboundQueue(options.beamDir, {
      onQuarantine: (info) => this.reportQuarantine(info, options.onQuarantine),
    });
    this.seqCounter = new SeqCounter(options.beamDir);
    this.seenTracker = new SeenTracker(options.beamDir);
    this.flusher = new Flusher({
      queue: this.queueStore,
      connections: this.connections,
      ackTimeoutMs: options.ackTimeoutMs,
      retryIntervalMs: options.retryIntervalMs,
      log: this.log,
      onDelivered: (peerId, envelope) =>
        this.resolveDelivery(envelope.id, true),
      isRevoked: (peerId) => this.peers.get(peerId)?.revoked === true,
    });

    options.registry.register('msg', (stream) => this.handleInbound(stream));
    this.connections.onConnect((connection) =>
      this.flusher.kick(connection.peerId)
    );
    // Flush trigger: node start. Anything already queued for a peer that
    // happens to have a live connection right now is drained immediately;
    // everything else waits for that peer's onConnect.
    for (const peerId of this.queueStore.peerIds()) this.flusher.kick(peerId);
  }

  /**
   * Send one envelope to `to` (a peerId or label). Resolves to `delivered`,
   * `queued` (a success — the message is durable, the caller must not
   * resend it) or `rejected` (nothing was stored).
   */
  async send(input: SendInput): Promise<SendOutcome> {
    const peer = this.peers.resolve(input.to);
    if (!peer) return { outcome: 'rejected', reason: 'unknown-peer' };
    if (peer.revoked) return { outcome: 'rejected', reason: 'revoked-peer' };

    const encoding = input.encoding ?? 'utf8';
    if (
      payloadByteLength({ payload: input.payload, encoding }) >
      MAX_PAYLOAD_BYTES
    ) {
      return { outcome: 'rejected', reason: 'oversized-payload' };
    }

    // The seq is only claimed once the message is known-storable: claiming
    // one for a message we go on to reject would burn a sequence number
    // and leave a permanent gap the receiver could never get past.
    const envelope: Envelope = {
      id: randomUUID(),
      from: this.identity.peerId,
      to: peer.peerId,
      seq: this.seqCounter.next(peer.peerId),
      topic: input.topic,
      payload: input.payload,
      encoding,
      createdAt: this.now(),
    };
    this.queueStore.enqueue(peer.peerId, envelope);

    const delivered = await this.awaitDelivery(envelope.id, peer.peerId);
    const queueDepth = this.queueStore.depth(peer.peerId);
    if (delivered) {
      return {
        outcome: 'delivered',
        to: peer.peerId,
        label: peer.label,
        queueDepth,
      };
    }
    const reason = this.connections.get(peer.peerId)
      ? 'no ack before the timeout — beam will keep trying while connected'
      : 'peer not connected — beam will deliver this the next time it comes online';
    return {
      outcome: 'queued',
      to: peer.peerId,
      label: peer.label,
      queueDepth,
      reason,
    };
  }

  /** Envelopes accepted from a peer, delivered exactly once each, in
   * sender order. Returns an unsubscribe function. */
  onMessage(handler: (envelope: Envelope) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const i = this.messageHandlers.indexOf(handler);
      if (i >= 0) this.messageHandlers.splice(i, 1);
    };
  }

  status(): PeerStatus[] {
    return this.peers.list().map((peer) => ({
      peerId: peer.peerId,
      label: peer.label,
      revoked: peer.revoked,
      state: derivePeerState(
        peer,
        this.connections.get(peer.peerId) !== undefined
      ),
      queueDepth: this.queueStore.depth(peer.peerId),
    }));
  }

  /** What is waiting, oldest first; every peer's queue, or one peer's. */
  queue(peerId?: string): QueuedForPeer[] {
    const ids = peerId ? [peerId] : this.queueStore.peerIds();
    const out: QueuedForPeer[] = [];
    for (const id of ids) {
      for (const { envelope } of this.queueStore.list(id))
        out.push({ peerId: id, envelope });
    }
    return out;
  }

  /** Messages lost to quarantine — a queue file too corrupt to ever recover
   * or send, meaning a message a caller was already told was durable
   * (`queued`) is gone. Quarantine must be loud, never silent (D1): this is
   * what lets `beam msg queue` show it, and it stays discoverable here
   * across a restart, since the file and its reason stay on disk in
   * `corrupt/` — unlike the transient `onQuarantine` callback, which only
   * fires for the process that was running at the moment of quarantine. */
  quarantined(peerId?: string): QuarantinedFile[] {
    const ids = peerId ? [peerId] : this.queueStore.peerIds();
    return ids.flatMap((id) => this.queueStore.quarantined(id));
  }

  dispose(): void {
    this.flusher.dispose();
    for (const resolve of this.deliveryWaiters.values()) resolve(false);
    this.deliveryWaiters.clear();
  }

  private awaitDelivery(envelopeId: string, peerId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.deliveryWaiters.delete(envelopeId);
        resolve(false);
      }, this.sendAwaitMs);
      timer.unref?.();
      this.deliveryWaiters.set(envelopeId, (delivered) => {
        clearTimeout(timer);
        resolve(delivered);
      });
      this.flusher.kick(peerId);
    });
  }

  private resolveDelivery(envelopeId: string, delivered: boolean): void {
    const resolve = this.deliveryWaiters.get(envelopeId);
    if (!resolve) return;
    this.deliveryWaiters.delete(envelopeId);
    resolve(delivered);
  }

  /** A quarantined file means a message a caller was already told was
   * durable (`queued`) is gone and can never be sent — surfaced loudly
   * (D1), never left for the caller to discover only by its absence: logged
   * on the node's own diagnostic path (`this.log`, which defaults to
   * `console.log` — see Host's default), handed to whoever passed
   * `onQuarantine`, and durably discoverable afterwards via `quarantined()`
   * even across a restart, since the file and its reason stay on disk. */
  private reportQuarantine(
    info: QuarantinedFile,
    forward?: (info: QuarantinedFile) => void
  ): void {
    this.log(
      `quarantined ${info.peerId}/${info.fileName} — message lost, it will never be delivered: ${info.reason}`
    );
    forward?.(info);
  }

  private handleInbound(stream: BeamStream): void {
    stream.control({ kind: 'opened' });
    stream.onData((data) => this.handleEnvelopeFrame(stream, data));
  }

  private handleEnvelopeFrame(stream: BeamStream, data: Uint8Array): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return; // Not JSON at all — nothing sane to ack; drop.
    }
    if (!isEnvelope(parsed) || parsed.from !== stream.peer.peerId) return;
    const envelope = parsed;
    // No contiguity requirement (D1): `accept` takes any seq greater than
    // the last one seen from this sender. Accepted and duplicate both ack
    // `true` — a duplicate is exactly the resend a crash between the
    // sender's original delivery and its ack produces, and re-acking is
    // what lets the sender finally unlink it.
    try {
      const verdict = this.seenTracker.accept(stream.peer.peerId, envelope.seq);
      stream.control({ kind: 'ack', id: envelope.id, accepted: true });
      if (verdict === 'accepted') {
        for (const handler of this.messageHandlers) handler(envelope);
      }
    } catch (error) {
      if (!(error instanceof MailboxCorruptionError)) throw error;
      this.onCorruption?.(error);
      stream.control({
        kind: 'ack',
        id: envelope.id,
        accepted: false,
        reason: 'seen state unreadable',
      });
    }
  }
}
