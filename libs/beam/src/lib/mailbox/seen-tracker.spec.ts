import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailboxCorruptionError, SeenTracker } from './seen-tracker.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-seen-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SeenTracker', () => {
  it('accepts seq 1 first, then rejects a repeat as duplicate', () => {
    const tracker = new SeenTracker(dir);
    expect(tracker.accept('p', 1)).toBe('accepted');
    expect(tracker.accept('p', 1)).toBe('duplicate');
  });

  it('accepts a jump ahead — there is no contiguity requirement (D1)', () => {
    const tracker = new SeenTracker(dir);
    expect(tracker.accept('p', 1)).toBe('accepted');
    expect(tracker.accept('p', 2)).toBe('accepted');
    expect(tracker.accept('p', 5)).toBe('accepted');
    expect(tracker.lastSeq('p')).toBe(5);
    // Anything at or below the new lastSeq is now a duplicate, including
    // the seqs the jump skipped over — there is no hole left to fill.
    expect(tracker.accept('p', 3)).toBe('duplicate');
    expect(tracker.accept('p', 5)).toBe('duplicate');
  });

  it('treats anything at or below last as duplicate, never as a gap', () => {
    const tracker = new SeenTracker(dir);
    tracker.accept('p', 1);
    tracker.accept('p', 2);
    tracker.accept('p', 3);
    expect(tracker.accept('p', 1)).toBe('duplicate');
    expect(tracker.accept('p', 2)).toBe('duplicate');
  });

  it('tracks each sender independently', () => {
    const tracker = new SeenTracker(dir);
    expect(tracker.accept('a', 1)).toBe('accepted');
    expect(tracker.accept('b', 1)).toBe('accepted');
    expect(tracker.accept('a', 2)).toBe('accepted');
    expect(tracker.lastSeq('b')).toBe(1);
  });

  it('persists across instances against the same beamDir', () => {
    new SeenTracker(dir).accept('p', 1);
    const reopened = new SeenTracker(dir);
    expect(reopened.lastSeq('p')).toBe(1);
    expect(reopened.accept('p', 1)).toBe('duplicate');
  });

  it('a partially/unparseable seen file throws MailboxCorruptionError rather than resetting to 0', () => {
    const seenDir = join(dir, 'mailbox', 'seen');
    mkdirSync(seenDir, { recursive: true });
    writeFileSync(join(seenDir, 'p.json'), '{"lastSeq": tr'); // torn/garbage write
    const tracker = new SeenTracker(dir);
    expect(() => tracker.lastSeq('p')).toThrow(MailboxCorruptionError);
    expect(() => tracker.accept('p', 1)).toThrow(MailboxCorruptionError);
  });

  it('a seen file missing the lastSeq field is also corruption, not silently 0', () => {
    const seenDir = join(dir, 'mailbox', 'seen');
    mkdirSync(seenDir, { recursive: true });
    writeFileSync(join(seenDir, 'p.json'), JSON.stringify({ oops: true }));
    const tracker = new SeenTracker(dir);
    expect(() => tracker.lastSeq('p')).toThrow(MailboxCorruptionError);
  });
});
