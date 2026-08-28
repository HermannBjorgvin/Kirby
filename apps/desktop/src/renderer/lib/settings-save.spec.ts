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
  let pending: PendingSave | null = null;
  const writes: string[] = [];
  return {
    /** The settings query came back — our own save, or someone else's. */
    refetch(value: string) {
      server = value;
    },
    /** Blur, Enter, or a select changing. */
    submit(value: string) {
      if (value === persistedValue(server, pending)) return;
      pending = { base: server, value };
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
});
