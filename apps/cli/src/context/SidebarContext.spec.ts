import { describe, it, expect } from 'vitest';
import type { SidebarItem, AgentSession } from '../types.js';
import { resolveSelectedIndex } from './SidebarContext.js';

function session(name: string): SidebarItem {
  const s: AgentSession = { name, running: false };
  return { kind: 'session', session: s, isMerged: false };
}

describe('resolveSelectedIndex', () => {
  it('returns 0 when the list is empty', () => {
    expect(resolveSelectedIndex([], null, 0)).toBe(0);
    expect(resolveSelectedIndex([], 'session:foo', 5)).toBe(0);
  });

  it('returns 0 when selectedKey is null', () => {
    const items = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(items, null, 2)).toBe(0);
  });

  it('follows the selected item across a reorder', () => {
    const before = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(before, 'session:b', 0)).toBe(1);

    const after = [session('c'), session('b'), session('a')];
    expect(resolveSelectedIndex(after, 'session:b', 1)).toBe(1);

    const swapped = [session('b'), session('a'), session('c')];
    expect(resolveSelectedIndex(swapped, 'session:b', 1)).toBe(0);
  });

  it('falls back to lastValidIndex when the selected item was removed', () => {
    const before = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(before, 'session:b', 0)).toBe(1);

    // 'b' is gone → lastValidIndex (1) maps to current items[1] = 'c'.
    const after = [session('a'), session('c')];
    expect(resolveSelectedIndex(after, 'session:b', 1)).toBe(1);
  });

  it('clamps the fallback to the new list length', () => {
    const before = [session('a'), session('b'), session('c')];
    // Selected the last row, then that row and the two before it get
    // deleted, leaving only one item.
    expect(resolveSelectedIndex(before, 'session:c', 2)).toBe(2);

    const after = [session('a')];
    expect(resolveSelectedIndex(after, 'session:c', 2)).toBe(0);
  });

  it('clamps negative lastValidIndex to 0', () => {
    const items = [session('a'), session('b')];
    // Fallback path (missing key) with an unexpected negative fallback
    // still produces a valid index — guards against ref drift.
    expect(resolveSelectedIndex(items, 'session:missing', -3)).toBe(0);
  });

  it('returns 0 when the key matches no item and lastValidIndex is 0', () => {
    const items = [session('a'), session('b')];
    expect(resolveSelectedIndex(items, 'session:missing', 0)).toBe(0);
  });
});
