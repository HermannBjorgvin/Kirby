/**
 * Drains one peer's outbound queue over whichever live connection exists —
 * dialed or accepted, it does not matter (that symmetry is the whole point
 * of a queue keyed by peer, not by role). Strictly sequential: send one
 * envelope, await its ack, unlink, then the next. See docs/beam.md.
 */

import type { ConnectionRegistry } from '../connection-registry.js';
import type { PeerConnection } from '../connection.js';
import type { BeamStream } from '../stream.js';
import type { Envelope } from './envelope.js';
import type { OutboundQueue, QueuedEnvelope } from './outbound-queue.js';

interface MsgStreamState {
  stream: BeamStream;
  pending: Map<string, (accepted: boolean) => void>;
}

export interface FlusherOptions {
  queue: OutboundQueue;
  connections: ConnectionRegistry;
  /** How long one envelope waits for its ack before the drain loop backs
   * off and retries (the "bounded retry while a connection stays up"). */
  ackTimeoutMs?: number;
  retryIntervalMs?: number;
  onDelivered?: (peerId: string, envelope: Envelope) => void;
  /** Sequence numbers this peer can never receive real content for (a
   * queue file too corrupt to recover — see OutboundQueue.onQuarantine),
   * ascending, not yet told to the peer. The drain loop tells the peer
   * about each one (a `skip` Control round trip) before sending anything
   * with a higher seq — otherwise the receiver's contiguity check would
   * reject every later message as a permanent gap, which is exactly the
   * "wedged behind a bad file" outcome this exists to avoid. */
  holesFor?: (peerId: string) => number[];
  onHoleResolved?: (peerId: string, seq: number) => void;
  log?: (message: string) => void;
}

const DEFAULT_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class Flusher {
  private readonly queue: OutboundQueue;
  private readonly connections: ConnectionRegistry;
  private readonly ackTimeoutMs: number;
  private readonly retryIntervalMs: number;
  private readonly onDelivered?: (peerId: string, envelope: Envelope) => void;
  private readonly holesFor: (peerId: string) => number[];
  private readonly onHoleResolved?: (peerId: string, seq: number) => void;
  private readonly log: (message: string) => void;
  private readonly active = new Set<string>();
  /** Peers kicked again while their drain was already running (or just
   * about to decide there was nothing to do) — checked when that drain
   * finishes so a kick arriving in that gap is never silently dropped. */
  private readonly recheck = new Set<string>();
  private readonly streams = new Map<string, MsgStreamState>();
  private disposed = false;

  constructor(options: FlusherOptions) {
    this.queue = options.queue;
    this.connections = options.connections;
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.onDelivered = options.onDelivered;
    this.holesFor = options.holesFor ?? (() => []);
    this.onHoleResolved = options.onHoleResolved;
    this.log = options.log ?? (() => undefined);
  }

  /** Ask the flusher to (re)drain `peerId`'s queue if a connection exists.
   * If a drain for that peer is already running (including one about to
   * decide there is nothing left to do), this is remembered and rechecked
   * when that drain finishes, rather than silently dropped — a message
   * enqueued in the narrow gap between that drain's last scan and its exit
   * must still get sent without waiting for some unrelated future trigger. */
  kick(peerId: string): void {
    if (this.disposed) return;
    if (!this.connections.get(peerId)) return;
    if (this.active.has(peerId)) {
      this.recheck.add(peerId);
      return;
    }
    this.startDrain(peerId);
  }

  private startDrain(peerId: string): void {
    this.active.add(peerId);
    void this.drain(peerId).finally(() => {
      this.active.delete(peerId);
      if (
        this.recheck.delete(peerId) &&
        !this.disposed &&
        this.connections.get(peerId)
      ) {
        this.startDrain(peerId);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  private async drain(peerId: string): Promise<void> {
    for (;;) {
      if (this.disposed) return;
      const connection = this.connections.get(peerId);
      if (!connection) return; // No connection right now; a future connect re-kicks.

      const nextHole = this.nextHoleFor(peerId);
      const next = this.queue.list(peerId)[0];
      if (nextHole === undefined && !next) return; // Nothing left to drain.

      const state = await this.streamFor(peerId, connection);
      if (!state) {
        await delay(this.retryIntervalMs);
        continue;
      }

      // A hole must be told to the peer before any later-seq envelope, or
      // the peer's contiguity check would reject that envelope as a gap
      // forever — exactly the "wedged behind a bad file" outcome a
      // quarantined queue file must not cause.
      const progressed =
        nextHole !== undefined
          ? await this.stepHole(peerId, state, nextHole)
          : await this.stepEnvelope(peerId, state, next);
      if (!progressed) await delay(this.retryIntervalMs);
    }
  }

  private nextHoleFor(peerId: string): number | undefined {
    const holes = this.holesFor(peerId);
    return holes.length > 0 ? Math.min(...holes) : undefined;
  }

  /** Send one queued skip; returns whether the loop made progress (an
   * unacked skip is retried by the caller's delay, not treated as done). */
  private async stepHole(
    peerId: string,
    state: MsgStreamState,
    seq: number
  ): Promise<boolean> {
    const accepted = await this.sendSkip(state, seq);
    if (accepted) this.onHoleResolved?.(peerId, seq);
    return accepted;
  }

  /** Send one queued envelope; same progress convention as `stepHole`. */
  private async stepEnvelope(
    peerId: string,
    state: MsgStreamState,
    next: QueuedEnvelope | undefined
  ): Promise<boolean> {
    if (!next) return true; // Resolved by a hole step elsewhere; loop again.
    const accepted = await this.sendOne(state, next.envelope);
    if (accepted) {
      this.queue.remove(peerId, next.fileName);
      this.onDelivered?.(peerId, next.envelope);
      return true;
    }
    this.log(`msg to ${peerId} not acked; retrying while connected`);
    return false;
  }

  private async streamFor(
    peerId: string,
    connection: PeerConnection
  ): Promise<MsgStreamState | null> {
    const cached = this.streams.get(peerId);
    if (cached) return cached;
    try {
      const stream = await connection.openStream('msg');
      const state: MsgStreamState = { stream, pending: new Map() };
      stream.onControl((message) => this.handleAck(state, message));
      stream.onClose(() => {
        if (this.streams.get(peerId) === state) this.streams.delete(peerId);
      });
      this.streams.set(peerId, state);
      return state;
    } catch (error) {
      this.log(
        `could not open msg stream to ${peerId}: ${(error as Error).message}`
      );
      return null;
    }
  }

  private handleAck(
    state: MsgStreamState,
    message: Record<string, unknown>
  ): void {
    let key: string | undefined;
    if (message['kind'] === 'ack' && typeof message['id'] === 'string') {
      key = message['id'];
    } else if (
      message['kind'] === 'skip-ack' &&
      typeof message['seq'] === 'number'
    ) {
      key = skipKey(message['seq']);
    }
    if (key === undefined) return;
    const resolve = state.pending.get(key);
    if (!resolve) return;
    state.pending.delete(key);
    resolve(message['accepted'] === true);
  }

  private awaitAck(
    state: MsgStreamState,
    key: string,
    send: () => void
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (accepted: boolean): void => {
        if (settled) return;
        settled = true;
        state.pending.delete(key);
        resolve(accepted);
      };
      const timer = setTimeout(() => finish(false), this.ackTimeoutMs);
      timer.unref?.();
      state.pending.set(key, (accepted) => {
        clearTimeout(timer);
        finish(accepted);
      });
      send();
    });
  }

  private sendOne(state: MsgStreamState, envelope: Envelope): Promise<boolean> {
    return this.awaitAck(state, envelope.id, () =>
      state.stream.write(new TextEncoder().encode(JSON.stringify(envelope)))
    );
  }

  private sendSkip(state: MsgStreamState, seq: number): Promise<boolean> {
    return this.awaitAck(state, skipKey(seq), () =>
      state.stream.control({ kind: 'skip', seq })
    );
  }
}

function skipKey(seq: number): string {
  return `skip:${seq}`;
}
