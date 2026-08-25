import {
  GitBranchIcon,
  GitPullRequestIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type { ContextMenuItem, SidebarItem } from '../../../host/contract.js';
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
  const tabs = useTabs();
  const closer = useCloseTabs(items);
  const byKey = useMemo(
    () => new Map(items.map((i) => [itemKey(i), i])),
    [items]
  );

  // Mount policy: the active tab plus any tab whose branch has a PTY
  // session (its terminal must stay mounted to keep scrollback). Other
  // panes unmount while inactive — a diff pane can hold tens of
  // thousands of nodes, and keeping several alive made every
  // interaction (typing, closing tabs) pay for all of them.
  const hasSession = (tab: Tab): boolean => {
    if (tab.kind !== 'item') return false;
    const item = byKey.get(tab.itemKey);
    if (!item) return false;
    const branch = itemBranch(item);
    return items.some(
      (i) => itemBranch(i) === branch && itemSessionName(i) != null
    );
  };

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-tab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            item={tab.kind === 'item' ? byKey.get(tab.itemKey) : undefined}
            active={tab.id === tabs.activeId}
            closer={closer}
          />
        ))}
        <div className="flex-1" />
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.tabs.map((tab) => {
          const active = tab.id === tabs.activeId;
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
    </div>
  );
}

function TabButton({
  tab,
  item,
  active,
  closer,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  active: boolean;
  closer: ReturnType<typeof useCloseTabs>;
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
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
      <span className="relative flex shrink-0">
        <Icon className="size-4" />
        {running && (
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-tab-active" />
        )}
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
