import { useCallback } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../host/contract.js';
import { useKillSession } from './queries.js';
import { useRepo } from './repo-context.js';
import { itemBranch, itemKey, itemSessionName } from './sidebar-model.js';
import { useTabs, type Tab } from './tabs.js';
import { errorMessage } from './utils.js';

/**
 * Tab closing that also shuts down the agent: an item tab is the
 * agent's home in the UI, so closing it kills any live session on that
 * tab's branch instead of leaving an orphaned PTY running with no tab
 * to reattach to.
 */
export function useCloseTabs(items: SidebarItem[]): {
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  closeActive: () => void;
} {
  const { repo } = useRepo();
  const tabs = useTabs();
  const kill = useKillSession(repo.cwd);
  const killMutate = kill.mutate;

  const killSessionsOf = useCallback(
    (closing: Tab[]) => {
      const byKey = new Map(items.map((i) => [itemKey(i), i]));
      const names = new Set<string>();
      for (const tab of closing) {
        if (tab.kind !== 'item') continue;
        const item = byKey.get(tab.itemKey);
        if (!item) continue;
        const branch = itemBranch(item);
        for (const i of items) {
          const name = itemSessionName(i);
          if (name && itemBranch(i) === branch) names.add(name);
        }
      }
      for (const name of names) {
        killMutate(name, { onError: (e) => toast.error(errorMessage(e)) });
      }
    },
    [items, killMutate]
  );

  const close = useCallback(
    (id: string) => {
      const tab = tabs.tabs.find((t) => t.id === id);
      if (tab) killSessionsOf([tab]);
      tabs.close(id);
    },
    [tabs, killSessionsOf]
  );
  const closeOthers = useCallback(
    (id: string) => {
      killSessionsOf(tabs.tabs.filter((t) => t.id !== id));
      tabs.closeOthers(id);
    },
    [tabs, killSessionsOf]
  );
  const closeAll = useCallback(() => {
    killSessionsOf(tabs.tabs);
    tabs.closeAll();
  }, [tabs, killSessionsOf]);
  const closeActive = useCallback(() => {
    if (tabs.activeId) close(tabs.activeId);
  }, [tabs.activeId, close]);

  return { close, closeOthers, closeAll, closeActive };
}
