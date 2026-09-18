import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerTable, type PeerRecord } from './peer-table.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-peers-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function record(
  overrides: Partial<PeerRecord> = {}
): Omit<PeerRecord, 'pairedAt' | 'revoked'> {
  return {
    peerId: 'peer-a',
    label: 'workbox',
    publicKeyPem: 'pem-a',
    endpoints: [],
    ...overrides,
  };
}

describe('PeerTable persistence', () => {
  it('persists peers.json with mode 0600', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    const path = join(dir, 'peers.json');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('a second PeerTable over the same dir sees peers written by the first', () => {
    new PeerTable(dir).upsert(record());
    const second = new PeerTable(dir);
    expect(second.get('peer-a')?.label).toBe('workbox');
  });

  it('an interrupted write leaves the previous peers.json intact and parseable', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    const before = readFileSync(join(dir, 'peers.json'), 'utf8');

    // Simulate a crash between the temp-file write and the rename that
    // publishes it, without touching the real fs module's rename at all:
    // a second table, sharing the same directory, is given a renameSync
    // that always fails.
    const crashing = new PeerTable(dir, {
      fs: {
        mkdirSync,
        writeFileSync,
        renameSync: vi.fn(() => {
          throw new Error('simulated crash between write and rename');
        }),
      },
    });
    expect(() =>
      crashing.upsert(record({ peerId: 'peer-b', label: 'laptop' }))
    ).toThrow();

    const after = readFileSync(join(dir, 'peers.json'), 'utf8');
    expect(after).toBe(before);
    expect(() => JSON.parse(after)).not.toThrow();
    expect(JSON.parse(after)).toHaveLength(1);
  });
});

describe('PeerTable operations', () => {
  it('upsert stamps pairedAt and defaults revoked to false', () => {
    const table = new PeerTable(dir, { now: () => 1000 });
    const stored = table.upsert(record());
    expect(stored.pairedAt).toBe(1000);
    expect(stored.revoked).toBe(false);
  });

  it('resolves a peer by id', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    expect(table.resolve('peer-a')?.peerId).toBe('peer-a');
  });

  it('resolves a peer by label', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    expect(table.resolve('workbox')?.peerId).toBe('peer-a');
  });

  it('lists every stored peer', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.upsert(record({ peerId: 'peer-b', label: 'laptop' }));
    expect(
      table
        .list()
        .map((p) => p.peerId)
        .sort()
    ).toEqual(['peer-a', 'peer-b']);
  });

  it('resolves a label collision locally by appending -2, -3, ...', () => {
    const table = new PeerTable(dir);
    const a = table.upsert(record({ peerId: 'peer-a', label: 'box' }));
    const b = table.upsert(record({ peerId: 'peer-b', label: 'box' }));
    const c = table.upsert(record({ peerId: 'peer-c', label: 'box' }));
    expect(a.label).toBe('box');
    expect(b.label).toBe('box-2');
    expect(c.label).toBe('box-3');
  });

  it('re-upserting the same peerId does not trigger its own collision suffix', () => {
    const table = new PeerTable(dir);
    table.upsert(record({ peerId: 'peer-a', label: 'box' }));
    const again = table.upsert(
      record({ peerId: 'peer-a', label: 'box', endpoints: ['https://x'] })
    );
    expect(again.label).toBe('box');
    expect(again.endpoints).toEqual(['https://x']);
  });

  it('rename keeps the peerId unchanged', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    const renamed = table.rename('peer-a', 'renamed-box');
    expect(renamed.peerId).toBe('peer-a');
    expect(renamed.label).toBe('renamed-box');
    expect(table.resolve('renamed-box')?.peerId).toBe('peer-a');
  });

  it('revoke keeps the record but marks it revoked, stamped with when', () => {
    const table = new PeerTable(dir, { now: () => 5000 });
    table.upsert(record());
    table.revoke('peer-a');
    const stored = table.get('peer-a');
    expect(stored).toBeDefined();
    expect(stored?.revoked).toBe(true);
    expect(stored?.revokedAt).toBe(5000);
  });

  it('remove drops the record entirely', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.remove('peer-a');
    expect(table.get('peer-a')).toBeUndefined();
  });

  it('setEndpoints replaces the endpoint list', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.setEndpoints('peer-a', ['https://a', 'https://b']);
    expect(table.get('peer-a')?.endpoints).toEqual(['https://a', 'https://b']);
  });

  it('touch stamps lastSeenAt', () => {
    const table = new PeerTable(dir, { now: () => 500 });
    table.upsert(record());
    table.touch('peer-a');
    expect(table.get('peer-a')?.lastSeenAt).toBe(500);
  });

  it('touch accepts an explicit timestamp', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.touch('peer-a', 12345);
    expect(table.get('peer-a')?.lastSeenAt).toBe(12345);
  });
});
