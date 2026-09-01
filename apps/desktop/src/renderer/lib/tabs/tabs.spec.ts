import { describe, expect, it } from 'vitest';
import {
  EMPTY_TABS,
  activeTabRepo,
  autoOpenKey,
  itemTabId,
  reduce,
  type ItemEntry,
  type TabsState,
} from './tabs-model.js';

/** The repository every case below is about unless it says otherwise. */
const REPO = '/repos/alpha';
const OTHER = '/repos/beta';

/** The id the strip gives `itemKey` in `repo`. */
const id = (itemKey: string, repo = REPO) => itemTabId(repo, itemKey);

const open = (
  state: TabsState,
  itemKey: string,
  preview = false,
  repo = REPO
) => reduce(state, { type: 'open-item', repo, itemKey, preview });

const sync = (state: TabsState, entries: ItemEntry[], repo = REPO) =>
  reduce(state, { type: 'sync-items', repo, entries });

const empty: TabsState = EMPTY_TABS;

describe('sync-items', () => {
  it('re-keys a worktree tab when its branch grows a PR', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
    // Original id survives so the mounted pane doesn't remount.
    expect(tab.id).toBe(id('branch:feat-x'));
    expect(s.activeId).toBe(id('branch:feat-x'));
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
    s = reduce(s, {
      type: 'open-item',
      repo: REPO,
      itemKey: 'pr:42',
      preview: false,
    });
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

describe('sync-items opens a tab per running agent', () => {
  const live: ItemEntry = {
    itemKey: 'branch:feat-x',
    branch: 'feat-x',
    sessionName: 'kirby-feat-x',
    running: true,
  };

  it('opens a pinned tab for an agent it has not seen before', () => {
    const s = sync(empty, [live]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe(id('branch:feat-x'));
    expect(s.tabs[0].preview).toBe(false);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('leaves an idle worktree alone even though it has a session name', () => {
    // Every worktree row carries a session name whether or not an agent
    // was ever started; only `running` means there is one.
    const s = sync(empty, [{ ...live, running: false }]);
    expect(s.tabs).toEqual([]);
  });

  it('does not reopen a tab the user closed while the agent runs', () => {
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close', id: id('branch:feat-x') });
    expect(s.tabs).toEqual([]);
    // The sidebar keeps reporting the agent on every poll.
    s = sync(s, [live]);
    s = sync(s, [live]);
    expect(s.tabs).toEqual([]);
  });

  it('does not reopen running agents after Close All', () => {
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close-all' });
    s = sync(s, [live]);
    expect(s.tabs).toEqual([]);
  });

  it('does not activate a tab the user already opened when its agent starts', () => {
    let s = open(empty, 'branch:feat-x');
    s = open(s, 'branch:other');
    s = sync(s, [live, { itemKey: 'branch:other', branch: 'other' }]);
    expect(s.activeId).toBe(id('branch:other'));
  });

  it('reopens once the agent stops and a new one starts', () => {
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close-all' });
    s = sync(s, [{ ...live, running: false }]);
    expect(s.tabs).toEqual([]);
    // A different session on the same item is a new agent — but still
    // only once it is actually running.
    s = sync(s, [{ ...live, sessionName: 'kirby-feat-x-2', running: false }]);
    expect(s.tabs).toEqual([]);
    s = sync(s, [{ ...live, sessionName: 'kirby-feat-x-2' }]);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('does not steal activation from the tab the user is looking at', () => {
    let s = open(empty, 'branch:other');
    s = sync(s, [{ itemKey: 'branch:other', branch: 'other' }, live]);
    // The agent's tab opened…
    expect(s.tabs.map((t) => t.id)).toContain(id('branch:feat-x'));
    s = reduce(s, { type: 'activate', id: id('branch:other') });
    // …and does not grab focus back on the next poll.
    s = sync(s, [{ itemKey: 'branch:other', branch: 'other' }, live]);
    expect(s.activeId).toBe(id('branch:other'));
  });

  it('keeps one tab when the running item is re-keyed by a PR', () => {
    let s = sync(empty, [live]);
    s = sync(s, [{ ...live, itemKey: 'pr:42' }]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind === 'item' && s.tabs[0].itemKey).toBe('pr:42');
    // The id is what keeps the agent's terminal pane mounted.
    expect(s.tabs[0].id).toBe(id('branch:feat-x'));
  });

  it('does not follow a collapsed duplicate when its agent starts', () => {
    // The discriminating case for *which* strip the already-open guard
    // is asked about. Three tabs; `branch:x` and `pr:1` are the same
    // item under two identities, so this sync re-keys `branch:x` to
    // `pr:1` and collapses the hand-opened `pr:1` tab into it. The
    // collapsed tab is the one carrying the id `item:pr:1` — the very
    // id auto-open reads to decide the agent already has a tab.
    //
    // Collapsing a duplicate is not the user closing a tab, so it must
    // not hand auto-open a licence to move the focus. The guard is
    // asked about the strip as it stood before re-keying, where
    // `item:pr:1` was open, and the answer is: leave it alone.
    const entries: ItemEntry[] = [
      { itemKey: 'branch:c', branch: 'c' },
      { itemKey: 'pr:1', branch: 'x', sessionName: 'kirby-x', running: true },
    ];
    let s = open(empty, 'branch:c');
    s = open(s, 'branch:x');
    s = open(s, 'pr:1');
    s = reduce(s, { type: 'activate', id: id('branch:c') });
    expect(s.activeId).toBe(id('branch:c'));

    s = sync(s, entries);

    // The duplicate collapsed, as it always did…
    expect(s.tabs.map((t) => t.id)).toEqual([id('branch:c'), id('branch:x')]);
    // …and the session counts as auto-opened, so a later poll can't
    // retry the move.
    expect(s.autoOpened).toContain(autoOpenKey(REPO, 'kirby-x'));
    // …but the user is still looking at what they were looking at.
    expect(s.activeId).toBe(id('branch:c'));

    s = sync(s, entries);
    expect(s.activeId).toBe(id('branch:c'));
  });
});

describe('sync-items pins previews with a live agent', () => {
  it('pins a preview tab once an agent is running on its branch', () => {
    let s = open(empty, 'branch:feat-x', true);
    s = sync(s, [
      {
        itemKey: 'branch:feat-x',
        branch: 'feat-x',
        sessionName: 'kirby-feat-x',
        running: true,
      },
    ]);
    expect(s.tabs[0].preview).toBe(false);
  });

  it('leaves a preview tab previewable while nothing runs on it', () => {
    // The bug this replaced pinned on the *presence* of a session name,
    // which every worktree has — so preview replacement never happened.
    let s = open(empty, 'branch:feat-x', true);
    s = sync(s, [
      {
        itemKey: 'branch:feat-x',
        branch: 'feat-x',
        sessionName: 'kirby-feat-x',
      },
    ]);
    expect(s.tabs[0].preview).toBe(true);

    // …so the next single click still replaces it rather than stacking.
    s = open(s, 'branch:other', true);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind === 'item' && s.tabs[0].itemKey).toBe('branch:other');
  });

  it('pins a preview whose own row has no agent but whose branch does', () => {
    // A PR row and its worktree row are separate items on one branch;
    // the host attaches the live session to whichever it knows about.
    let s = open(empty, 'pr:42', true);
    s = sync(s, [
      { itemKey: 'pr:42', branch: 'feat-x' },
      {
        itemKey: 'branch:feat-x',
        branch: 'feat-x',
        sessionName: 'kirby-feat-x',
        running: true,
      },
    ]);
    const pr = s.tabs.find((t) => t.kind === 'item' && t.itemKey === 'pr:42');
    expect(pr?.preview).toBe(false);
  });
});

describe('open-item after re-key', () => {
  it('activates the re-keyed tab instead of duplicating it', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    s = open(s, 'pr:42');
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('reuses the re-keyed tab when its original key is opened again', () => {
    // Found by the property test: the palette opens `branch:x` whenever
    // the branch is not in the sidebar model yet, which after a re-key
    // produced a second tab carrying the first one's id. Panes are
    // keyed by tab id, so the two rendered each other's content.
    let state: TabsState = EMPTY_TABS;
    state = reduce(state, {
      type: 'open-item',
      repo: REPO,
      itemKey: 'branch:a',
      preview: false,
    });
    state = reduce(state, {
      type: 'sync-items',
      repo: REPO,
      entries: [{ itemKey: 'pr:1', branch: 'a' }],
    });
    state = reduce(state, {
      type: 'open-item',
      repo: REPO,
      itemKey: 'branch:a',
      preview: false,
    });

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe(id('branch:a'));
    expect(state.tabs[0].kind === 'item' && state.tabs[0].itemKey).toBe('pr:1');
    expect(state.activeId).toBe(id('branch:a'));
  });

  describe('reordering by drag', () => {
    const three = (): TabsState => {
      let state: TabsState = EMPTY_TABS;
      for (const key of ['a', 'b', 'c']) {
        state = reduce(state, {
          type: 'open-item',
          repo: REPO,
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
        id: id('a'),
        targetId: id('c'),
        side: 'after',
      });
      expect(order(state)).toEqual(['b', 'c', 'a']);
    });

    it('drops a tab before its target', () => {
      const state = reduce(three(), {
        type: 'move',
        id: id('c'),
        targetId: id('a'),
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
        id: id('a'),
        targetId: id('c'),
        side: 'before',
      });
      expect(order(state)).toEqual(['b', 'a', 'c']);
    });

    it('handles a short backwards move without losing the tab', () => {
      // Removing the dragged tab shifts every later index down by one,
      // which is exactly where an off-by-one would land.
      const state = reduce(three(), {
        type: 'move',
        id: id('b'),
        targetId: id('c'),
        side: 'after',
      });
      expect(order(state)).toEqual(['a', 'c', 'b']);
    });

    it('ignores a drop onto itself', () => {
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: id('b'),
        targetId: id('b'),
        side: 'after',
      });
      expect(after).toBe(before);
    });

    it('ignores a drop onto a tab that is gone', () => {
      // The dragged tab must come back, not vanish with the failed move.
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: id('a'),
        targetId: id('missing'),
        side: 'after',
      });
      expect(order(after)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the active tab active wherever it lands', () => {
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: before.activeId as string,
        targetId: id('a'),
        side: 'before',
      });
      expect(after.activeId).toBe(before.activeId);
      expect(after.tabs.some((t) => t.id === after.activeId)).toBe(true);
    });
  });
});

describe('tabs across repositories', () => {
  const live: ItemEntry = {
    itemKey: 'branch:main',
    branch: 'main',
    sessionName: 'main',
    running: true,
  };

  it('keeps two repos on the same branch name as two tabs', () => {
    // Both repositories have a `main`, so both sidebars produce
    // `branch:main`. One tab each, or the second repo's click lands on
    // the first repo's pane.
    let s = open(empty, 'branch:main');
    s = open(s, 'branch:main', false, OTHER);
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main'),
      id('branch:main', OTHER),
    ]);
    expect(s.activeId).toBe(id('branch:main', OTHER));
  });

  it('re-opening a foreign item activates its own tab, not the local one', () => {
    let s = open(empty, 'branch:main');
    s = open(s, 'branch:main', false, OTHER);
    s = open(s, 'branch:main');
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(id('branch:main'));
  });

  it('syncing one repo leaves the other repo’s tabs untouched', () => {
    let s = open(empty, 'branch:main', false, OTHER);
    s = open(s, 'branch:feat-x');
    // The other repo has no `feat-x`, and this repo's sidebar says
    // nothing about `main` over there.
    const before = s.tabs.find((t) => t.id === id('branch:main', OTHER));
    s = sync(s, [{ itemKey: 'pr:7', branch: 'feat-x' }]);
    expect(s.tabs.find((t) => t.id === id('branch:main', OTHER))).toBe(before);
  });

  it('never follows a foreign tab onto a same-named local branch', () => {
    // The regression this guards: `branch:main` in the other repo is a
    // stale key here, and the branch stamp resolves to *this* repo's
    // pull request. Re-keying it would point the tab at another
    // repository's PR, and collapse it into the local tab.
    let s = open(empty, 'branch:main', false, OTHER);
    s = sync(s, [{ itemKey: 'pr:7', branch: 'main' }]);
    const foreign = s.tabs.find((t) => t.id === id('branch:main', OTHER));
    expect(foreign?.kind === 'item' && foreign.itemKey).toBe('branch:main');
    expect(foreign?.kind === 'item' && foreign.repo).toBe(OTHER);
  });

  it('auto-opens the same session name once per repository', () => {
    // The PTY registry keys sessions by bare branch name, so both
    // repos' agents are called `main`. One tab each.
    let s = sync(empty, [live]);
    s = sync(s, [live], OTHER);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main'),
      id('branch:main', OTHER),
    ]);
    expect(s.autoOpened).toEqual([
      autoOpenKey(REPO, 'main'),
      autoOpenKey(OTHER, 'main'),
    ]);
  });

  it('does not reopen a closed foreign tab when its repo is opened again', () => {
    let s = sync(empty, [live], OTHER);
    s = reduce(s, { type: 'close', id: id('branch:main', OTHER) });
    s = sync(s, [live], OTHER);
    expect(s.tabs).toEqual([]);
  });

  it('does not pin the other repo’s preview tab on a live local agent', () => {
    let s = open(empty, 'branch:main', true, OTHER);
    s = sync(s, [live]);
    const foreign = s.tabs.find((t) => t.id === id('branch:main', OTHER));
    expect(foreign?.preview).toBe(true);
  });

  it('keeps a preview tab per repository', () => {
    // Previewing here must not swallow a tab the user can no longer
    // see — preview replacement is scoped to the repo it happens in.
    let s = open(empty, 'branch:main', true, OTHER);
    s = open(s, 'branch:feat-x', true);
    s = open(s, 'branch:feat-y', true);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main', OTHER),
      id('branch:feat-y'),
    ]);
  });

  it('closes, closes-others and closes-all across the whole strip', () => {
    let s = open(empty, 'branch:main', false, OTHER);
    s = open(s, 'branch:feat-x');
    s = reduce(s, { type: 'close-others', id: id('branch:main', OTHER) });
    expect(s.tabs.map((t) => t.id)).toEqual([id('branch:main', OTHER)]);
    expect(s.activeId).toBe(id('branch:main', OTHER));

    s = reduce(s, { type: 'close', id: id('branch:main', OTHER) });
    expect(s.tabs).toEqual([]);
  });
});

describe('activeTabRepo', () => {
  it('names the repository of the active tab', () => {
    const s = open(open(empty, 'branch:a'), 'branch:b', false, OTHER);
    expect(activeTabRepo(s)).toBe(OTHER);
  });

  it('is null for settings, which belongs to no repository', () => {
    const s = reduce(open(empty, 'branch:a'), { type: 'open-settings' });
    expect(activeTabRepo(s)).toBeNull();
  });

  it('is null when the strip is empty', () => {
    expect(activeTabRepo(empty)).toBeNull();
  });
});
