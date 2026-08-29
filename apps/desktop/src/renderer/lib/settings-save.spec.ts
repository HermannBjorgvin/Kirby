import { describe, it, expect } from 'vitest';
import { persistedValue, type PendingSave } from './settings-save.js';

/**
 * A settings row saves on blur, so every scenario below is some order
 * of "the user left the field" and "the settings query moved under
 * them". What is being pinned is which of those orders produce a write.
 *
 * The harness is the save path from `FieldRow`: submit what the control
 * holds, and either a write goes out or it is swallowed as unchanged.
 */
function fieldRow(initial: string) {
  let server = initial;
  // Stands in for the query's `dataUpdatedAt`, which advances on every
  // result the query produces, whether or not the value moved.
  let updatedAt = 1;
  let pending: PendingSave | null = null;
  const writes: string[] = [];
  return {
    /** The settings query came back — our own save, or someone else's. */
    refetch(value: string) {
      server = value;
      updatedAt += 1;
    },
    /** Blur, Enter, or a select changing. */
    submit(value: string) {
      if (value === persistedValue(server, updatedAt, pending)) return;
      pending = { seenAt: updatedAt, base: server, value };
      writes.push(value);
    },
    writes,
  };
}

describe('settings save guard', () => {
  it('swallows a blur that leaves the value alone', () => {
    const row = fieldRow('/tmp/worktrees');
    row.submit('/tmp/worktrees');
    expect(row.writes).toEqual([]);
  });

  it('writes an edit', () => {
    const row = fieldRow('/tmp/worktrees');
    row.submit('/tmp/elsewhere');
    expect(row.writes).toEqual(['/tmp/elsewhere']);
  });

  it('writes a second edit made before the query catches up', () => {
    // The refetch is a round trip; a fast typist gets back to the field
    // well inside it. Both edits have to land.
    const row = fieldRow('/tmp/worktrees');
    row.submit('/tmp/first');
    row.submit('/tmp/second');
    expect(row.writes).toEqual(['/tmp/first', '/tmp/second']);
  });

  it('writes a revert made before the query catches up', () => {
    // Typing the original value back is an edit like any other: disk
    // holds '/tmp/first' by now, whatever the stale query still says.
    const row = fieldRow('/tmp/worktrees');
    row.submit('/tmp/first');
    row.submit('/tmp/worktrees');
    expect(row.writes).toEqual(['/tmp/first', '/tmp/worktrees']);
  });

  it('stops repeating a save once the query has caught up with it', () => {
    const row = fieldRow('/tmp/worktrees');
    row.submit('/tmp/first');
    row.refetch('/tmp/first');
    row.submit('/tmp/first');
    expect(row.writes).toEqual(['/tmp/first']);
  });

  it('does not write back a value that arrived from somewhere else', () => {
    // The TUI (or another window) wrote the field; the query brings it
    // in and the control repopulates. Blurring that is not an edit.
    const row = fieldRow('/tmp/worktrees');
    row.refetch('/tmp/from-the-tui');
    row.submit('/tmp/from-the-tui');
    expect(row.writes).toEqual([]);
  });

  it('does not write back an outside change that lands after a save', () => {
    // Our save is only the newer truth while the query still reports
    // the value it was made against. Once that moves, it is history.
    const row = fieldRow('/tmp/worktrees');
    row.submit('/tmp/first');
    row.refetch('/tmp/from-the-tui');
    row.submit('/tmp/from-the-tui');
    expect(row.writes).toEqual(['/tmp/first']);
  });

  it('lets go of a save when a result shares its stamp but not its value', () => {
    // `dataUpdatedAt` is a wall clock, so two results can land inside
    // the same millisecond and the stamp alone stops discriminating. A
    // result carrying a value the save was not made against belongs to
    // somebody else either way.
    const pending: PendingSave = {
      seenAt: 1000,
      base: '/tmp/a',
      value: '/tmp/b',
    };
    expect(persistedValue('/tmp/c', 1000, pending)).toBe('/tmp/c');
  });

  it('repeats a save the query answered without carrying it', () => {
    // A fetch already in flight when we wrote resolves reporting the
    // old value. The query has spoken, so the record is spent and the
    // still-dirty control writes again. That redundant write is the
    // price of never republishing a stale value, and is deliberate:
    // matching on the value instead would keep the record alive past
    // the point where it can still be told apart from an outside edit.
    const row = fieldRow('/tmp/a');
    row.submit('/tmp/b');
    row.refetch('/tmp/a');
    row.submit('/tmp/b');
    expect(row.writes).toEqual(['/tmp/b', '/tmp/b']);
  });

  it('does not write back a value an outside writer restored after our save landed', () => {
    // ABA. Disk holds A; we save B; the query catches up and reports B
    // — our own write landing, the ordinary path. Then the TUI (or a
    // second window) puts A back and the query reports A. The field now
    // displays A, and blurring it must not write anything: A is already
    // what is on disk. Treating our B as still-pending here republishes
    // it over the outside writer's A.
    const row = fieldRow('/tmp/a');
    row.submit('/tmp/b');
    row.refetch('/tmp/b');
    row.refetch('/tmp/a');
    row.submit('/tmp/a');
    expect(row.writes).toEqual(['/tmp/b']);
  });
});
