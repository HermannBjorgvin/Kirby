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

export interface SessionContextValue {
  sessions: AgentSession[];
  selectedIndex: number;
  setSelectedIndex: ReturnType<typeof useSessionManager>['setSelectedIndex'];
  worktreeBranches: string[];
  statusMessage: string | null;
  flashStatus: (msg: string) => void;
  refreshSessions: () => Promise<AgentSession[]>;
  performDelete: (sessionName: string, branch: string) => Promise<void>;
  prMap: BranchPrMap;
  prError: string | null;
  refreshPr: () => void;
  lastSynced: number;
  triggerSync: () => void;
  mergedBranches: Set<string>;
  conflictCounts: Map<string, number>;
  conflictsLoading: boolean;
  sortedSessions: AgentSession[];
  orphanPrs: PullRequestInfo[];
  categorizedReviews: CategorizedReviews;
  sessionBranchMap: Map<string, string>;
  sessionPrMap: Map<string, PullRequestInfo>;
  selectedSession: AgentSession | undefined;
  selectedName: string | null;
  totalItems: number;
  clampedSelectedIndex: number;
}

const SessionContext = createContext<SessionContextValue | null>(null);

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

  const sortedSessions = useMemo(() => {
    return [...sessionMgr.sessions].sort((a, b) => {
      const idA = sessionPrMap.get(a.name)?.id ?? -Infinity;
      const idB = sessionPrMap.get(b.name)?.id ?? -Infinity;
      return idB - idA;
    });
  }, [sessionMgr.sessions, sessionPrMap]);

  const totalItems = sortedSessions.length + orphanPrs.length;
  const clampedSelectedIndex =
    totalItems > 0 ? Math.min(sessionMgr.selectedIndex, totalItems - 1) : 0;
  const selectedSession =
    clampedSelectedIndex < sortedSessions.length
      ? sortedSessions[clampedSelectedIndex]
      : undefined;
  const selectedName = selectedSession?.name ?? null;

  const value = useMemo<SessionContextValue>(
    () => ({
      sessions: sessionMgr.sessions,
      selectedIndex: sessionMgr.selectedIndex,
      setSelectedIndex: sessionMgr.setSelectedIndex,
      worktreeBranches: sessionMgr.worktreeBranches,
      statusMessage: sessionMgr.statusMessage,
      flashStatus: sessionMgr.flashStatus,
      refreshSessions: sessionMgr.refreshSessions,
      performDelete: sessionMgr.performDelete,
      prMap,
      prError,
      refreshPr,
      lastSynced,
      triggerSync,
      mergedBranches,
      conflictCounts,
      conflictsLoading,
      sortedSessions,
      orphanPrs,
      categorizedReviews,
      sessionBranchMap,
      sessionPrMap,
      selectedSession,
      selectedName,
      totalItems,
      clampedSelectedIndex,
    }),
    [
      sessionMgr,
      prMap,
      prError,
      refreshPr,
      lastSynced,
      triggerSync,
      mergedBranches,
      conflictCounts,
      conflictsLoading,
      sortedSessions,
      orphanPrs,
      categorizedReviews,
      sessionBranchMap,
      sessionPrMap,
      selectedSession,
      selectedName,
      totalItems,
      clampedSelectedIndex,
    ]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx)
    throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}
