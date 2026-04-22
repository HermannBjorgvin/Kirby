import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
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
  // Sole source of truth for what's selected. Every render derives
  // `selectedIndex` by looking up the key in the current items array.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Mirror of the last valid numeric index. A `ref` (not state)
  // because this is bookkeeping for the fallback path — mutating it
  // during render doesn't need to trigger a re-render.
  const lastValidIndexRef = useRef(0);

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

  // ── Derive selectedIndex from selectedKey + items ────────────────
  // Pure derivation on every render — no setState called here.
  const selectedIndex = resolveSelectedIndex(
    items,
    selectedKey,
    lastValidIndexRef.current
  );
  lastValidIndexRef.current = selectedIndex;

  const resolvedItem = items[selectedIndex];
  const resolvedKey = resolvedItem ? getItemKey(resolvedItem) : null;

  // ── Reconcile key on items change ────────────────────────────────
  // If the selected item disappeared (delete / merge) or `selectedKey`
  // was null on mount, sync `selectedKey` to the fallback item. Runs
  // only when `items` change — navigation via `selectByKey` resolves
  // synchronously in the derivation above and doesn't need the effect.
  useEffect(() => {
    if (resolvedKey !== selectedKey) {
      setSelectedKey(resolvedKey);
    }
    // selectedKey intentionally omitted so we only fire on items change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Derived values (cheap — no useMemo needed) ───────────────────
  const selectedItem = resolvedItem;
  const selectedPr = selectedItem ? getPrFromItem(selectedItem) : undefined;
  const sessionNameForTerminal = !selectedItem
    ? null
    : selectedItem.kind === 'session'
    ? selectedItem.session.name
    : branchToSessionName(selectedItem.pr.sourceBranch);

  // ── Navigation helpers ───────────────────────────────────────────
  const selectByKey = useCallback((key: string) => {
    setSelectedKey(key);
  }, []);

  const moveSelection = useCallback(
    (offset: number) => {
      const newIdx = Math.max(
        0,
        Math.min(selectedIndex + offset, items.length - 1)
      );
      const item = items[newIdx];
      if (item) {
        setSelectedKey(getItemKey(item));
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
          setSelectedKey(getItemKey(item));
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
