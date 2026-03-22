import { createContext, useContext, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type {
  PullRequestInfo,
  CategorizedReviews,
  BranchPrMap,
} from '@kirby/vcs-core';
import {
  findOrphanPrs,
  categorizeReviews as categorizePrReviews,
  buildSessionLookups,
} from '../utils/pr-utils.js';
import { useSessionManager } from '../hooks/useSessionManager.js';
import { usePrData } from '../hooks/usePrData.js';
import { useRemoteSync } from '../hooks/useRemoteSync.js';
import { useMergedBranches } from '../hooks/useMergedBranches.js';
import { useConflictCounts } from '../hooks/useConflictCounts.js';
import { useConfig } from './ConfigContext.js';
import { useAppState } from './AppStateContext.js';
import type { AgentSession } from '../types.js';
import {
  sortSessionsByPrId,
  findSortedSessionIndex,
} from '../utils/session-sort.js';

// ── Data context (consumed by SidebarProvider, changes on data refresh) ──

export interface SessionDataContextValue {
  sessions: AgentSession[];
  sortedSessions: AgentSession[];
  worktreeBranches: string[];
  prMap: BranchPrMap;
  prError: string | null;
  orphanPrs: PullRequestInfo[];
  categorizedReviews: CategorizedReviews;
  sessionBranchMap: Map<string, string>;
  sessionPrMap: Map<string, PullRequestInfo>;
  mergedBranches: Set<string>;
  conflictCounts: Map<string, number>;
  conflictsLoading: boolean;
  lastSynced: number;
  selectedSession: AgentSession | undefined;
  selectedName: string | null;
  totalItems: number;
  clampedSelectedIndex: number;
}

// ── Actions context (consumed by input handlers / StatusBar) ──

export interface SessionActionsContextValue {
  selectedIndex: number;
  setSelectedIndex: ReturnType<typeof useSessionManager>['setSelectedIndex'];
  statusMessage: string | null;
  flashStatus: (msg: string) => void;
  refreshSessions: () => Promise<AgentSession[]>;
  findSortedIndex: (sessions: AgentSession[], name: string) => number;
  performDelete: (sessionName: string, branch: string) => Promise<void>;
  refreshPr: () => void;
  triggerSync: () => void;
}

const SessionDataContext = createContext<SessionDataContextValue | null>(null);
const SessionActionsContext = createContext<SessionActionsContextValue | null>(
  null
);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { config, provider, providers, setConfig } = useConfig();
  const { branchPicker } = useAppState();

  const sessionMgr = useSessionManager(
    providers,
    setConfig,
    branchPicker.setBranches
  );

  const { prMap, error: prError, refresh: refreshPr } = usePrData();
  const { lastSynced, triggerSync } = useRemoteSync();

  const onMergedDelete = useCallback(
    (sessionName: string, branch: string) => {
      sessionMgr.performDelete(sessionName, branch);
      sessionMgr.flashStatus(`Auto-deleted merged branch: ${branch}`);
    },
    [sessionMgr]
  );

  const { mergedBranches } = useMergedBranches(
    sessionMgr.worktreeBranches,
    lastSynced,
    onMergedDelete
  );

  const conflictBranches = useMemo(
    () => sessionMgr.worktreeBranches.filter((b) => !mergedBranches.has(b)),
    [sessionMgr.worktreeBranches, mergedBranches]
  );
  const { counts: conflictCounts, loading: conflictsLoading } =
    useConflictCounts(conflictBranches, lastSynced);

  const orphanPrs = useMemo(() => {
    if (!provider) return [];
    const sessionNames = new Set(sessionMgr.sessions.map((s) => s.name));
    return findOrphanPrs(prMap, sessionNames, config, provider);
  }, [prMap, sessionMgr.sessions, config, provider]);

  const categorizedReviews = useMemo((): CategorizedReviews => {
    if (!provider)
      return { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
    return categorizePrReviews(prMap, config, provider);
  }, [prMap, config, provider]);

  const { sessionBranchMap, sessionPrMap } = useMemo(
    () => buildSessionLookups(prMap),
    [prMap]
  );

  const sortedSessions = useMemo(
    () => sortSessionsByPrId(sessionMgr.sessions, sessionPrMap),
    [sessionMgr.sessions, sessionPrMap]
  );

  // Safe to close over sessionPrMap: it only changes on PR refresh (usePrData),
  // never during session creation, so the map is current when callers invoke this
  // right after refreshSessions().
  const findSortedIdx = useCallback(
    (rawSessions: AgentSession[], name: string): number =>
      findSortedSessionIndex(rawSessions, sessionPrMap, name),
    [sessionPrMap]
  );

  const totalItems = sortedSessions.length + orphanPrs.length;
  const clampedSelectedIndex =
    totalItems > 0 ? Math.min(sessionMgr.selectedIndex, totalItems - 1) : 0;
  const selectedSession =
    clampedSelectedIndex < sortedSessions.length
      ? sortedSessions[clampedSelectedIndex]
      : undefined;
  const selectedName = selectedSession?.name ?? null;

  const dataValue = useMemo<SessionDataContextValue>(
    () => ({
      sessions: sessionMgr.sessions,
      sortedSessions,
      worktreeBranches: sessionMgr.worktreeBranches,
      prMap,
      prError,
      orphanPrs,
      categorizedReviews,
      sessionBranchMap,
      sessionPrMap,
      mergedBranches,
      conflictCounts,
      conflictsLoading,
      lastSynced,
      selectedSession,
      selectedName,
      totalItems,
      clampedSelectedIndex,
    }),
    [
      sessionMgr.sessions,
      sortedSessions,
      sessionMgr.worktreeBranches,
      prMap,
      prError,
      orphanPrs,
      categorizedReviews,
      sessionBranchMap,
      sessionPrMap,
      mergedBranches,
      conflictCounts,
      conflictsLoading,
      lastSynced,
      selectedSession,
      selectedName,
      totalItems,
      clampedSelectedIndex,
    ]
  );

  const actionsValue = useMemo<SessionActionsContextValue>(
    () => ({
      selectedIndex: sessionMgr.selectedIndex,
      setSelectedIndex: sessionMgr.setSelectedIndex,
      statusMessage: sessionMgr.statusMessage,
      flashStatus: sessionMgr.flashStatus,
      refreshSessions: sessionMgr.refreshSessions,
      findSortedIndex: findSortedIdx,
      performDelete: sessionMgr.performDelete,
      refreshPr,
      triggerSync,
    }),
    [sessionMgr, findSortedIdx, refreshPr, triggerSync]
  );

  return (
    <SessionDataContext.Provider value={dataValue}>
      <SessionActionsContext.Provider value={actionsValue}>
        {children}
      </SessionActionsContext.Provider>
    </SessionDataContext.Provider>
  );
}

export function useSessionData(): SessionDataContextValue {
  const ctx = useContext(SessionDataContext);
  if (!ctx)
    throw new Error('useSessionData must be used within SessionProvider');
  return ctx;
}

export function useSessionActions(): SessionActionsContextValue {
  const ctx = useContext(SessionActionsContext);
  if (!ctx)
    throw new Error('useSessionActions must be used within SessionProvider');
  return ctx;
}
