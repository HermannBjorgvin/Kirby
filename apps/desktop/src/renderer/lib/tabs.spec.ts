import { describe, expect, it } from 'vitest';
import { reduce, type TabsState } from './tabs.js';

const open = (state: TabsState, itemKey: string, preview = false) =>
  reduce(state, { type: 'open-item', itemKey, preview });

const sync = (
  state: TabsState,
  entries: { itemKey: string; branch: string }[]
) => reduce(state, { type: 'sync-items', entries });

const empty: TabsState = { tabs: [], activeId: null };

describe('sync-items', () => {
  it('re-keys a worktree tab when its branch grows a PR', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
    // Original id survives so the mounted pane doesn't remount.
    expect(tab.id).toBe('item:branch:feat-x');
    expect(s.activeId).toBe('item:branch:feat-x');
  });

  it('re-keys back when the PR closes, via the stamped branch', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    s = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('branch:feat-x');
  });

  it('merges with an already-open tab for the new key', () => {
    let s = open(empty, 'branch:feat-x');
    s = open(s, 'pr:42'); // user opened the PR by hand; now active
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
    // The dropped duplicate was active; activity follows the survivor.
    expect(s.activeId).toBe(tab.id);
  });

  it('a pinned duplicate pins the surviving preview tab', () => {
    let s = open(empty, 'branch:feat-x', true); // preview
    s = reduce(s, { type: 'open-item', itemKey: 'pr:42', preview: false });
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.preview).toBe(false);
  });

  it('returns the same state when nothing changed', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    const again = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    expect(again).toBe(s);
  });

  it('leaves a tab alone when its item vanished entirely', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'branch:other', branch: 'other' }]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('branch:feat-x');
  });

  it('keeps a tab whose key still resolves, even when a PR key shares the branch', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [
      { itemKey: 'branch:feat-x', branch: 'feat-x' },
      { itemKey: 'pr:42', branch: 'feat-x' },
    ]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('branch:feat-x');
  });

  it('a stale stamped-branch tab migrates to the PR-bearing key', () => {
    // Stamp the branch while the key resolves, then let the key go stale.
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
  });
});

describe('open-item after re-key', () => {
  it('activates the re-keyed tab instead of duplicating it', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    s = open(s, 'pr:42');
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe('item:branch:feat-x');
  });

  it('reuses the re-keyed tab when its original key is opened again', () => {
    // Found by the property test: the palette opens `branch:x` whenever
    // the branch is not in the sidebar model yet, which after a re-key
    // produced a second tab carrying the first one's id. Panes are
    // keyed by tab id, so the two rendered each other's content.
    let state: TabsState = { tabs: [], activeId: null };
    state = reduce(state, {
      type: 'open-item',
      itemKey: 'branch:a',
      preview: false,
    });
    state = reduce(state, {
      type: 'sync-items',
      entries: [{ itemKey: 'pr:1', branch: 'a' }],
    });
    state = reduce(state, {
      type: 'open-item',
      itemKey: 'branch:a',
      preview: false,
    });

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe('item:branch:a');
    expect(state.tabs[0].kind === 'item' && state.tabs[0].itemKey).toBe('pr:1');
    expect(state.activeId).toBe('item:branch:a');
  });

  describe('reordering by drag', () => {
    const three = (): TabsState => {
      let state: TabsState = { tabs: [], activeId: null };
      for (const key of ['a', 'b', 'c']) {
        state = reduce(state, {
          type: 'open-item',
          itemKey: key,
          preview: false,
        });
      }
      return state;
    };
    const order = (state: TabsState) =>
      state.tabs.map((t) => (t.kind === 'item' ? t.itemKey : t.id));

    it('drops a tab after its target', () => {
      const state = reduce(three(), {
        type: 'move',
        id: 'item:a',
        targetId: 'item:c',
        side: 'after',
      });
      expect(order(state)).toEqual(['b', 'c', 'a']);
    });

    it('drops a tab before its target', () => {
      const state = reduce(three(), {
        type: 'move',
        id: 'item:c',
        targetId: 'item:a',
        side: 'before',
      });
      expect(order(state)).toEqual(['c', 'a', 'b']);
    });

    it('drops before a target that sits later in the strip', () => {
      // The discriminating case for the index arithmetic: removing the
      // dragged tab shifts the target down one, so a target index read
      // before the removal inserts a slot too far right and the tab
      // lands after its target instead of before it.
      const state = reduce(three(), {
        type: 'move',
        id: 'item:a',
        targetId: 'item:c',
        side: 'before',
      });
      expect(order(state)).toEqual(['b', 'a', 'c']);
    });

    it('handles a short backwards move without losing the tab', () => {
      // Removing the dragged tab shifts every later index down by one,
      // which is exactly where an off-by-one would land.
      const state = reduce(three(), {
        type: 'move',
        id: 'item:b',
        targetId: 'item:c',
        side: 'after',
      });
      expect(order(state)).toEqual(['a', 'c', 'b']);
    });

    it('ignores a drop onto itself', () => {
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: 'item:b',
        targetId: 'item:b',
        side: 'after',
      });
      expect(after).toBe(before);
    });

    it('ignores a drop onto a tab that is gone', () => {
      // The dragged tab must come back, not vanish with the failed move.
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: 'item:a',
        targetId: 'item:missing',
        side: 'after',
      });
      expect(order(after)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the active tab active wherever it lands', () => {
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: before.activeId as string,
        targetId: 'item:a',
        side: 'before',
      });
      expect(after.activeId).toBe(before.activeId);
      expect(after.tabs.some((t) => t.id === after.activeId)).toBe(true);
    });
  });
});
