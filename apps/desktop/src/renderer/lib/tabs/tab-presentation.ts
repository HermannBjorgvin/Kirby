import type { SidebarItem } from '../../../host/contract.js';
import { itemTitle } from '../sidebar/sidebar-model.js';
import type { Tab } from './tab-identity.js';

/**
 * How the strip presents a set of tabs that spans repositories.
 *
 * Pure, and separate from the strip itself: what reads as "these two
 * tabs belong to different repos" is a property of the sequence, not of
 * either tab, and getting it from a component means recomputing it per
 * tab from the neighbour's props.
 */

/** What a tab is a tab of, as far as its icon is concerned. */
export type TabFace = 'settings' | 'pr' | 'branch';

/**
 * What a tab shows for itself.
 *
 * The item is the live answer, and is preferred: its title follows the
 * pull request as it is renamed. A tab whose item is out of reach — its
 * repository is not the open one, so this sidebar has no row for it —
 * shows the title it was last stamped with, then its branch, and only
 * then the bare key, so a tab never turns back into a slug because the
 * user looked at another repository.
 */
export function tabPresentation(
  tab: Tab,
  item: SidebarItem | undefined
): { label: string; face: TabFace } {
  if (tab.kind === 'settings') return { label: 'Settings', face: 'settings' };
  const label =
    (item ? itemTitle(item) : undefined) ??
    tab.title ??
    tab.branch ??
    tab.itemKey.replace(/^[a-z]+:/, '');
  const isPr = item ? Boolean(item.pr) : tab.itemKey.startsWith('pr:');
  return { label, face: isPr ? 'pr' : 'branch' };
}

/** The repository a tab belongs to, or null for a repo-agnostic tab. */
export function tabRepo(tab: Tab): string | null {
  return tab.kind === 'item' ? tab.repo : null;
}

/** The short name a repository goes by on screen: its directory name. */
export function repoDisplayName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/**
 * Which tabs start a new repository group, positionally.
 *
 * A tab starts a group when the nearest item tab to its left belongs to
 * a different repository — so the leftmost group never draws a
 * separator, and the settings tab (which belongs to no repository)
 * neither starts a group nor breaks the one it sits in.
 */
export function repoGroupStarts(tabs: readonly Tab[]): boolean[] {
  let previous: string | null = null;
  return tabs.map((tab) => {
    const repo = tabRepo(tab);
    if (repo === null) return false;
    const starts = previous !== null && previous !== repo;
    previous = repo;
    return starts;
  });
}
