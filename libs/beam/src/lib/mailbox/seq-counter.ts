/**
 * The mailbox's monotonic send counter (`mailbox/seq.json`): one counter per
 * recipient peer, since the receiver's dedup (SeenTracker) tracks the
 * highest seq accepted *from* a given sender — that only lines up if each
 * sender assigns a contiguous sequence per recipient, not one shared across
 * every peer it talks to. See docs/beam.md.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export class SeqCounter {
  private readonly dir: string;
  private readonly path: string;
  private counts: Record<string, number>;

  constructor(beamDir: string) {
    this.dir = join(beamDir, 'mailbox');
    this.path = join(this.dir, 'seq.json');
    this.counts = this.load();
  }

  /** The next sequence number to assign for `peerId`, starting at 1.
   * Synchronous end to end (no `await` between read, increment and
   * persist), so two sends issued back to back — even from concurrent
   * in-flight async callers — can never be handed the same value: Node
   * cannot interleave two synchronous calls. */
  next(peerId: string): number {
    const seq = (this.counts[peerId] ?? 0) + 1;
    this.counts = { ...this.counts, [peerId]: seq };
    this.save();
    return seq;
  }

  private load(): Record<string, number> {
    if (!existsSync(this.path)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, number>;
      }
    } catch {
      // A malformed counter file must not crash the node. Restarting
      // numbering from 1 cannot cause a duplicate or out-of-order delivery
      // — the receiver's SeenTracker would reject those seqs as a
      // regression (duplicate/gap) rather than silently accept them — so
      // the safe failure mode here is "some messages stop being
      // deliverable until re-sent", not silent corruption.
    }
    return {};
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.counts), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
