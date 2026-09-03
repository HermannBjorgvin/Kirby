import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { TerminalKind, TerminalSummary } from '../../../host/contract.js';
import { useTerminals } from '../data/queries.js';
import { useLaunchTerminal } from '../data/mutations.js';
import { useTabs, type TerminalEntry } from '../tabs/tabs.js';
import { estimateTerminalGrid, paneTerminalGrid } from '../terminal-grid.js';
import { errorMessage } from '../utils.js';

/** The host's summary, as the tab model keeps it. */
function toEntry(t: TerminalSummary): TerminalEntry {
  return {
    name: t.name,
    kind: t.kind,
    cwd: t.cwd,
    displayPath: t.displayPath,
    repo: t.repo,
  };
}

/**
 * The grid a new terminal is spawned at. Measured off the pane area the
 * tab will occupy when there is one on screen; a window with no tabs
 * open has no pane to measure, so the editor's share of the window is
 * the estimate then. The terminal corrects it the moment it mounts.
 */
function estimatePane(): { cols?: number; rows?: number } {
  const panes = document.querySelector<HTMLElement>('[data-editor-panes]');
  const measured = panes ? paneTerminalGrid(panes) : null;
  if (measured) return measured;
  return estimateTerminalGrid({
    width: window.innerWidth - 280,
    height: window.innerHeight - 80,
  });
}

/**
 * Terminal tabs, renderer side: keep the strip reconciled with the
 * host's terminal listing (the restore path, and terminals discovery
 * finds mid-run), and open one on request.
 *
 * Sits beside `sync-items` in the workspace rather than inside it:
 * terminals are not sidebar items, and the listing is not repo-scoped.
 */
export function useTerminalTabs() {
  const tabs = useTabs();
  const terminals = useTerminals();
  const launch = useLaunchTerminal();
  const [dialogOpen, setDialogOpen] = useState(false);

  const entries = useMemo(
    () => (terminals.data ?? []).map(toEntry),
    [terminals.data]
  );
  // `tabs` changes identity on every dispatch, and re-running settles:
  // `sync-terminals` returns the same state once there is nothing to do.
  useEffect(() => {
    tabs.syncTerminals(entries);
  }, [tabs, entries]);

  const launchMutate = launch.mutate;
  const openTerminal = tabs.openTerminal;
  const launchTerminal = useCallback(
    (kind: TerminalKind, cwd: string) => {
      setDialogOpen(false);
      launchMutate(
        { kind, cwd, ...estimatePane() },
        {
          // The tab is opened here rather than waiting for the listing:
          // activating it is what switches the workspace when the
          // terminal belongs to another repository.
          onSuccess: (summary) => openTerminal(toEntry(summary)),
          onError: (e) => toast.error(errorMessage(e)),
        }
      );
    },
    [launchMutate, openTerminal]
  );

  return {
    dialogOpen,
    openDialog: useCallback(() => setDialogOpen(true), []),
    closeDialog: useCallback(() => setDialogOpen(false), []),
    launchTerminal,
    busy: launch.isPending,
  };
}
