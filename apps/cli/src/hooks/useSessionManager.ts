import { useState, useEffect, useRef, useCallback } from 'react';
import {
  removeWorktree,
  deleteBranch,
  listAllBranches,
  listWorktrees,
  branchToSessionName,
  setWorktreeResolver,
  createTemplateResolver,
} from '@kirby/worktree-manager';
import type { AgentSession } from '../types.js';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import type { VcsProvider, AppConfig } from '@kirby/vcs-core';
import { killSession, hasSession as hasPtySession } from '../pty-registry.js';

export function useSessionManager(
  providers: VcsProvider[],
  setConfig: (v: AppConfig | ((prev: AppConfig) => AppConfig)) => void,
  setBranches: (v: string[]) => void
) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSessions = useCallback(async () => {
    const worktrees = await listWorktrees();
    const filtered: AgentSession[] = [];
    for (const wt of worktrees) {
      const name = branchToSessionName(wt.branch);
      filtered.push({
        name,
        running: hasPtySession(name),
      });
    }
    setSessions(filtered);
    setWorktreeBranches(worktrees.map((wt) => wt.branch));
    return filtered;
  }, []);

  const flashStatus = useCallback((msg: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatusMessage(msg);
    statusTimer.current = setTimeout(() => setStatusMessage(null), 3000);
  }, []);

  const performDelete = useCallback(
    async (sessionName: string, branch: string) => {
      killSession(sessionName);
      await removeWorktree(branch, { force: true });
      await deleteBranch(branch, true);
      await refreshSessions();
    },
    [refreshSessions]
  );

  // Load sessions and branches on mount
  useEffect(() => {
    let cancelled = false;

    const config = readConfig();
    if (config.worktreePath) {
      setWorktreeResolver(createTemplateResolver(config.worktreePath));
    }

    (async () => {
      if (cancelled) return;
      await refreshSessions();
      const allBranches = await listAllBranches();
      if (!cancelled) setBranches(allBranches);
    })();

    // Auto-detect per-project fields on first launch
    const { updated } = autoDetectProjectConfig(process.cwd(), providers);
    if (updated) {
      setConfig(readConfig());
    }

    return () => {
      cancelled = true;
      if (statusTimer.current) clearTimeout(statusTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessions,
    worktreeBranches,
    statusMessage,
    flashStatus,
    refreshSessions,
    performDelete,
  };
}
