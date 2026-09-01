import { useState, useEffect, useCallback, useEffectEvent } from 'react';
import {
  removeWorktree,
  deleteBranch,
  listAllBranches,
  listWorktrees,
  worktreeSessionName,
  setWorktreeResolver,
  createTemplateResolver,
} from '@kirby/worktree-manager';
import type { AgentSession, DiscoveredWorktree } from '@kirby/core';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import type { VcsProvider } from '@kirby/vcs-core';
import {
  killSession,
  isSessionAlive,
  launchSession,
  onSessionExit,
  startSessionDiscovery,
} from '@kirby/core';
import { useLayout } from '../context/LayoutContext.js';

export function useSessionManager(
  providers: VcsProvider[],
  reloadConfig: () => void,
  setBranches: (v: string[]) => void
) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([]);
  const { terminal } = useLayout();

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

  // Attach to an agent session that was started outside this process —
  // another Kirby, a script, someone running `tmux new-session` by
  // hand. This is the ordinary launch path: on the tmux backend
  // `new-session -A` attaches to the running agent rather than starting
  // a second one, and discovery only ever offers a session the registry
  // holds no live PTY for.
  //
  // An effect event, so it reads the pane size at the moment it
  // attaches. A plain closure would capture whatever the terminal was
  // when discovery started and size every later agent to that.
  const adoptExternalSession = useEffectEvent((wt: DiscoveredWorktree) => {
    launchSession({
      name: wt.name,
      cwd: wt.path,
      cols: terminal.paneCols,
      rows: terminal.paneRows,
      config: readConfig(),
      request: { intent: 'continue-or-blank' },
    });
  });

  // Something outside this process changed the worktrees or the live
  // sessions. Both are read from disk by refreshSessions, so re-reading
  // is the whole response.
  const onDiscovered = useEffectEvent(() => {
    void refreshSessions();
  });

  // Startup, once. An effect event rather than an effect with a lint
  // exception: everything below reads the latest providers, config and
  // setters, but none of their identities should re-run a sequence that
  // reads config off disk, shells out to git and subscribes to PTY
  // exits. Declaring them as dependencies would restart all of that on
  // an unrelated parent render.
  const startSessionManager = useEffectEvent(() => {
    let cancelled = false;

    const config = readConfig();
    if (config.worktreePath) {
      setWorktreeResolver(createTemplateResolver(config.worktreePath));
    }

    void (async () => {
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

    const discovery = startSessionDiscovery({
      getConfig: () => readConfig(),
      isCurrent: () => !cancelled,
      adopt: (wt) => adoptExternalSession(wt),
      onChanged: () => onDiscovered(),
    });

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
      discovery.stop();
      unsubscribe();
    };
  });

  useEffect(() => startSessionManager(), []);

  return {
    sessions,
    worktreeBranches,
    refreshSessions,
    performDelete,
  };
}
