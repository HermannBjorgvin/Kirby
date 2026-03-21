import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { branchToSessionName } from '@kirby/worktree-manager';
import type { SidebarItem } from '../types.js';
import { buildSidebarItems } from '../utils/sidebar-items.js';
import { useSessionContext } from './SessionContext.js';
import { useConfig } from './ConfigContext.js';

export interface SidebarContextValue {
  items: SidebarItem[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  totalItems: number;
  clampedIndex: number;
  selectedItem: SidebarItem | undefined;
  selectedPr: PullRequestInfo | undefined;
  /** Session name to use for terminal: branch-based name for all item kinds. */
  sessionNameForTerminal: string | null;
}

const SidebarContext =
  createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  children,
}: {
  children: ReactNode;
}) {
  const sessionCtx = useSessionContext();
  const { vcsConfigured } = useConfig();
  const [selectedIndex, setSelectedIndex] = useState(0);

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
  const clampedIndex =
    totalItems > 0 ? Math.min(selectedIndex, totalItems - 1) : 0;
  const selectedItem = items[clampedIndex];

  const selectedPr = useMemo(() => {
    if (!selectedItem) return undefined;
    if (selectedItem.kind === 'session') return selectedItem.pr;
    return selectedItem.pr;
  }, [selectedItem]);

  const sessionNameForTerminal = useMemo(() => {
    if (!selectedItem) return null;
    if (selectedItem.kind === 'session') return selectedItem.session.name;
    // Both orphan-pr and review-pr use branch-based naming
    return branchToSessionName(selectedItem.pr.sourceBranch);
  }, [selectedItem]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      items,
      selectedIndex,
      setSelectedIndex,
      totalItems,
      clampedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
    }),
    [
      items,
      selectedIndex,
      setSelectedIndex,
      totalItems,
      clampedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
    ]
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx)
    throw new Error(
      'useSidebar must be used within SidebarProvider'
    );
  return ctx;
}
