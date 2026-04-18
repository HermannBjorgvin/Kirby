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
import { useToastActions } from './ToastContext.js';
import type { ToastVariant } from './ToastContext.js';
import type { AgentSession } from '../types.js';
import { sortSessionsByPrId } from '../utils/session-sort.js';

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
}

// ── Actions context (consumed by input handlers) ──

export interface SessionActionsContextValue {
  /**
   * Push a transient notification toast. Defaults to the `info` variant.
   * Internally delegates to ToastContext — every call renders in the
   * top-right toast stack.
   */
  flashStatus: (msg: string, variant?: ToastVariant) => void;
  refreshSessions: () => Promise<AgentSession[]>;
  performDelete: (sessionName: string, branch: string) => Promise<void>;
  refreshPr: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

const SessionDataContext = createContext<SessionDataContextValue | null>(null);
const SessionActionsContext = createContext<SessionActionsContextValue | null>(
  null
);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { config, provider, providers, reloadFromDisk } = useConfig();
  const { branchPicker } = useAppState();
  const { flash } = useToastActions();

  const sessionMgr = useSessionManager(
    providers,
    reloadFromDisk,
    branchPicker.setBranches
  );

  const { prMap, error: prError, refresh: refreshPr } = usePrData();
  const { lastSynced, triggerSync } = useRemoteSync();

  const onMergedDelete = useCallback(
    (sessionName: string, branch: string) => {
      sessionMgr.performDelete(sessionName, branch);
      flash(`Auto-deleted merged branch: ${branch}`, 'success');
    },
    [sessionMgr, flash]
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
    ]
  );

  const { refreshSessions, performDelete } = sessionMgr;

  const actionsValue = useMemo<SessionActionsContextValue>(
    () => ({
      flashStatus: flash,
      refreshSessions,
      performDelete,
      refreshPr,
      triggerSync,
    }),
    [flash, refreshSessions, performDelete, refreshPr, triggerSync]
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
