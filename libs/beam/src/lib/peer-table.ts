/**
 * beam peer table — the record of every machine this one has paired with.
 * Trust is symmetric (pairing leaves both sides holding the other's public
 * key); reachability is not (`endpoints` may be empty). See docs/beam.md.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** The filesystem calls PeerTable's atomic write goes through; overridable
 * so a test can simulate a crash between the write and the rename without
 * fighting ESM's non-configurable named exports. */
export interface AtomicWriteFs {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
}

const defaultFs: AtomicWriteFs = { mkdirSync, writeFileSync, renameSync };

export interface PeerRecord {
  /** Derived from publicKeyPem; identity, never changes. */
  peerId: string;
  /** Local display name, unique within this table. */
  label: string;
  /** Used to verify everything this peer signs. */
  publicKeyPem: string;
  /** Where we may dial this peer; may be empty. */
  endpoints: string[];
  pairedAt: number;
  lastSeenAt?: number;
  /** Kept, never matched, never dialed. */
  revoked: boolean;
  /** When `revoked` became true; absent while it is false. */
  revokedAt?: number;
}

export type NewPeer = Omit<PeerRecord, 'pairedAt' | 'revoked'>;

export interface PeerTableOptions {
  now?: () => number;
  fs?: AtomicWriteFs;
}

export class PeerTable {
  private readonly path: string;
  private readonly now: () => number;
  private readonly fs: AtomicWriteFs;
  private peers = new Map<string, PeerRecord>();

  constructor(beamDir: string, options: PeerTableOptions = {}) {
    this.path = join(beamDir, 'peers.json');
    this.now = options.now ?? Date.now;
    this.fs = options.fs ?? defaultFs;
    this.beamDir = beamDir;
    this.load();
  }

  private readonly beamDir: string;

  /** Insert or update a peer. A label collision with a *different* peerId is
   * resolved locally by appending `-2`, `-3`, ...; the caller's own record
   * keeps re-using its existing label across updates. */
  upsert(input: NewPeer): PeerRecord {
    const existing = this.peers.get(input.peerId);
    const label = this.uniqueLabel(input.label, input.peerId);
    const record: PeerRecord = {
      ...input,
      label,
      pairedAt: existing?.pairedAt ?? this.now(),
      revoked: existing?.revoked ?? false,
    };
    this.peers.set(record.peerId, record);
    this.save();
    return record;
  }

  get(peerId: string): PeerRecord | undefined {
    return this.peers.get(peerId);
  }

  /** Find a peer by id first, then by label. */
  resolve(idOrLabel: string): PeerRecord | undefined {
    return (
      this.peers.get(idOrLabel) ??
      this.list().find((p) => p.label === idOrLabel)
    );
  }

  list(): PeerRecord[] {
    return [...this.peers.values()].sort((a, b) => a.pairedAt - b.pairedAt);
  }

  /** Renaming never changes `peerId`. */
  rename(peerId: string, label: string): PeerRecord {
    const record = this.require(peerId);
    const updated: PeerRecord = {
      ...record,
      label: this.uniqueLabel(label, peerId),
    };
    this.peers.set(peerId, updated);
    this.save();
    return updated;
  }

  /** Kept in the table but never matched or dialed again. */
  revoke(peerId: string): void {
    const record = this.require(peerId);
    this.peers.set(peerId, {
      ...record,
      revoked: true,
      revokedAt: this.now(),
    });
    this.save();
  }

  remove(peerId: string): void {
    this.peers.delete(peerId);
    this.save();
  }

  setEndpoints(peerId: string, endpoints: string[]): void {
    const record = this.require(peerId);
    this.peers.set(peerId, { ...record, endpoints: [...endpoints] });
    this.save();
  }

  touch(peerId: string, lastSeenAt: number = this.now()): void {
    const record = this.require(peerId);
    this.peers.set(peerId, { ...record, lastSeenAt });
    this.save();
  }

  private require(peerId: string): PeerRecord {
    const record = this.peers.get(peerId);
    if (!record) throw new Error(`unknown peer: ${peerId}`);
    return record;
  }

  /** Append -2, -3, ... until `label` is unique among peers other than `ownerId`. */
  private uniqueLabel(label: string, ownerId: string): string {
    const taken = new Set(
      this.list()
        .filter((p) => p.peerId !== ownerId)
        .map((p) => p.label)
    );
    if (!taken.has(label)) return label;
    let n = 2;
    while (taken.has(`${label}-${n}`)) n += 1;
    return `${label}-${n}`;
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    const raw = readFileSync(this.path, 'utf8');
    const records = JSON.parse(raw) as PeerRecord[];
    this.peers = new Map(records.map((r) => [r.peerId, r]));
  }

  /** Atomic write: temp file, then rename over the target. A reader never
   * observes a partially written peers.json. */
  private save(): void {
    this.fs.mkdirSync(this.beamDir, { recursive: true, mode: 0o700 });
    const tmpPath = `${this.path}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmpPath, JSON.stringify(this.list(), null, 2), {
      mode: 0o600,
    });
    this.fs.renameSync(tmpPath, this.path);
  }
}
