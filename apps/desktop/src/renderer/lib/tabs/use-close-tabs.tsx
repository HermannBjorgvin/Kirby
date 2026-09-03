import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useSessionActivity } from '../data/queries.js';
import { useKillSession, useKillTerminal } from '../data/mutations.js';
import { CloseConfirmDialog, type PendingClose } from './CloseConfirmDialog.js';
import { useRepo } from '../repo-context.js';
import {
  itemBranch,
  itemKey,
  itemSessionName,
} from '../sidebar/sidebar-model.js';
import { useTabs, type Tab } from './tabs.js';
import { errorMessage } from '../utils.js';

/**
 * Tab closing that also shuts down the agent: an item tab is the
 * agent's home in the UI, so closing it kills any live session on that
 * tab's branch instead of leaving an orphaned PTY running with no tab
 * to reattach to. When the agent is *actively working* (debounced
 * activity, same signal as the tab spinner), the close asks for
 * confirmation first — render `confirmDialog` next to any consumer.
 *
 * A terminal tab always asks, and closing it kills its session on both
 * backends: the tab is the only handle on that shell, and unlike a
 * worktree agent there is no row to reattach from.
 */
export function useCloseTabs(items: SidebarItem[]): {
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  closeActive: () => void;
  confirmDialog: ReactNode;
} {
  const { repo } = useRepo();
  const tabs = useTabs();
  const kill = useKillSession(repo.cwd);
  const killTerminal = useKillTerminal();
  const activity = useSessionActivity(repo.cwd);
  const killMutate = kill.mutate;
  const killTerminalMutate = killTerminal.mutate;
  const [pending, setPending] = useState<PendingClose | null>(null);

  /** Session names (and their branches) tied to the closing tabs. */
  const collectSessions = useCallback(
    (closing: Tab[]): { name: string; branch: string }[] => {
      const byKey = new Map(items.map((i) => [itemKey(i), i]));
      const byBranch = new Map(items.map((i) => [itemBranch(i), i]));
      const found = new Map<string, string>();
      for (const tab of closing) {
        if (tab.kind !== 'item') continue;
        // Only this repository's tabs. `items` describes the open repo,
        // and two repos routinely share a branch name — matching a
        // foreign tab against them would kill the wrong agent, or ask
        // the user to confirm stopping one that is not closing. A
        // foreign tab's agent is simply left running: the host refuses
        // to touch another repo's session anyway, and its row is still
        // there when that repo is opened again.
        if (tab.repo !== repo.cwd) continue;
        // Fall back to the tab's stamped branch when its key doesn't
        // resolve (an item re-keys when a PR appears on its branch).
        // Missing the item here would close the tab without killing or
        // asking about its agent, stranding a session with no tab left
        // to reattach from.
        const item =
          byKey.get(tab.itemKey) ??
          (tab.branch ? byBranch.get(tab.branch) : undefined);
        if (!item) continue;
        const branch = itemBranch(item);
        for (const i of items) {
          const name = itemSessionName(i);
          if (name && itemBranch(i) === branch) found.set(name, branch);
        }
      }
      return [...found].map(([name, branch]) => ({ name, branch }));
    },
    [items, repo.cwd]
  );

  const killNames = useCallback(
    (names: string[]) => {
      for (const name of names) {
        killMutate(name, { onError: (e) => toast.error(errorMessage(e)) });
      }
    },
    [killMutate]
  );

  const killTerminals = useCallback(
    (names: string[]) => {
      for (const name of names) {
        killTerminalMutate(name, {
          onError: (e) => toast.error(errorMessage(e)),
        });
      }
    },
    [killTerminalMutate]
  );

  const requestClose = useCallback(
    (closing: Tab[], run: () => void) => {
      const sessions = collectSessions(closing);
      const names = sessions.map((s) => s.name);
      const activeBranches = sessions
        .filter((s) => activity.data?.[s.name]?.active)
        .map((s) => s.branch);
      const terminals = closing.filter((t) => t.kind === 'terminal');
      const finish = () => {
        killNames(names);
        killTerminals(terminals.map((t) => t.name));
        run();
      };
      if (activeBranches.length > 0 || terminals.length > 0) {
        setPending({
          activeBranches,
          terminals: terminals.map((t) => t.displayPath),
          run: finish,
        });
        return;
      }
      finish();
    },
    [collectSessions, killNames, killTerminals, activity.data]
  );

  const close = useCallback(
    (id: string) => {
      const tab = tabs.tabs.find((t) => t.id === id);
      if (!tab) return;
      requestClose([tab], () => tabs.close(id, repo.cwd));
    },
    [tabs, requestClose, repo.cwd]
  );
  const closeOthers = useCallback(
    (id: string) => {
      requestClose(
        tabs.tabs.filter((t) => t.id !== id),
        () => tabs.closeOthers(id)
      );
    },
    [tabs, requestClose]
  );
  const closeAll = useCallback(() => {
    requestClose(tabs.tabs, () => tabs.closeAll());
  }, [tabs, requestClose]);
  const closeActive = useCallback(() => {
    if (tabs.activeId) close(tabs.activeId);
  }, [tabs.activeId, close]);

  // Stable identity: effects that depend on the returned api (the
  // native-menu subscription) must not resubscribe on every render.
  return useMemo(() => {
    const confirmDialog: ReactNode = pending ? (
      <CloseConfirmDialog pending={pending} onCancel={() => setPending(null)} />
    ) : null;
    return { close, closeOthers, closeAll, closeActive, confirmDialog };
  }, [close, closeOthers, closeAll, closeActive, pending]);
}
