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
});
