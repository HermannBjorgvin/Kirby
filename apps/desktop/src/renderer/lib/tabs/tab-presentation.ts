import type { Tab } from './tab-identity.js';

/**
 * How the strip presents a set of tabs that spans repositories.
 *
 * Pure, and separate from the strip itself: what reads as "these two
 * tabs belong to different repos" is a property of the sequence, not of
 * either tab, and getting it from a component means recomputing it per
 * tab from the neighbour's props.
 */

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
