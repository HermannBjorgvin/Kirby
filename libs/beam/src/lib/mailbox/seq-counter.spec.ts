import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('a malformed counter file resets rather than crashing the node', () => {
    const path = join(dir, 'mailbox', 'seq.json');
    new SeqCounter(dir).next('p'); // creates the real file (mailbox/ dir included) first.
    writeFileSync(path, 'not valid json {{');
    const counter = new SeqCounter(dir);
    // Resets to an empty counter rather than throwing: numbering restarts
    // at 1, which SeenTracker's contiguity check treats as a regression
    // (duplicate/gap) on the receiving end rather than silently accepting
    // it, so this can never cause a duplicate or out-of-order delivery.
    expect(counter.next('p')).toBe(1);
  });
});
