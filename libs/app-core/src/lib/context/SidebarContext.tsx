import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { CategorizedReviews, PullRequestInfo } from '@kirby/vcs-core';
import { branchToSessionName } from '@kirby/worktree-manager';
import type { SidebarItem } from '../types.js';
import { getItemKey, getPrFromItem, isItemActive } from '../types.js';
import { buildSidebarItems } from '../utils/sidebar-items.js';
import { useSessionData } from './SessionContext.js';
import { useConfig } from './ConfigContext.js';

/**
 * Pure resolver for the sidebar's selected index.
 *
 * If the selected key is present in the current items array, return
 * its index. If it's missing (e.g. the item was deleted), fall back
 * to the last valid index clamped to the new list length so the
 * cursor lands on a nearby row. Empty / null-key case returns 0.
 *
 * Extracted so it can be tested without spinning up the full provider
 * tree (SessionContext pulls live git state in).
 */
export function resolveSelectedIndex(
  items: SidebarItem[],
  selectedKey: string | null,
  lastValidIndex: number
): number {
  if (!selectedKey || items.length === 0) return 0;
  const idx = items.findIndex((item) => getItemKey(item) === selectedKey);
  if (idx >= 0) return idx;
  return Math.min(Math.max(0, lastValidIndex), items.length - 1);
}

/**
 * The sidebar's selection anchor.
 *
 * `key` is the identity of the selected row; `index` is the row it
 * resolved to the last time the list was looked at. Both travel
 * together so a delete has somewhere to land: when `key` is gone from
 * `items`, `index` says where it used to be.
 */
export interface SidebarSelection {
  key: string | null;
  index: number;
}

export const INITIAL_SELECTION: SidebarSelection = { key: null, index: 0 };

/**
 * Re-anchor a selection against a new `items` array.
 *
 * Resolves the anchor (key first, index as the delete fallback) and
 * then adopts whatever row that landed on, so the *next* list change
 * follows the row the cursor is actually sitting on rather than the
 * key of a row that no longer exists. Without the adoption step, a
 * delete followed by a re-sort would drag the cursor back to a stale
 * numeric position.
 *
 * Returns the input object unchanged when nothing moved — the caller
 * uses that identity to skip a redundant state write.
 */
export function reconcileSelection(
  items: SidebarItem[],
  selection: SidebarSelection
): SidebarSelection {
  const index = resolveSelectedIndex(items, selection.key, selection.index);
  const item = items[index];
  const key = item ? getItemKey(item) : null;
  if (key === selection.key && index === selection.index) return selection;
  return { key, index };
}

/**
 * Selection produced by an explicit `selectByKey`.
 *
 * A key that isn't in the list yet (the branch picker selects a
 * session the moment it's created, before the sidebar has refreshed)
 * keeps the current row under the cursor and waits — the key wins as
 * soon as its row appears.
 */
export function selectionForKey(
  items: SidebarItem[],
  key: string,
  current: SidebarSelection
): SidebarSelection {
  const index = items.findIndex((item) => getItemKey(item) === key);
  return { key, index: index >= 0 ? index : current.index };
}

/**
 * Translate a `session:${name}` key to a `review:${prId}` key when
 * the session is hidden from the sessions list because its branch
 * has a review PR (see `buildSidebarItems` — sessions whose branch
 * is in any of `categorizedReviews` are skipped, and only the
 * `review-pr` row is shown). Returns the input key unchanged for
 * non-session keys or for sessions whose row IS rendered as
 * `session`.
 *
 * Without this translation, callers like the branch picker call
 * `selectByKey('session:${name}')` after creating a session, the
 * key matches no item, and `resolveSelectedIndex` falls back to
 * `lastValidIndex` — which lands on whatever neighboring row
 * happens to share that index (a brittle coincidence that breaks
 * whenever the sidebar shape shifts).
 */
export function translateSelectKey(
  key: string,
  sessionBranchMap: Map<string, string>,
  sessionPrMap: Map<string, PullRequestInfo>,
  categorizedReviews: CategorizedReviews
): string {
  if (!key.startsWith('session:')) return key;
  const sessionName = key.slice('session:'.length);
  const branch = sessionBranchMap.get(sessionName);
  const pr = sessionPrMap.get(sessionName);
  if (!branch || !pr) return key;
  const isReviewBranch =
    categorizedReviews.needsReview.some((p) => p.sourceBranch === branch) ||
    categorizedReviews.waitingForAuthor.some(
      (p) => p.sourceBranch === branch
    ) ||
    categorizedReviews.approvedByYou.some((p) => p.sourceBranch === branch);
  return isReviewBranch ? `review:${pr.id}` : key;
}

export interface SidebarContextValue {
  items: SidebarItem[];
  /** Resolved numeric index for rendering. Derived from selectedKey + items. */
  selectedIndex: number;
  selectedItem: SidebarItem | undefined;
  selectedPr: PullRequestInfo | undefined;
  /** Session name to use for terminal: branch-based name for all item kinds. */
  sessionNameForTerminal: string | null;
  totalItems: number;
  /** Select a sidebar item by its stable identity key. */
  selectByKey: (key: string) => void;
  /** Move selection by a relative offset (positive = down, negative = up). */
  moveSelection: (offset: number) => void;
  /** Jump to the next/previous active (running) item. No-op if none found. */
  moveSelectionToActive: (direction: 1 | -1) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const sessionCtx = useSessionData();
  const { vcsConfigured } = useConfig();
  // Sole source of truth for what's selected: the row's identity key
  // plus the index it resolved to. Navigation writes both; the render
  // below re-anchors them whenever `items` change.
  const [selection, setSelection] =
    useState<SidebarSelection>(INITIAL_SELECTION);
  // The `items` array `selection` was last anchored against. `null`
  // until the first render has reconciled.
  const [anchoredItems, setAnchoredItems] = useState<SidebarItem[] | null>(
    null
  );

  const items = useMemo(
    () =>
      buildSidebarItems(
        sessionCtx.sortedSessions,
        vcsConfigured ? sessionCtx.orphanPrs : [],
        vcsConfigured
          ? sessionCtx.categorizedReviews
          : { needsReview: [], waitingForAuthor: [], approvedByYou: [] },
        sessionCtx.sessionBranchMap,
        sessionCtx.sessionPrMap,
        sessionCtx.mergedBranches,
        sessionCtx.conflictCounts
      ),
    [
      sessionCtx.sortedSessions,
      sessionCtx.orphanPrs,
      sessionCtx.categorizedReviews,
      sessionCtx.sessionBranchMap,
      sessionCtx.sessionPrMap,
      sessionCtx.mergedBranches,
      sessionCtx.conflictCounts,
      vcsConfigured,
    ]
  );

  const totalItems = items.length;

  // ── Re-anchor the selection when `items` change ──────────────────
  // React's "adjust state while rendering" pattern: the list changed
  // under us, so the anchor is re-resolved (and a deleted row's
  // neighbour adopted) here, before any child sees a stale index —
  // rather than in an effect that has to be lied to about its deps to
  // keep from looping. Navigation between list changes needs nothing:
  // `selectByKey` / `moveSelection` write an already-resolved anchor.
  let current = selection;
  if (anchoredItems !== items) {
    current = reconcileSelection(items, selection);
    setAnchoredItems(items);
    if (current !== selection) setSelection(current);
  }

  const selectedIndex = current.index;

  // ── Derived values (cheap — no useMemo needed) ───────────────────
  const selectedItem = items[selectedIndex];
  const selectedPr = selectedItem ? getPrFromItem(selectedItem) : undefined;
  const sessionNameForTerminal = !selectedItem
    ? null
    : selectedItem.kind === 'session'
    ? selectedItem.session.name
    : branchToSessionName(selectedItem.pr.sourceBranch);

  // ── Navigation helpers ───────────────────────────────────────────
  const selectByKey = useCallback(
    (key: string) => {
      const translated = translateSelectKey(
        key,
        sessionCtx.sessionBranchMap,
        sessionCtx.sessionPrMap,
        sessionCtx.categorizedReviews
      );
      setSelection((prev) => selectionForKey(items, translated, prev));
    },
    [
      items,
      sessionCtx.sessionBranchMap,
      sessionCtx.sessionPrMap,
      sessionCtx.categorizedReviews,
    ]
  );

  const moveSelection = useCallback(
    (offset: number) => {
      const newIdx = Math.max(
        0,
        Math.min(selectedIndex + offset, items.length - 1)
      );
      const item = items[newIdx];
      if (item) {
        setSelection({ key: getItemKey(item), index: newIdx });
      }
    },
    [items, selectedIndex]
  );

  const moveSelectionToActive = useCallback(
    (direction: 1 | -1) => {
      for (
        let i = selectedIndex + direction;
        i >= 0 && i < items.length;
        i += direction
      ) {
        const item = items[i];
        if (item && isItemActive(item)) {
          setSelection({ key: getItemKey(item), index: i });
          return;
        }
      }
    },
    [items, selectedIndex]
  );

  const value = useMemo<SidebarContextValue>(
    () => ({
      items,
      selectedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
      totalItems,
      selectByKey,
      moveSelection,
      moveSelectionToActive,
    }),
    [
      items,
      selectedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
      totalItems,
      selectByKey,
      moveSelection,
      moveSelectionToActive,
    ]
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
