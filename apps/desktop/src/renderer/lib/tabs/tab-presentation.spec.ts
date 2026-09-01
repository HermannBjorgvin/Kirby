import { describe, expect, it } from 'vitest';
import {
  repoDisplayName,
  repoGroupStarts,
  tabRepo,
} from './tab-presentation.js';
import { itemTabId } from './tab-identity.js';
import type { Tab } from './tabs-model.js';

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
