import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Envelope } from './envelope.js';
import { OutboundQueue, type QuarantinedFile } from './outbound-queue.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-outq-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function envelope(seq: number, payload = `p${seq}`): Envelope {
  return {
    id: `id-${seq}`,
    from: 'sender',
    to: 'peer-x',
    seq,
    topic: 't',
    payload,
    encoding: 'utf8',
    createdAt: Date.now(),
  };
}

describe('OutboundQueue', () => {
  it('enqueue writes a file a reader can list back, sorted into send order', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue('peer-x', envelope(2));
    queue.enqueue('peer-x', envelope(1));
    queue.enqueue('peer-x', envelope(3));
    expect(queue.list('peer-x').map((q) => q.envelope.seq)).toEqual([1, 2, 3]);
  });

  it('enqueue writes temp-then-rename, so the target file is never partial', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue('peer-x', envelope(1));
    const path = join(dir, 'mailbox', 'out', 'peer-x', '0000000001.json');
    const raw = readFileSync(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw.endsWith('.tmp')).toBe(false);
  });

  it('remove unlinks the file; a second remove is a harmless no-op', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue('peer-x', envelope(1));
    queue.remove('peer-x', '0000000001.json');
    expect(queue.list('peer-x')).toHaveLength(0);
    expect(() => queue.remove('peer-x', '0000000001.json')).not.toThrow();
  });

  it('depth() matches list().length and 0 for an unknown peer', () => {
    const queue = new OutboundQueue(dir);
    expect(queue.depth('nobody')).toBe(0);
    queue.enqueue('peer-x', envelope(1));
    queue.enqueue('peer-x', envelope(2));
    expect(queue.depth('peer-x')).toBe(2);
  });

  it('quarantines an unparseable file, and it does not appear in list() again', () => {
    const quarantined: QuarantinedFile[] = [];
    const queue = new OutboundQueue(dir, {
      onQuarantine: (info) => quarantined.push(info),
    });
    queue.enqueue('peer-x', envelope(1));
    const peerDir = join(dir, 'mailbox', 'out', 'peer-x');
    writeFileSync(join(peerDir, '0000000002.json'), 'not json at all {{{');
    queue.enqueue('peer-x', envelope(3));

    const listed = queue.list('peer-x');
    expect(listed.map((q) => q.envelope.seq)).toEqual([1, 3]);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.fileName).toBe('0000000002.json');

    // A second list() must not re-report the same file as newly quarantined.
    queue.list('peer-x');
    expect(quarantined).toHaveLength(1);
  });

  it('quarantines a well-formed JSON value that is not an Envelope', () => {
    const quarantined: QuarantinedFile[] = [];
    const queue = new OutboundQueue(dir, {
      onQuarantine: (info) => quarantined.push(info),
    });
    const peerDir = join(dir, 'mailbox', 'out', 'peer-x');
    mkdirSync(peerDir, { recursive: true });
    writeFileSync(
      join(peerDir, '0000000001.json'),
      JSON.stringify({ not: 'an envelope' })
    );
    expect(queue.list('peer-x')).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
  });

  it('peerIds() lists every peer with a queue directory', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue('a', envelope(1));
    queue.enqueue('b', envelope(1));
    expect(queue.peerIds().sort()).toEqual(['a', 'b']);
  });
});
