import { describe, it, expect } from 'vitest';
import { diffRebaseWarnings } from './useMergedBranches.js';

describe('diffRebaseWarnings', () => {
  it('warns for every newly-rebasing branch on first sight', () => {
    const { toWarn, nextWarned } = diffRebaseWarnings(['a', 'b'], new Set());
    expect(toWarn).toEqual(['a', 'b']);
    expect(nextWarned).toEqual(new Set(['a', 'b']));
  });

  it('does not re-warn a branch already warned last sync', () => {
    const { toWarn, nextWarned } = diffRebaseWarnings(['a'], new Set(['a']));
    expect(toWarn).toEqual([]);
    expect(nextWarned).toEqual(new Set(['a']));
  });

  it('warns only the newly-rebasing branch alongside already-warned ones', () => {
    const { toWarn, nextWarned } = diffRebaseWarnings(
      ['a', 'b'],
      new Set(['a'])
    );
    expect(toWarn).toEqual(['b']);
    expect(nextWarned).toEqual(new Set(['a', 'b']));
  });

  it('drops a branch from the warned set once it is no longer rebasing', () => {
    // Rebase finished (or worktree deleted): forget it so a future
    // rebase of the same branch warns again rather than staying silent.
    const { toWarn, nextWarned } = diffRebaseWarnings([], new Set(['a']));
    expect(toWarn).toEqual([]);
    expect(nextWarned).toEqual(new Set());
  });

  it('re-warns a branch that stopped and then resumed rebasing', () => {
    const first = diffRebaseWarnings(['a'], new Set());
    const resolved = diffRebaseWarnings([], first.nextWarned);
    const resumed = diffRebaseWarnings(['a'], resolved.nextWarned);
    expect(resumed.toWarn).toEqual(['a']);
  });
});
