import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../host/contract.js';
import { Button } from '../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { useSessionActivity } from './queries.js';
import { useKillSession } from './mutations.js';
import { useRepo } from './repo-context.js';
import { itemBranch, itemKey, itemSessionName } from './sidebar-model.js';
import { useTabs, type Tab } from './tabs.js';
import { errorMessage } from './utils.js';

interface PendingClose {
  /** Branches whose agents are actively working right now. */
  activeBranches: string[];
  /** Kill + close, once the user confirms. */
  run: () => void;
}

/**
 * Tab closing that also shuts down the agent: an item tab is the
 * agent's home in the UI, so closing it kills any live session on that
 * tab's branch instead of leaving an orphaned PTY running with no tab
 * to reattach to. When the agent is *actively working* (debounced
 * activity, same signal as the tab spinner), the close asks for
 * confirmation first — render `confirmDialog` next to any consumer.
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
  const activity = useSessionActivity(repo.cwd);
  const killMutate = kill.mutate;
  const [pending, setPending] = useState<PendingClose | null>(null);

  /** Session names (and their branches) tied to the closing tabs. */
  const collectSessions = useCallback(
    (closing: Tab[]): { name: string; branch: string }[] => {
      const byKey = new Map(items.map((i) => [itemKey(i), i]));
      const byBranch = new Map(items.map((i) => [itemBranch(i), i]));
      const found = new Map<string, string>();
      for (const tab of closing) {
        if (tab.kind !== 'item') continue;
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
    [items]
  );

  const killNames = useCallback(
    (names: string[]) => {
      for (const name of names) {
        killMutate(name, { onError: (e) => toast.error(errorMessage(e)) });
      }
    },
    [killMutate]
  );

  const requestClose = useCallback(
    (closing: Tab[], run: () => void) => {
      const sessions = collectSessions(closing);
      const names = sessions.map((s) => s.name);
      const activeBranches = sessions
        .filter((s) => activity.data?.[s.name]?.active)
        .map((s) => s.branch);
      if (activeBranches.length > 0) {
        setPending({
          activeBranches,
          run: () => {
            killNames(names);
            run();
          },
        });
        return;
      }
      killNames(names);
      run();
    },
    [collectSessions, killNames, activity.data]
  );

  const close = useCallback(
    (id: string) => {
      const tab = tabs.tabs.find((t) => t.id === id);
      if (!tab) return;
      requestClose([tab], () => tabs.close(id));
    },
    [tabs, requestClose]
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
      <Dialog open onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Agent{pending.activeBranches.length === 1 ? ' is' : 's are'} still
              working
            </DialogTitle>
            <DialogDescription>
              {pending.activeBranches.map((b, i) => (
                <span key={b}>
                  {i > 0 && ', '}
                  <span className="font-mono text-foreground">{b}</span>
                </span>
              ))}{' '}
              {pending.activeBranches.length === 1 ? 'is' : 'are'} actively
              producing output. Closing the tab stops the agent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep working
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setPending(null);
                pending.run();
              }}
            >
              Stop agent &amp; close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null;
    return { close, closeOthers, closeAll, closeActive, confirmDialog };
  }, [close, closeOthers, closeAll, closeActive, pending]);
}
