import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemTabId } from './tab-identity.js';
import {
  EMPTY_TABS,
  reduce,
  type ItemEntry,
  type Tab,
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
 *
 * The strip also spans repositories — it keeps the tabs of the repo you
 * switched away from — and both repos below deliberately use the same
 * item keys, session names and branch names, because that is what two
 * checkouts of anything actually look like. Every sequence therefore
 * also asserts that one repo's sidebar poll cannot reach the other
 * repo's tabs.
 */

const KEYS = ['branch:a', 'branch:b', 'pr:1', 'pr:2'] as const;
const REPOS = ['/repos/alpha', '/repos/beta'] as const;

/** Every id the actions below can name, in either repository. */
const IDS = [
  'settings',
  ...REPOS.flatMap((repo) => KEYS.map((k) => itemTabId(repo, k))),
];

const action: fc.Arbitrary<TabsAction> = fc.oneof(
  fc.record({
    type: fc.constant('open-item' as const),
    repo: fc.constantFrom(...REPOS),
    itemKey: fc.constantFrom(...KEYS),
    preview: fc.boolean(),
  }),
  fc.record({ type: fc.constant('open-settings' as const) }),
  fc.record({
    type: fc.constant('pin' as const),
    id: fc.constantFrom(...IDS),
  }),
  fc.record({
    type: fc.constant('activate' as const),
    id: fc.constantFrom(...IDS),
  }),
  fc.record({
    type: fc.constant('close' as const),
    id: fc.constantFrom(...IDS),
    repo: fc.constantFrom(...REPOS),
  }),
  fc.record({
    type: fc.constant('close-others' as const),
    id: fc.constantFrom(...IDS),
  }),
  fc.record({ type: fc.constant('close-all' as const) }),
  // Switching repository. Included because it is the one action that
  // may leave nothing active, and because everything else has to keep
  // holding across it.
  fc.record({
    type: fc.constant('repo-opened' as const),
    repo: fc.constantFrom(...REPOS),
  }),
  // Drag-to-reorder. Included because a reorder that drops or
  // duplicates a tab breaks the same invariants everything else here
  // protects.
  fc.record({
    type: fc.constant('move' as const),
    id: fc.constantFrom(...IDS),
    targetId: fc.constantFrom(...IDS),
    side: fc.constantFrom<'before' | 'after'>('before', 'after'),
  }),
  // The interesting one: the sidebar re-keying items underneath, and
  // agents coming and going on them — `sync-items` opens a tab for a
  // newly running agent and pins previews that have one, so those run
  // against the same invariants as everything else.
  fc
    .record({
      repo: fc.constantFrom(...REPOS),
      entries: fc.array(
        fc.constantFrom<ItemEntry>(
          { itemKey: 'branch:a', branch: 'a' },
          { itemKey: 'pr:1', branch: 'a' },
          { itemKey: 'branch:b', branch: 'b' },
          { itemKey: 'pr:2', branch: 'b' },
          {
            itemKey: 'branch:a',
            branch: 'a',
            sessionName: 'sa',
            running: true,
          },
          { itemKey: 'pr:1', branch: 'a', sessionName: 'sa', running: true },
          {
            itemKey: 'branch:b',
            branch: 'b',
            sessionName: 'sb',
            running: true,
          },
          { itemKey: 'pr:2', branch: 'b', sessionName: 'sb', running: true },
          // A worktree that has a session name but no live agent — the
          // shape that once pinned every preview tab on sight.
          { itemKey: 'branch:a', branch: 'a', sessionName: 'sa' }
        ),
        { maxLength: 4 }
      ),
    })
    .map(({ repo, entries }) => ({
      type: 'sync-items' as const,
      repo,
      entries,
    }))
);

const EMPTY: TabsState = EMPTY_TABS;

/**
 * Replay a sequence the way the app dispatches one.
 *
 * Every repo-carrying action names the repository *in view* — the
 * components dispatching them read it from context, and only a repo
 * switch changes which that is. Letting the generator pick those repos
 * independently manufactures states the app cannot reach (a sidebar
 * poll for a repository nobody is looking at, a close naming one the
 * user is not in), and the invariants below are about reachable
 * states. So the in-view repo is tracked here and substituted in.
 *
 * Cross-repo adversity is not lost: `repo-opened` still switches the
 * repo mid-sequence, and the properties that deliberately aim one
 * action at a *foreign* repo apply it to the finished state themselves.
 */
const inViewOf = (a: TabsAction, repo: string): TabsAction =>
  a.type === 'open-item' || a.type === 'sync-items' || a.type === 'close'
    ? { ...a, repo }
    : a;

const replay = (
  actions: TabsAction[]
): { state: TabsState; inView: string } => {
  // The app has a repo open before the strip exists: `Gate` announces
  // one on mount, so there is no "no repo in view" state to model.
  let inView: string = REPOS[0];
  let state = EMPTY;
  for (const a of actions) {
    if (a.type === 'repo-opened') inView = a.repo;
    state = reduce(state, inViewOf(a, inView));
  }
  return { state, inView };
};

const run = (actions: TabsAction[]): TabsState => replay(actions).state;

const sequence = fc.array(action, { maxLength: 25 });

describe('tab reducer invariants', () => {
  it('never holds two tabs for the same item', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        // Repo-qualified: the same item key in two repositories is two
        // items, and both are entitled to a tab.
        const keys = run(actions)
          .tabs.filter((t) => t.kind === 'item')
          .map((t) => itemTabId(t.repo, t.itemKey));
        // A re-key that produced a second tab for one item is exactly
        // the duplicate-tab bug.
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 500 }
    );
  });

  it('never lets a tab change repository', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        for (const t of run(actions).tabs) {
          if (t.kind !== 'item') continue;
          // Re-keying keeps the id a tab was opened with, so the id is
          // the record of which repo opened it. A tab whose `repo` and
          // id disagree has been followed across repositories — onto
          // another checkout's branch of the same name.
          expect(t.id.startsWith(itemTabId(t.repo, ''))).toBe(true);
        }
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

  it('goes without an active tab only when the repo in view has none', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { state, inView } = replay(actions);
        if (state.activeId !== null) return;
        // Nothing active is legitimate in exactly one situation: the
        // repository in view has no tab on the strip, so the editor
        // shows its empty state while other repos' tabs stay put.
        // Anywhere else it is a blank editor area with tabs above it.
        const own = state.tabs.filter(
          (t) => t.kind === 'item' && t.repo === inView
        );
        expect(own).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });

  it('activates one of a repository’s own tabs when it comes into view', () => {
    fc.assert(
      fc.property(sequence, fc.constantFrom(...REPOS), (actions, repo) => {
        const state = reduce(run(actions), { type: 'repo-opened', repo });
        const own = state.tabs.filter(
          (t) => t.kind === 'item' && t.repo === repo
        );
        if (own.length === 0) return;
        const active = state.tabs.find((t) => t.id === state.activeId);
        // Either one of this repo's tabs, or the settings tab — which
        // belongs to nobody and so is never displaced by a switch.
        expect(
          active?.kind === 'settings' ||
            (active?.kind === 'item' && active.repo === repo)
        ).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('returns a repository to the tab it was left on', () => {
    fc.assert(
      fc.property(sequence, fc.constantFrom(...REPOS), (actions, away) => {
        const before = run(actions);
        const active = before.tabs.find((t) => t.id === before.activeId);
        if (active?.kind !== 'item' || active.repo === away) return;
        // Leave for the other repository and come back.
        const there = reduce(before, { type: 'repo-opened', repo: away });
        const back = reduce(there, { type: 'repo-opened', repo: active.repo });
        expect(back.activeId).toBe(before.activeId);
      }),
      { numRuns: 300 }
    );
  });

  it('keeps at most one preview tab per repository', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        for (const repo of REPOS) {
          const previews = run(actions).tabs.filter(
            (t) => t.preview && t.kind === 'item' && t.repo === repo
          );
          // Two preview tabs in one repo means the next single click
          // there replaces an unpredictable one of them. Across repos
          // they are independent: a click here must not swallow a tab
          // the user can no longer see.
          expect(previews.length).toBeLessThanOrEqual(1);
        }
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

describe('one repository cannot reach another', () => {
  /** The strip as the repos *other* than `repo` see it. */
  const foreign = (state: TabsState, repo: string): Tab[] =>
    state.tabs.filter((t) => t.kind === 'item' && t.repo !== repo);

  it('leaves every other repo’s tabs exactly as they were on sync', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...REPOS),
        fc.array(
          fc.constantFrom<ItemEntry>(
            { itemKey: 'branch:a', branch: 'a' },
            { itemKey: 'pr:1', branch: 'a', sessionName: 'sa', running: true },
            { itemKey: 'branch:b', branch: 'b', sessionName: 'sb' }
          ),
          { maxLength: 4 }
        ),
        (actions, repo, entries) => {
          const before = run(actions);
          const after = reduce(before, { type: 'sync-items', repo, entries });
          // Identity, not equality: a foreign tab that came out
          // re-keyed, re-pinned or merely rebuilt has been touched by a
          // poll about a repository it has nothing to do with.
          expect(foreign(after, repo)).toEqual(foreign(before, repo));
          for (const [i, t] of foreign(after, repo).entries()) {
            expect(t).toBe(foreign(before, repo)[i]);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('never drops a tab belonging to a repository it was not told about', () => {
    fc.assert(
      fc.property(sequence, fc.constantFrom(...REPOS), (actions, repo) => {
        const before = run(actions);
        const after = reduce(before, {
          type: 'sync-items',
          repo,
          entries: [],
        });
        // An empty sidebar over here is not a reason to close tabs
        // over there — their agents are still running.
        expect(foreign(after, repo).length).toBe(foreign(before, repo).length);
      }),
      { numRuns: 300 }
    );
  });
});

describe('closing never hands focus to another repository', () => {
  /**
   * A close only decides focus when it closes the *active* tab —
   * otherwise activeId is left exactly where it was, foreign or not
   * (activating a foreign tab is how the user switches repository in
   * the first place). So both properties below are about the move.
   */
  const closeAndMove = (
    actions: TabsAction[],
    id: string,
    repo: string
  ): TabsState | null => {
    const before = run(actions);
    const after = reduce(before, { type: 'close', id, repo });
    return after.activeId === before.activeId ? null : after;
  };

  it('never moves focus onto a tab outside the repo the close named', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...IDS),
        fc.constantFrom(...REPOS),
        (actions, id, repo) => {
          const after = closeAndMove(actions, id, repo);
          const active = after?.tabs.find((t) => t.id === after.activeId);
          if (active === undefined || active.kind !== 'item') return;
          // Focus is what the workspace follows, so a close that hands
          // it across a repository boundary switches the sidebar, the
          // status bar and every query — because the user shut a tab.
          expect(active.repo).toBe(repo);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('goes to nothing rather than abroad when the repo runs out of tabs', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...IDS),
        fc.constantFrom(...REPOS),
        (actions, id, repo) => {
          const after = closeAndMove(actions, id, repo);
          if (after === null || after.activeId !== null) return;
          const own = after.tabs.filter(
            (t) => t.kind === 'item' && t.repo === repo
          );
          expect(own).toEqual([]);
        }
      ),
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
          repo: REPOS[0],
          itemKey: keys[0],
          preview: false,
        });
        const openedId = state.tabs[0].id;

        for (const key of keys) {
          state = reduce(state, {
            type: 'sync-items',
            repo: REPOS[0],
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
          repo: REPOS[0],
          itemKey: key,
          preview: false,
        });
        state = reduce(state, {
          type: 'sync-items',
          repo: REPOS[0],
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
      repo: REPOS[0],
      itemKey: 'branch:a',
      preview: false,
    });
    state = reduce(state, {
      type: 'open-item',
      repo: REPOS[0],
      itemKey: 'pr:1',
      preview: false,
    });
    expect(state.tabs).toHaveLength(2);

    state = reduce(state, {
      type: 'sync-items',
      repo: REPOS[0],
      entries: [{ itemKey: 'pr:1', branch: 'a' }],
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs.some((t) => t.id === state.activeId)).toBe(true);
  });
});
