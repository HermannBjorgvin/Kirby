/**
 * What a tab *is*: its shape, and the identities derived from it.
 *
 * Split from the reducer because these are the answers the rest of
 * the app asks about a tab — which repository it belongs to, whether
 * that is the open one — and none of them involve a transition.
 */
export type Tab =
  | {
      id: string;
      kind: 'item';
      /** Absolute path of the repository this tab belongs to. Half of
       *  the tab's identity: `branch:main` means a different thing in
       *  each open repo. */
      repo: string;
      itemKey: string;
      preview: boolean;
      /** Last-known git branch, stamped by `sync-items`. The stable
       *  identity a tab falls back on when its itemKey goes stale —
       *  a worktree's key changes from `branch:x` to `pr:n` the moment
       *  a PR appears (and back when it closes). */
      branch?: string;
      /** Last-known display title, stamped by `sync-items`. What the
       *  strip shows once the item is out of reach — its repository is
       *  not the open one, so the sidebar cannot describe it — rather
       *  than falling back to a key. */
      title?: string;
    }
  | { id: 'settings'; kind: 'settings'; preview: false };

/** A tab that shows a sidebar item, and so belongs to a repository. */
export type ItemTab = Extract<Tab, { kind: 'item' }>;

/**
 * The id of the tab for `itemKey` in `repo`.
 *
 * Length-prefixed rather than joined on a separator: repository paths
 * and branch names can both contain any punctuation a separator might
 * use, and a collision here is two repos' tabs rendering each other's
 * pane (panes are keyed by tab id).
 */
export function itemTabId(repo: string, itemKey: string): string {
  return `item:${repo.length}:${repo}:${itemKey}`;
}

/** Identity of an item tab as a map key — the same pair, unambiguous. */
export function pairKey(tab: Tab): string {
  return tab.kind === 'item' ? itemTabId(tab.repo, tab.itemKey) : tab.id;
}

/** Whether `tab` belongs to a repository other than the open one.
 *  Settings belongs to none, so it is never foreign. */
export function isForeignTab(tab: Tab, repo: string): boolean {
  return foreignRepoOf(tab, repo) !== null;
}

/** The other repository `tab` belongs to, or null when it is at home. */
export function foreignRepoOf(tab: Tab, repo: string): string | null {
  return tab.kind === 'item' && tab.repo !== repo ? tab.repo : null;
}

/** Identity of an auto-opened session, unique across repositories. */
export function autoOpenKey(repo: string, sessionName: string): string {
  return `${repo.length}:${repo}:${sessionName}`;
}
