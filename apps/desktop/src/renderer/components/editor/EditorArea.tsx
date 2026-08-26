import {
  GitBranchIcon,
  GitPullRequestIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import type {
  ContextMenuItem,
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useSessionActivity } from '../../lib/queries.js';
import {
  itemBranch,
  itemKey,
  itemRunning,
  itemSessionName,
  itemTitle,
} from '../../lib/sidebar-model.js';
import { useTabs, type Tab } from '../../lib/tabs.js';
import { useCloseTabs } from '../../lib/use-close-tabs.js';
import { cn } from '../../lib/utils.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { SettingsView } from '../settings/SettingsView.js';
import { EmptyState } from './EmptyState.js';
import { ItemView } from './ItemView.js';

/**
 * Tab strip + stacked panes. Every open tab stays mounted (panes are
 * absolutely positioned and hidden with `visibility`, not unmounted)
 * so running terminals keep their scrollback and PR views keep their
 * scroll position when you switch away and back.
 */
export function EditorArea({
  items,
  onOpenPalette,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const closer = useCloseTabs(items);
  const activity = useSessionActivity(repo.cwd);
  const byKey = useMemo(
    () => new Map(items.map((i) => [itemKey(i), i])),
    [items]
  );

  const sessionNameFor = (tab: Tab): string | undefined => {
    if (tab.kind !== 'item') return undefined;
    const item = byKey.get(tab.itemKey);
    if (!item) return undefined;
    const branch = itemBranch(item);
    for (const i of items) {
      const name = itemSessionName(i);
      if (name && itemBranch(i) === branch) return name;
    }
    return undefined;
  };

  // The tab strip tracks the live state so clicks feel instant; the
  // panes below follow a *deferred* copy, so mounting/unmounting a
  // pane runs as an interruptible background render instead of
  // blocking the click. No blanket overlay: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const paneTabs = useDeferredValue(tabs.tabs);
  const paneActiveId = useDeferredValue(tabs.activeId);

  // Mount policy: the active tab plus any tab whose branch has a PTY
  // session (its terminal must stay mounted to keep scrollback). Other
  // panes unmount while inactive — a diff pane can hold tens of
  // thousands of nodes, and keeping several alive made every
  // interaction (typing, closing tabs) pay for all of them.
  const hasSession = (tab: Tab): boolean => sessionNameFor(tab) != null;

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-tab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.tabs.map((tab) => {
          const sessionName = sessionNameFor(tab);
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              item={tab.kind === 'item' ? byKey.get(tab.itemKey) : undefined}
              active={tab.id === tabs.activeId}
              closer={closer}
              snapshot={sessionName ? activity.data?.[sessionName] : undefined}
            />
          );
        })}
        <div className="flex-1" />
      </div>
      <div className="relative min-h-0 flex-1">
        {paneTabs.map((tab) => {
          const active = tab.id === paneActiveId;
          if (!active && !hasSession(tab)) return null;
          return (
            <div
              key={tab.id}
              aria-hidden={!active}
              className={cn(
                'absolute inset-0 flex min-h-0 flex-col',
                !active && 'invisible'
              )}
            >
              <ErrorBoundary resetKey={tab.id}>
                {tab.kind === 'settings' ? (
                  <SettingsView />
                ) : (
                  <ItemView
                    item={byKey.get(tab.itemKey)}
                    items={items}
                    itemKey={tab.itemKey}
                    active={active}
                    onPin={() => tabs.pin(tab.id)}
                  />
                )}
              </ErrorBoundary>
            </div>
          );
        })}
      </div>
      {confirmDialog}
    </div>
  );
}

function TabButton({
  tab,
  item,
  active,
  closer,
  snapshot,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  active: boolean;
  closer: ReturnType<typeof useCloseTabs>;
  snapshot: SessionActivitySnapshot | undefined;
}) {
  const tabs = useTabs();
  const label =
    tab.kind === 'settings'
      ? 'Settings'
      : item
      ? itemTitle(item)
      : tab.itemKey.replace(/^[a-z]+:/, '');
  const running = item ? itemRunning(item) : false;
  const Icon =
    tab.kind === 'settings'
      ? SettingsIcon
      : item?.pr
      ? GitPullRequestIcon
      : GitBranchIcon;

  const openContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      { id: 'close', label: 'Close' },
      {
        id: 'close-others',
        label: 'Close Others',
        enabled: tabs.tabs.length > 1,
      },
      { id: 'close-all', label: 'Close All' },
    ];
    if (tab.preview) {
      items.push({ type: 'separator' }, { id: 'pin', label: 'Keep Open' });
    }
    const chosen = await window.kirby.showContextMenu(items);
    if (chosen === 'close') closer.close(tab.id);
    else if (chosen === 'close-others') closer.closeOthers(tab.id);
    else if (chosen === 'close-all') closer.closeAll();
    else if (chosen === 'pin') tabs.pin(tab.id);
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closer.close(tab.id);
        }
      }}
      onClick={() => tabs.activate(tab.id)}
      onDoubleClick={() => tabs.pin(tab.id)}
      onContextMenu={(e) => void openContextMenu(e)}
      className={cn(
        'group relative flex h-full max-w-56 min-w-28 cursor-default items-center gap-2 border-r border-border pr-1.5 pl-3 text-base transition-colors',
        active
          ? 'bg-tab-active text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        // The agent finished a work streak and nobody has looked yet.
        snapshot?.flashing && !active && 'tab-attention'
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
      <span className="relative flex shrink-0">
        <Icon className="size-4" />
        {snapshot?.active ? (
          <span className="agent-spinner absolute -right-1 -bottom-1 size-2.5 rounded-full" />
        ) : running ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-tab-active" />
        ) : null}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}>
        {label}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          closer.close(tab.id);
        }}
        aria-label="Close tab"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100',
          active && 'opacity-100'
        )}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
