import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem } from '../../../host/contract.js';
import {
  repoDisplayName,
  repoGroupStarts,
  tabPresentation,
  tabRepo,
} from './tab-presentation.js';
import { itemTabId } from './tab-identity.js';
import type { ItemTab, Tab } from './tabs-model.js';

const A = '/repos/alpha';
const B = '/repos/beta';

const item = (repo: string, itemKey: string): Tab => ({
  id: itemTabId(repo, itemKey),
  kind: 'item',
  repo,
  itemKey,
  preview: false,
});

const settings: Tab = { id: 'settings', kind: 'settings', preview: false };

describe('repoDisplayName', () => {
  it('is the checkout directory name', () => {
    expect(repoDisplayName('/home/dev/code/kirby')).toBe('kirby');
  });

  it('ignores a trailing separator', () => {
    expect(repoDisplayName('/home/dev/code/kirby/')).toBe('kirby');
  });

  it('handles a Windows path', () => {
    expect(repoDisplayName('C:\\src\\kirby')).toBe('kirby');
  });

  it('falls back to the path when there is nothing to take', () => {
    expect(repoDisplayName('/')).toBe('/');
  });
});

describe('repoGroupStarts', () => {
  it('never starts a group on the leftmost tab', () => {
    expect(repoGroupStarts([item(A, 'branch:x'), item(A, 'branch:y')])).toEqual(
      [false, false]
    );
  });

  it('starts one where the repository changes', () => {
    expect(repoGroupStarts([item(A, 'branch:x'), item(B, 'branch:x')])).toEqual(
      [false, true]
    );
  });

  it('starts one again when the strip returns to a repo', () => {
    // Tabs are reorderable, so a repo's tabs are not guaranteed to be
    // one contiguous run — each run gets its own separator.
    expect(
      repoGroupStarts([
        item(A, 'branch:x'),
        item(B, 'branch:x'),
        item(A, 'pr:1'),
      ])
    ).toEqual([false, true, true]);
  });

  it('lets settings sit inside a group without breaking it', () => {
    // Settings belongs to no repository: it neither starts a group nor
    // makes the tab after it look like a new one.
    expect(
      repoGroupStarts([item(A, 'branch:x'), settings, item(A, 'pr:1')])
    ).toEqual([false, false, false]);
  });

  it('is empty for an empty strip', () => {
    expect(repoGroupStarts([])).toEqual([]);
  });
});

describe('tabRepo', () => {
  it('names an item tab’s repository', () => {
    expect(tabRepo(item(A, 'branch:x'))).toBe(A);
  });

  it('is null for settings', () => {
    expect(tabRepo(settings)).toBeNull();
  });
});

describe('tabPresentation', () => {
  const pr = { id: 42, title: 'Add undo support' } as PullRequestInfo;
  const withPr: SidebarItem = {
    kind: 'session',
    session: { name: 'feat-undo', running: false },
    pr,
    branch: 'feat-undo',
    isMerged: false,
  };
  const bare: SidebarItem = {
    kind: 'session',
    session: { name: 'feat-undo', running: false },
    branch: 'feat-undo',
    isMerged: false,
  };
  const tab = (extra: Partial<ItemTab> = {}): Tab => ({
    ...(item(A, 'pr:42') as ItemTab),
    ...extra,
  });

  it('names a tab after its pull request while the item is at hand', () => {
    expect(tabPresentation(tab(), withPr)).toEqual({
      label: 'Add undo support',
      face: 'pr',
    });
    expect(tabPresentation(tab({ itemKey: 'branch:feat-undo' }), bare)).toEqual(
      { label: 'feat-undo', face: 'branch' }
    );
  });

  it('keeps the stamped title once the item is out of reach', () => {
    // A tab of another repository: this sidebar has no row for it, and
    // the strip must not fall back to "42".
    const foreign = tab({ title: 'Add undo support', branch: 'feat-undo' });
    expect(tabPresentation(foreign, undefined)).toEqual({
      label: 'Add undo support',
      face: 'pr',
    });
  });

  it('falls back to the branch, then the bare key', () => {
    expect(tabPresentation(tab({ branch: 'feat-undo' }), undefined).label).toBe(
      'feat-undo'
    );
    expect(tabPresentation(tab(), undefined).label).toBe('42');
  });

  it('names the settings tab', () => {
    const settings: Tab = { id: 'settings', kind: 'settings', preview: false };
    expect(tabPresentation(settings, undefined)).toEqual({
      label: 'Settings',
      face: 'settings',
    });
  });
});
