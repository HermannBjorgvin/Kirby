import { useState, useEffect, useCallback } from 'react';
import {
  removeWorktree,
  deleteBranch,
  listAllBranches,
  listWorktrees,
  worktreeSessionName,
  setWorktreeResolver,
  createTemplateResolver,
} from '@kirby/worktree-manager';
import type { AgentSession } from '../types.js';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import type { VcsProvider } from '@kirby/vcs-core';
import { killSession, isSessionAlive, onSessionExit } from '../pty-registry.js';

export function useSessionManager(
  providers: VcsProvider[],
  reloadConfig: () => void,
  setBranches: (v: string[]) => void
) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([]);

  const refreshSessions = useCallback(async () => {
    const worktrees = await listWorktrees();
    const filtered: AgentSession[] = [];
    for (const wt of worktrees) {
      const name = worktreeSessionName(wt);
      filtered.push({
        name,
        running: isSessionAlive(name),
        ...(wt.state ? { state: wt.state } : {}),
      });
    }
    setSessions(filtered);
    // Detached-HEAD orphans have an empty branch; drop them here so the
    // merged/conflict git queries (countConflicts, fetchMergedBranches)
    // never run against an empty ref.
    setWorktreeBranches(worktrees.map((wt) => wt.branch).filter(Boolean));
    return filtered;
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
      reloadConfig();
    }

    // Flip the row's running indicator (green → gray) when an agent PTY
    // exits on its own. An exit changes nothing about the worktree list,
    // so flip the one session's flag in place rather than shelling out
    // to git via refreshSessions() — several agents exiting at once
    // would otherwise spawn a listWorktrees() storm to update one bool.
    const unsubscribe = onSessionExit((name) => {
      if (cancelled) return;
      setSessions((prev) =>
        prev.map((s) => (s.name === name ? { ...s, running: false } : s))
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessions,
    worktreeBranches,
    refreshSessions,
    performDelete,
  };
}
