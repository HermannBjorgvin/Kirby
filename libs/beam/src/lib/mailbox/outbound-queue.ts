/**
 * The durable per-peer outbound queue: `mailbox/out/<peerId>/`, one file per
 * undelivered message, written temp-then-rename and named by zero-padded
 * seq so the directory sorts into send order. See docs/beam.md.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isEnvelope, type Envelope } from './envelope.js';

const SEQ_PAD = 10;

export interface QuarantinedFile {
  peerId: string;
  fileName: string;
  reason: string;
}

export interface QueuedEnvelope {
  envelope: Envelope;
  fileName: string;
}

export interface OutboundQueueOptions {
  /** Called whenever a file is quarantined (moved aside as unreadable) —
   * the caller decides whether/how to log it. */
  onQuarantine?: (info: QuarantinedFile) => void;
}

export class OutboundQueue {
  private readonly root: string;
  private readonly onQuarantine?: (info: QuarantinedFile) => void;

  constructor(beamDir: string, options: OutboundQueueOptions = {}) {
    this.root = join(beamDir, 'mailbox', 'out');
    this.onQuarantine = options.onQuarantine;
  }

  private peerDir(peerId: string): string {
    return join(this.root, peerId);
  }

  private fileName(seq: number): string {
    return `${String(seq).padStart(SEQ_PAD, '0')}.json`;
  }

  /** Durable write: temp file, then rename over the target. A reader never
   * observes a partially written envelope — the crash window this closes
   * is "wrote the file, crashed before sending": on restart, the file is
   * either fully there or not there at all. */
  enqueue(peerId: string, envelope: Envelope): void {
    const dir = this.peerDir(peerId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, this.fileName(envelope.seq));
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
    renameSync(tmp, target);
  }

  /** Every undelivered envelope for a peer, oldest (lowest seq) first. A
   * file that cannot be parsed as an Envelope is quarantined — moved into
   * a `corrupt/` subdirectory — rather than left to block every message
   * behind it forever. */
  list(peerId: string): QueuedEnvelope[] {
    const dir = this.peerDir(peerId);
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    const out: QueuedEnvelope[] = [];
    for (const name of names) {
      const parsed = this.tryRead(dir, name);
      if (parsed) out.push({ envelope: parsed, fileName: name });
    }
    return out;
  }

  private tryRead(dir: string, name: string): Envelope | null {
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), 'utf8');
    } catch {
      return null; // Removed concurrently (e.g. by another drain); skip.
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.quarantine(
        dir,
        name,
        `unparseable JSON: ${(error as Error).message}`
      );
      return null;
    }
    if (!isEnvelope(parsed)) {
      this.quarantine(dir, name, 'does not look like an envelope');
      return null;
    }
    return parsed;
  }

  remove(peerId: string, fileName: string): void {
    try {
      unlinkSync(join(this.peerDir(peerId), fileName));
    } catch {
      // Already gone — fine, that is the point of unlinking.
    }
  }

  depth(peerId: string): number {
    return this.list(peerId).length;
  }

  /** Every peerId with a queue directory on disk, for the node-start flush
   * and for `status`/`msg queue` across all peers. */
  peerIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  private quarantine(dir: string, name: string, reason: string): void {
    const quarantineDir = join(dir, 'corrupt');
    const peerId = dir.slice(this.root.length + 1);
    try {
      mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
      renameSync(join(dir, name), join(quarantineDir, name));
    } catch {
      // If even the rename fails there is nothing more to safely do; the
      // caller already skips this file either way.
    }
    this.onQuarantine?.({ peerId, fileName: name, reason });
  }
}
