/**
 * Receiver-side dedup: `mailbox/seen/<peerId>.json` persists the highest
 * accepted seq from that sender. At-least-once delivery on the wire plus
 * this dedup is what makes the receiving application see each message
 * exactly once, in order. See docs/beam.md.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** A seen-state file exists but cannot be trusted. Thrown rather than
 * silently treated as "nothing seen yet" — that would risk re-accepting
 * (and re-delivering to the application) a message this node already
 * processed, which is exactly the exactly-once guarantee the mailbox
 * exists to provide. */
export class MailboxCorruptionError extends Error {
  constructor(public readonly peerId: string, message: string) {
    super(message);
    this.name = 'MailboxCorruptionError';
  }
}

export type AcceptVerdict = 'accepted' | 'duplicate' | 'gap';

export class SeenTracker {
  private readonly dir: string;

  constructor(beamDir: string) {
    this.dir = join(beamDir, 'mailbox', 'seen');
  }

  private path(peerId: string): string {
    return join(this.dir, `${peerId}.json`);
  }

  /** The highest seq accepted from `peerId`, or 0 if none yet. */
  lastSeq(peerId: string): number {
    const path = this.path(peerId);
    if (!existsSync(path)) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new MailboxCorruptionError(
        peerId,
        `seen state for ${peerId} is unreadable: ${(error as Error).message}`
      );
    }
    const lastSeq =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['lastSeq']
        : undefined;
    if (typeof lastSeq !== 'number') {
      throw new MailboxCorruptionError(
        peerId,
        `seen state for ${peerId} is malformed`
      );
    }
    return lastSeq;
  }

  /**
   * Judge `seq` from `peerId` and, if it is the legitimate next one,
   * persist it in the same step: `seq === last + 1` is accepted; anything
   * at or below `last` is a duplicate (the resend a crash between delivery
   * and ack produces) and must be re-acked without being delivered to the
   * application again; anything further ahead is a gap and is an error,
   * never silently accepted out of order.
   */
  accept(peerId: string, seq: number): AcceptVerdict {
    return this.judge(peerId, seq);
  }

  /**
   * Advance past `seq` for `peerId` without any content — the sender's
   * counterpart to a hole it can never fill (an unrecoverable queue file,
   * see OutboundQueue). Same contiguity rule as `accept`; the caller never
   * delivers anything to the application for a skipped seq.
   */
  skip(peerId: string, seq: number): AcceptVerdict {
    return this.judge(peerId, seq);
  }

  private judge(peerId: string, seq: number): AcceptVerdict {
    const last = this.lastSeq(peerId);
    if (seq <= last) return 'duplicate';
    if (seq !== last + 1) return 'gap';
    this.save(peerId, seq);
    return 'accepted';
  }

  private save(peerId: string, lastSeq: number): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = this.path(peerId);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastSeq }), { mode: 0o600 });
    renameSync(tmp, path);
  }
}
