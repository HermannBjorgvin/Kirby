import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TABS,
  reduce,
  type ItemEntry,
  type TabsAction,
  type TabsState,
} from './tabs-model.js';

/**
 * Property tests for the tab reducer, alongside the worked cases in
 * tabs.spec.ts.
 *
 * Tabs are keyed by sidebar item, and a sidebar item is re-keyed under
 * the user mid-session: `branch:x` becomes `pr:42` the moment a pull
 * request appears on the branch, and goes back when it closes. Every
 * tab bug on this branch has come from that — a duplicate tab, a tab
 * stranded on a dead key, a tab whose pane unmounted and took a live
 * agent's terminal with it.
 *
 * So rather than adding more example sequences, these run arbitrary
 * ones and assert what has to hold after any of them.
 */

const KEYS = ['branch:a', 'branch:b', 'pr:1', 'pr:2'] as const;

const action: fc.Arbitrary<TabsAction> = fc.oneof(
  fc.record({
    type: fc.constant('open-item' as const),
    itemKey: fc.constantFrom(...KEYS),
    preview: fc.boolean(),
  }),
  fc.record({ type: fc.constant('open-settings' as const) }),
  fc.record({
    type: fc.constant('pin' as const),
    id: fc.constantFrom('settings', ...KEYS.map((k) => `item:${k}`)),
  }),
  fc.record({
    type: fc.constant('activate' as const),
    id: fc.constantFrom('settings', ...KEYS.map((k) => `item:${k}`)),
  }),
  fc.record({
    type: fc.constant('close' as const),
    id: fc.constantFrom('settings', ...KEYS.map((k) => `item:${k}`)),
  }),
  fc.record({
    type: fc.constant('close-others' as const),
    id: fc.constantFrom('settings', ...KEYS.map((k) => `item:${k}`)),
  }),
  fc.record({ type: fc.constant('close-all' as const) }),
  // Drag-to-reorder. Included because a reorder that drops or
  // duplicates a tab breaks the same invariants everything else here
  // protects.
  fc.record({
    type: fc.constant('move' as const),
    id: fc.constantFrom('settings', ...KEYS.map((k) => `item:${k}`)),
    targetId: fc.constantFrom('settings', ...KEYS.map((k) => `item:${k}`)),
    side: fc.constantFrom<'before' | 'after'>('before', 'after'),
  }),
  // The interesting one: the sidebar re-keying items underneath, and
  // agents coming and going on them — `sync-items` opens a tab for a
  // newly running agent and pins previews that have one, so those run
  // against the same invariants as everything else.
  fc
    .array(
      fc.constantFrom<ItemEntry>(
        { itemKey: 'branch:a', branch: 'a' },
        { itemKey: 'pr:1', branch: 'a' },
        { itemKey: 'branch:b', branch: 'b' },
        { itemKey: 'pr:2', branch: 'b' },
        { itemKey: 'branch:a', branch: 'a', sessionName: 'sa', running: true },
        { itemKey: 'pr:1', branch: 'a', sessionName: 'sa', running: true },
        { itemKey: 'branch:b', branch: 'b', sessionName: 'sb', running: true },
        { itemKey: 'pr:2', branch: 'b', sessionName: 'sb', running: true },
        // A worktree that has a session name but no live agent — the
        // shape that once pinned every preview tab on sight.
        { itemKey: 'branch:a', branch: 'a', sessionName: 'sa' }
      ),
      { maxLength: 4 }
    )
    .map((entries) => ({ type: 'sync-items' as const, entries }))
);

const EMPTY: TabsState = EMPTY_TABS;

const run = (actions: TabsAction[]): TabsState => actions.reduce(reduce, EMPTY);

const sequence = fc.array(action, { maxLength: 25 });

describe('tab reducer invariants', () => {
  it('never holds two tabs for the same item', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const keys = run(actions)
          .tabs.filter((t) => t.kind === 'item')
          .map((t) => t.itemKey);
        // A re-key that produced a second tab for one item is exactly
        // the duplicate-tab bug.
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 500 }
    );
  });

  it('never holds two tabs with the same id', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ids = run(actions).tabs.map((t) => t.id);
        // React keys panes by tab id.
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 500 }
    );
  });

  it('always points activeId at a tab that exists', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { tabs, activeId } = run(actions);
        if (activeId === null) return;
        // A dangling activeId renders an empty editor area with tabs
        // still in the strip.
        expect(tabs.some((t) => t.id === activeId)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('has an active tab whenever it has any tabs', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { tabs, activeId } = run(actions);
        expect(activeId === null).toBe(tabs.length === 0);
      }),
      { numRuns: 500 }
    );
  });

  it('keeps at most one preview tab', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const previews = run(actions).tabs.filter((t) => t.preview);
        // Two preview tabs means the next single click replaces an
        // unpredictable one of them.
        expect(previews.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 }
    );
  });

  it('never opens more than one settings tab', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const settings = run(actions).tabs.filter((t) => t.kind === 'settings');
        expect(settings.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 }
    );
  });
});

describe('re-keying preserves the tab', () => {
  /** Every way the sidebar can describe branch `a`. */
  const keyForA = fc.constantFrom('branch:a', 'pr:1');

  it('keeps one tab through any number of key changes', () => {
    fc.assert(
      fc.property(fc.array(keyForA, { minLength: 1, maxLength: 6 }), (keys) => {
        let state = reduce(EMPTY, {
          type: 'open-item',
          itemKey: keys[0],
          preview: false,
        });
        const openedId = state.tabs[0].id;

        for (const key of keys) {
          state = reduce(state, {
            type: 'sync-items',
            entries: [{ itemKey: key, branch: 'a' }],
          });
        }

        // A pull request opening and closing repeatedly must leave one
        // tab, still the one the user opened — its id is what keeps a
        // live agent's terminal pane mounted.
        expect(state.tabs).toHaveLength(1);
        expect(state.tabs[0].id).toBe(openedId);
        expect(state.tabs[0].kind === 'item' && state.tabs[0].itemKey).toBe(
          keys[keys.length - 1]
        );
      }),
      { numRuns: 300 }
    );
  });

  it('stamps the branch so a stale key can still be resolved', () => {
    fc.assert(
      fc.property(keyForA, (key) => {
        let state = reduce(EMPTY, {
          type: 'open-item',
          itemKey: key,
          preview: false,
        });
        state = reduce(state, {
          type: 'sync-items',
          entries: [{ itemKey: key, branch: 'a' }],
        });
        // EditorArea and the close-tab path both fall back to this when
        // the key does not resolve during the render before sync-items
        // catches up.
        expect(state.tabs[0].kind === 'item' && state.tabs[0].branch).toBe('a');
      }),
      { numRuns: 100 }
    );
  });

  it('merges rather than duplicates when both keys are open at once', () => {
    // Opening a branch tab and its PR tab separately, then syncing, has
    // to collapse them — they are one item.
    let state = reduce(EMPTY, {
      type: 'open-item',
      itemKey: 'branch:a',
      preview: false,
    });
    state = reduce(state, {
      type: 'open-item',
      itemKey: 'pr:1',
      preview: false,
    });
    expect(state.tabs).toHaveLength(2);

    state = reduce(state, {
      type: 'sync-items',
      entries: [{ itemKey: 'pr:1', branch: 'a' }],
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs.some((t) => t.id === state.activeId)).toBe(true);
  });
});
