import { useState, useEffect, useRef, useCallback } from 'react';
import {
  isAvailable,
  listSessions,
  killSession,
  removeWorktree,
  deleteBranch,
  listAllBranches,
  listWorktrees,
  branchToSessionName,
} from '@kirby/tmux-manager';
import type { TmuxSession } from '@kirby/tmux-manager';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import type { VcsProvider, AppConfig } from '@kirby/vcs-core';

export function useSessionManager(
  providers: VcsProvider[],
  setConfig: (v: AppConfig | ((prev: AppConfig) => AppConfig)) => void,
  setBranches: (v: string[]) => void
) {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasTmux, setHasTmux] = useState(false);
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSessions = useCallback(async () => {
    const worktrees = await listWorktrees();
    const allTmux = await listSessions();
    const filtered: TmuxSession[] = [];
    for (const wt of worktrees) {
      const name = branchToSessionName(wt.branch);
      const live = allTmux.find((s) => s.name === name);
      if (live) {
        filtered.push(live);
      } else {
        filtered.push({ name, windows: 0, created: 0, attached: false });
      }
    }
    const nonReview = filtered.filter((s) => !s.name.startsWith('review-pr-'));
    setSessions(nonReview);
    setWorktreeBranches(worktrees.map((wt) => wt.branch));
    return nonReview;
  }, []);

  const flashStatus = useCallback((msg: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatusMessage(msg);
    statusTimer.current = setTimeout(() => setStatusMessage(null), 3000);
  }, []);

  const performDelete = useCallback(
    async (sessionName: string, branch: string) => {
      await killSession(sessionName);
      await removeWorktree(branch);
      await deleteBranch(branch);
      const updated = await refreshSessions();
      setSelectedIndex((prev) =>
        prev >= updated.length ? Math.max(0, updated.length - 1) : prev
      );
    },
    [refreshSessions]
  );

  // Check tmux availability, load sessions and branches on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const ok = await isAvailable();
      if (cancelled) return;
      setHasTmux(ok);
      if (ok) {
        await refreshSessions();
      }
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
    setSessions,
    selectedIndex,
    setSelectedIndex,
    hasTmux,
    worktreeBranches,
    statusMessage,
    flashStatus,
    refreshSessions,
    performDelete,
  };
}
