import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailboxCorruptionError } from './seen-tracker.js';
import { SeqCounter } from './seq-counter.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-seqc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SeqCounter', () => {
  it('starts each peer at 1 and increments per call', () => {
    const counter = new SeqCounter(dir);
    expect(counter.next('p')).toBe(1);
    expect(counter.next('p')).toBe(2);
    expect(counter.next('p')).toBe(3);
  });

  it('tracks each peer independently', () => {
    const counter = new SeqCounter(dir);
    expect(counter.next('a')).toBe(1);
    expect(counter.next('b')).toBe(1);
    expect(counter.next('a')).toBe(2);
  });

  it('back-to-back calls (simulating concurrent async callers) never repeat a value', () => {
    const counter = new SeqCounter(dir);
    // Two "concurrent" callers in real code both call next() without an
    // await between the call and the read — this loop is that shape.
    const seqs = Array.from({ length: 20 }, () => counter.next('p'));
    expect(new Set(seqs).size).toBe(20);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('persists across instances against the same beamDir', () => {
    new SeqCounter(dir).next('p');
    const reopened = new SeqCounter(dir);
    expect(reopened.next('p')).toBe(2);
  });

  it('a malformed counter file throws rather than silently resetting to 1 (D2)', () => {
    const path = join(dir, 'mailbox', 'seq.json');
    new SeqCounter(dir).next('p'); // creates the real file (mailbox/ dir included) first.
    writeFileSync(path, 'not valid json {{');
    // A counter that cannot be trusted must not be guessed: resetting to 1
    // would reissue a seq the receiver already accepted, which it would
    // then judge a duplicate, ack, and let the sender unlink — a real
    // message silently lost and reported delivered.
    expect(() => new SeqCounter(dir)).toThrow(MailboxCorruptionError);
  });

  it('a seq.json that cannot be read as a file also throws, not resets', () => {
    const path = join(dir, 'mailbox', 'seq.json');
    // A directory where the file should be makes readFileSync fail (EISDIR)
    // — a different failure shape than a parse error, and it must be
    // treated the same way: loud, not guessed.
    mkdirSync(path, { recursive: true });
    expect(() => new SeqCounter(dir)).toThrow(MailboxCorruptionError);
  });

  it('reconciles against the highest seq already in the queue directory when the counter file is missing (D2)', () => {
    const outDir = join(dir, 'mailbox', 'out', 'peer-x');
    mkdirSync(outDir, { recursive: true });
    // A real queued file survives even though seq.json itself is gone —
    // e.g. it was never written yet, or was lost outright.
    writeFileSync(join(outDir, '0000000005.json'), '{}');
    const counter = new SeqCounter(dir);
    expect(counter.next('peer-x')).toBe(6);
  });

  it('reconciliation also counts quarantined files, so a lost seq is never reissued (D2)', () => {
    const corruptDir = join(dir, 'mailbox', 'out', 'peer-x', 'corrupt');
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, '0000000009.json'), 'garbage');
    const counter = new SeqCounter(dir);
    expect(counter.next('peer-x')).toBe(10);
  });

  it('reconciliation never lowers the counter when the persisted value is already ahead of the queue', () => {
    const outDir = join(dir, 'mailbox', 'out', 'peer-x');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, '0000000002.json'), '{}');
    new SeqCounter(dir).next('peer-x'); // persists 3 (max(0, 2) + 1).
    const reopened = new SeqCounter(dir);
    expect(reopened.next('peer-x')).toBe(4); // not max(0, 2) + 1 again.
  });
});
