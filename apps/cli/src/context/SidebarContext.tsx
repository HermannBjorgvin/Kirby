import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { branchToSessionName } from '@kirby/worktree-manager';
import type { SidebarItem } from '../types.js';
import { getItemKey, getPrFromItem } from '../types.js';
import { buildSidebarItems } from '../utils/sidebar-items.js';
import { useSessionData } from './SessionContext.js';
import { useConfig } from './ConfigContext.js';

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
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const sessionCtx = useSessionData();
  const { vcsConfigured } = useConfig();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Track last resolved index so we can fall back to a nearby position
  // when the selected item is removed (e.g. session deleted).
  // Uses useState (not useRef) because refs cannot be accessed during render.
  const [lastResolvedIndex, setLastResolvedIndex] = useState(0);

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

  // ── Resolve key → index ──────────────────────────────────────────
  // This runs during render (not in useEffect) to avoid a flash of
  // wrong selection. Same "store previous value" pattern used by
  // usePaneReducer for pane mode auto-reset.

  let resolvedIndex: number;
  if (selectedKey && totalItems > 0) {
    const idx = items.findIndex((item) => getItemKey(item) === selectedKey);
    resolvedIndex = idx >= 0 ? idx : Math.min(lastResolvedIndex, totalItems - 1);
  } else {
    resolvedIndex = 0;
  }
  if (resolvedIndex !== lastResolvedIndex) {
    setLastResolvedIndex(resolvedIndex);
  }

  const resolvedItem = items[resolvedIndex];
  const resolvedKey = resolvedItem ? getItemKey(resolvedItem) : null;

  // If the key doesn't match the resolved item (item was deleted or
  // key was null on first render), sync the key to the actual item.
  if (resolvedKey !== selectedKey) {
    setSelectedKey(resolvedKey);
  }

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
      const newIdx = Math.max(0, Math.min(resolvedIndex + offset, items.length - 1));
      const item = items[newIdx];
      if (item) {
        setSelectedKey(getItemKey(item));
      }
    },
    [items, resolvedIndex]
  );

  const value = useMemo<SidebarContextValue>(
    () => ({
      items,
      selectedIndex: resolvedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
      totalItems,
      selectByKey,
      moveSelection,
    }),
    [
      items,
      resolvedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
      totalItems,
      selectByKey,
      moveSelection,
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
